/**
 * Local IndexedDB store for the offline-first PWA.
 *
 * Holds the field operator's working set of the 5 syncable entities
 * (customers, sites, jobs, agreements, tasks) plus the sync-infrastructure
 * tables (outbox, photos_pending, sync_meta). Every entity table mirrors
 * the server row shape from `types/database.ts` field-for-field — same
 * names, same nullability — so an outbox replay can pass the local row
 * back to a server action without translation.
 *
 * Step 4 of the offline-pwa rollout: this file defines the schema and
 * exposes a singleton `db`. **Nothing in the UI reads from or writes to
 * Dexie yet.** That comes in steps 5/6 (outbox + sync engine). For now,
 * the existence of the local store + a smoke-test page at /dev/db-smoke
 * are the only artefacts.
 *
 * ────────────────────────────────────────────────────────────────────
 * SCHEMA VERSIONING DISCIPLINE
 * ────────────────────────────────────────────────────────────────────
 * Schema changes here follow the same discipline as the SQL migrations
 * in `supabase/migrations/`:
 *
 *   1. Bump the version number on `db.version(N)` — never edit an
 *      existing version's `.stores(...)` call in place.
 *   2. Chain a new `.version(N+1).stores({...}).upgrade(tx => ...)`
 *      block beneath the existing ones.
 *   3. The `.upgrade()` callback rewrites existing rows to match the
 *      new shape (rename columns, fill defaults, etc).
 *   4. Document the bump in `OFFLINE_AUDIT.md` so the SQL-side migration
 *      and the IndexedDB-side bump are visibly paired.
 *
 * Skipping the upgrade callback works for the trivial case of adding a
 * new optional/nullable field that all rows can tolerate as undefined,
 * but explicit is better — Dexie won't auto-fill defaults.
 * ────────────────────────────────────────────────────────────────────
 */

import Dexie, { type EntityTable } from "dexie";

// Server row types — re-used as-is. The local store mirrors the server
// schema exactly so outbox replay is a straight pass-through.
//
// If a future step needs a local-only field (e.g. `_dirty_at` for
// tracking unsynced edits), intersect it in place:
//   type LocalJob = Job & { _dirty_at?: string };
// then bump the schema version and add the field to the .stores() string.
import type {
  Customer,
  Site,
  Job,
  Agreement,
  Task,
} from "@/types/database";

// ─── Sync-infrastructure table types ────────────────────────────────

/**
 * An action that needs to be replayed against the server when online.
 *
 * Stores the action *name* + serialised args, not an HTTP request body —
 * the sync engine re-invokes the existing server action via a thin
 * client wrapper. This way an action's internals can change later
 * without breaking in-flight outbox entries; the action signature is
 * the sync contract.
 *
 * `args` is `unknown` so any JSON-serialisable shape goes in. The
 * action-name → arg-shape mapping is enforced at the wrapper boundary,
 * not at the storage layer.
 */
export interface OutboxEntry {
  /** Auto-incremented by Dexie. Optional on insert. */
  id?: number;
  /** Action name as exported from `app/(app)/.../actions.ts`. */
  action_name: string;
  /** JSON-serialisable args for that action. */
  args: unknown;
  /** Entity kind the action operates on — used to group / dedupe later. */
  entity_type: string;
  /** Target row id, e.g. the customer id for an updateCustomer call.
   *  For multi-target actions, the primary subject. */
  entity_id: string;
  /** ISO timestamp when queued locally. */
  created_at: string;
  /** Number of times we've tried to drain this entry. */
  attempts: number;
  /** Last error message from a failed drain (null when never tried or last try succeeded). */
  last_error: string | null;
  /** ISO timestamp — earliest moment we should retry. */
  next_attempt_at: string;
}

/**
 * A photo or signature captured offline, awaiting upload to Supabase
 * Storage. The blob lives in IndexedDB; once uploaded the row's
 * `uploaded` flips true and the blob can be cleaned up.
 */
export interface PendingPhoto {
  /** Client-generated UUID — used directly as the storage path. */
  id: string;
  parent_type: "job" | "service_sheet" | "agreement_signature";
  /** UUID of the parent row (jobs.id / agreements.id). */
  parent_id: string;
  /** The actual image bytes. */
  blob: Blob;
  /** Mime type, e.g. "image/jpeg". */
  mime: string;
  /** Captured dimensions (null if not measured at capture time). */
  width: number | null;
  height: number | null;
  /** ISO timestamp when the photo was captured locally. */
  captured_at: string;
  /** True once successfully uploaded. */
  uploaded: boolean;
  upload_attempts: number;
  last_upload_error: string | null;
  /** ISO timestamp when queued. */
  created_at: string;
}

/**
 * Key/value scratch table for sync state: `last_sync_at` per entity,
 * current signed-in user id, etc. Keep entries small and JSON-safe.
 */
export interface SyncMetaEntry {
  key: string;
  value: unknown;
}

// ─── Dexie database ─────────────────────────────────────────────────

class GemCrmDb extends Dexie {
  // Each of these is typed as EntityTable<Row, PrimaryKey> so calls like
  // db.customers.get(id) / db.customers.add(row) / useLiveQuery(...) get
  // proper inference.
  customers!: EntityTable<Customer, "id">;
  sites!: EntityTable<Site, "id">;
  jobs!: EntityTable<Job, "id">;
  agreements!: EntityTable<Agreement, "id">;
  tasks!: EntityTable<Task, "id">;
  outbox!: EntityTable<OutboxEntry, "id">;
  photos_pending!: EntityTable<PendingPhoto, "id">;
  sync_meta!: EntityTable<SyncMetaEntry, "key">;

  constructor() {
    super("gemcrm");

    // ─── v1: initial schema ───────────────────────────────────────
    //
    // Stores-string syntax recap:
    //   - First token is the primary key.
    //     - Bare name (`id`) = PK by that field, no auto-increment.
    //     - `++id` = auto-incrementing integer PK.
    //     - `&key` = PK with explicit uniqueness constraint.
    //   - Subsequent tokens are secondary indexes.
    //   - `[a+b]` = compound index across two fields.
    //
    // Index choices follow the spec:
    //   - FK columns (customer_id, site_id, agreement_id, related_*_id)
    //     so cross-entity joins / filters are O(log n).
    //   - Filter columns (status, job_status, deleted_at, etc) for the
    //     RLS-equivalent local filter and list query predicates.
    //   - The compound [site_id+job_date+call_type] on jobs mirrors the
    //     server's partial unique index. Dexie can't enforce partial
    //     uniqueness so the local "is this a duplicate booking?" check
    //     becomes a pre-insert lookup against this compound index.
    //     Conflicts surface in the conflict inbox during sync.
    //
    // Note on `photo_urls` (text[] on jobs): NOT indexed here. Dexie's
    // multi-entry index syntax (`*photo_urls`) creates an indexed entry
    // per array element, which we don't need — photos are accessed via
    // their parent job, never queried by URL. We store the array as-is
    // (Dexie / structured clone handles plain string arrays natively).
    this.version(1).stores({
      customers:
        "id, name, deleted_at",
      sites:
        "id, customer_id, address_line_1, deleted_at",
      jobs:
        "id, site_id, job_date, job_status, agreement_id, deleted_at, [site_id+job_date+call_type]",
      agreements:
        "id, customer_id, status, deleted_at",
      tasks:
        "id, status, related_job_id, related_customer_id, site_id, agreement_id, deleted_at",

      outbox:
        "++id, created_at, next_attempt_at, [entity_type+entity_id]",
      photos_pending:
        "id, uploaded, [parent_type+parent_id]",
      sync_meta:
        "&key",
    });
  }
}

export const db = new GemCrmDb();

// ─── Dev-only escape hatch ──────────────────────────────────────────
//
// Mount `__db` on `window` in development so a developer can poke the
// store from the browser console:
//   __db.wipeLocalDb()
//   __db.dumpLocalDb()
//   __db.db.customers.toArray()
//
// Production builds skip this — `process.env.NODE_ENV` is statically
// replaced at build time, so the entire `if` branch is tree-shaken.
if (
  process.env.NODE_ENV === "development" &&
  typeof window !== "undefined"
) {
  // Imported lazily inside the guard so the dev module never enters the
  // production bundle even by accident.
  import("./dev").then(({ wipeLocalDb, dumpLocalDb }) => {
    (window as unknown as { __db: unknown }).__db = {
      db,
      wipeLocalDb,
      dumpLocalDb,
    };
  });
}
