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
  /** True once the entry has been classified as unrecoverable by the
   *  push loop (typically after 5 client-error attempts, or immediately
   *  on UnknownActionError). Stuck entries are excluded from normal
   *  drain queries and surface in the conflict inbox for manual retry
   *  or discard. Indexed in v2 schema for efficient inbox queries.
   *  Stored as boolean — Dexie's indexedDB driver handles the boolean
   *  index correctly in modern browsers. */
  stuck: boolean;
  /** What kind of mutation this entry represents on its entity. Used
   *  by the enqueue-time compaction logic to fold sequences like
   *  update+update into a single entry. Optional for compatibility —
   *  pre-step-6 entries without `op` are treated as "update" on read,
   *  the most conservative default. Not indexed (compaction reads the
   *  entity-grouped slice anyway via the compound index). */
  op?: "create" | "update" | "delete";
}

/**
 * A photo or signature captured offline, awaiting upload to Supabase
 * Storage. The blob lives in IndexedDB; once uploaded the row's
 * `uploaded` flips true. The blob is retained for ~7 days post-capture
 * for offline-view (`getPhotoSrcAsync` reads it), then cleared on the
 * next successful drain to reclaim IndexedDB space.
 */
export interface PendingPhoto {
  /** Client-generated UUID — used directly as the storage path. */
  id: string;
  parent_type: "job" | "service_sheet" | "agreement_signature";
  /** UUID of the parent row (jobs.id / agreements.id). */
  parent_id: string;
  /** The actual image bytes. Replaced with a 0-byte Blob on cleanup
   *  once `uploaded === true` AND `captured_at` is >7d old. */
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
  /** Earliest moment the photos loop should retry. Null = ready
   *  immediately. Set by the loop after an upload failure via the
   *  same backoff helper push uses. v3 field. */
  next_attempt_at: string | null;
  /** Storage public URL captured after successful upload. v3 field.
   *  `getPhotoSrcAsync` prefers this over the blob once both exist,
   *  so post-cleanup (when blob is zeroed) photos still display. */
  server_url: string | null;
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

    // ─── v2: outbox `stuck` flag ──────────────────────────────────
    //
    // Step 6 adds the conflict-inbox concept. Outbox entries that fail
    // 5 times with client-errors (or hit an unknown action_name) are
    // marked `stuck: true` and excluded from normal drain queries —
    // they surface in /sync/conflicts for manual retry or discard.
    //
    // Indexed on the stuck flag itself for the inbox query path. The
    // entity_type/entity_id compound index from v1 is preserved.
    //
    // Upgrade: any pre-v2 outbox entry gets `stuck: false`. Dexie
    // doesn't auto-fill defaults so we walk the table once on first
    // open under v2 — cheap (most users will have zero or a handful
    // of outbox rows at upgrade time).
    this.version(2).stores({
      outbox:
        "++id, created_at, next_attempt_at, stuck, [entity_type+entity_id]",
    }).upgrade(async (tx) => {
      await tx.table("outbox").toCollection().modify((row) => {
        if (typeof row.stuck !== "boolean") row.stuck = false;
      });
    });

    // ─── v3: photos_pending retry scheduling + cached server URL ──
    //
    // Step 6's photos loop needs an explicit next_attempt_at so failed
    // uploads can exponentially back off (same shape as the outbox).
    // server_url caches the resolved public URL post-upload so the UI
    // can keep displaying the photo even after the local Blob is
    // garbage-collected (>7d after capture). Both nullable so the
    // upgrade is a defaults-fill pass.
    this.version(3).stores({
      photos_pending:
        "id, uploaded, next_attempt_at, [parent_type+parent_id]",
    }).upgrade(async (tx) => {
      await tx.table("photos_pending").toCollection().modify((row) => {
        if (!("next_attempt_at" in row)) row.next_attempt_at = null;
        if (!("server_url" in row)) row.server_url = null;
      });
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
