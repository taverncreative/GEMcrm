"use client";

/**
 * Pull loop — fetches server-side changes since the last cursor per
 * entity, merges into Dexie, advances the cursor.
 *
 * Each entity has an isolated cursor in `sync_meta`. A pull failure on
 * one entity (e.g. transient 5xx for jobs) doesn't roll back the
 * customers/sites/agreements/tasks cursors — they advance independently.
 *
 * Merge policy: **last-write-wins on `updated_at`**.
 *   - If no local row exists for `serverRow.id` → write serverRow.
 *   - If local row exists and `serverRow.updated_at >= local.updated_at`
 *     → write serverRow.
 *   - If local row exists and `serverRow.updated_at < local.updated_at`
 *     → keep local (a wrapped action wrote it locally after the server's
 *     timestamp; the push loop will sync that forward).
 *   - **Outbox-aware guard:** if any outbox entry references this
 *     entity_id, **skip the merge** for this row. Why: the local row
 *     is dirty with an unsynced wrapper-write; the server's view is
 *     stale; the next push will fix server-side and the next pull will
 *     refresh us cleanly. Pulling now would clobber the dirty write.
 *     Documented in step 6 notes, gotcha 2.
 *
 * Cursor advancement: take the **max(updated_at) of the returned set**
 * as the new cursor (strict greater-than means equal would otherwise
 * re-import the same boundary row each pull). If the returned set is
 * empty, the cursor doesn't advance — pull is a no-op until the server
 * has new changes.
 *
 * Soft-deleted rows: the RPC returns them with `deleted_at` populated.
 * The local merge writes them through unchanged — local query callers
 * (step 7) filter `where("deleted_at").equals(null)` at the read site,
 * mirroring the server's RLS. The locally-mirrored soft-delete is
 * what makes "deleted on Browser A → invisible on Browser B" work.
 */

import { db } from "@/lib/db";
import type { Table } from "dexie";
import type { Customer, Site, Job, Agreement, Task } from "@/types/database";
import {
  pullCustomersAction,
  pullSitesAction,
  pullJobsAction,
  pullAgreementsAction,
  pullTasksAction,
} from "@/app/(app)/sync/pull-actions";
import { classifyError, type SyncResultClass } from "@/lib/sync/http-classify";

/** Per-entity cursor keys in sync_meta. Centralised so the rename
 *  blast radius is one diff. */
export const CURSOR_KEYS = {
  customers: "cursor.customers",
  sites: "cursor.sites",
  jobs: "cursor.jobs",
  agreements: "cursor.agreements",
  tasks: "cursor.tasks",
} as const;

export interface PullEntityResult {
  entity: keyof typeof CURSOR_KEYS;
  /** Rows the server returned. */
  fetched: number;
  /** Rows merged into Dexie (fetched minus outbox-guarded skips). */
  merged: number;
  /** Rows whose local merge was skipped because an outbox entry
   *  references the same entity_id. */
  skipped_dirty: number;
  /** New cursor written; null if pull errored before completing. */
  cursor_after: string | null;
  /** Set on failure; classified. */
  error?: SyncResultClass;
}

export interface PullResult {
  entities: PullEntityResult[];
  halted: boolean;
  halt_reason?: string;
}

interface SyncableRow {
  id: string;
  updated_at: string;
}

/** Read the current cursor for an entity from sync_meta. */
async function readCursor(key: string): Promise<string | null> {
  const row = await db.sync_meta.get(key);
  return typeof row?.value === "string" ? row.value : null;
}

/** Write a cursor value to sync_meta. */
async function writeCursor(key: string, value: string): Promise<void> {
  await db.sync_meta.put({ key, value });
}

/**
 * Generic merge helper. For each returned row, either write it through
 * (LWW says server wins) or skip it (outbox-guarded). Returns the
 * count actually merged + skipped, and the max updated_at observed.
 */
async function mergeRows<T extends SyncableRow>(
  rows: T[],
  table: Table<T, string>,
  entityType: string
): Promise<{ merged: number; skipped: number; maxUpdatedAt: string | null }> {
  let merged = 0;
  let skipped = 0;
  let maxUpdatedAt: string | null = null;

  for (const row of rows) {
    if (!maxUpdatedAt || row.updated_at > maxUpdatedAt) {
      maxUpdatedAt = row.updated_at;
    }

    // Outbox guard — is there a pending unsynced wrapper-write on
    // this row? If so, the local version is newer-than-server in the
    // logical sense even though updated_at hasn't been bumped server-side
    // yet. Skip the merge; the next push will sync local→server.
    const outboxCount = await db.outbox
      .where("[entity_type+entity_id]")
      .equals([entityType, row.id])
      .count();
    if (outboxCount > 0) {
      skipped++;
      continue;
    }

    const existing = await table.get(row.id);
    if (!existing || row.updated_at >= existing.updated_at) {
      // Use put() — overwrites on existing PK match, inserts on miss.
      await table.put(row);
      merged++;
    } else {
      // Local is newer than server (rare — usually means clock skew or
      // a wrapper-write that finished syncing between this pull cycle
      // and the cursor being read). Skip — don't clobber the newer
      // local row.
      skipped++;
    }
  }

  return { merged, skipped, maxUpdatedAt };
}

/**
 * Pull one entity. Updates its cursor on success; leaves cursor
 * untouched on failure (so the next pull retries from the same point).
 */
async function pullEntity<T extends SyncableRow>(
  entity: keyof typeof CURSOR_KEYS,
  table: Table<T, string>,
  fetcher: (since: string | null) => Promise<T[]>
): Promise<PullEntityResult> {
  const cursorKey = CURSOR_KEYS[entity];
  const since = await readCursor(cursorKey);
  const out: PullEntityResult = {
    entity,
    fetched: 0,
    merged: 0,
    skipped_dirty: 0,
    cursor_after: since,
  };

  let rows: T[];
  try {
    rows = await fetcher(since);
  } catch (err) {
    out.error = classifyError(err);
    return out;
  }

  out.fetched = rows.length;
  const { merged, skipped, maxUpdatedAt } = await mergeRows(
    rows,
    table,
    entity.slice(0, -1) // "customers" → "customer" to match outbox entity_type
  );
  out.merged = merged;
  out.skipped_dirty = skipped;

  if (maxUpdatedAt && maxUpdatedAt !== since) {
    await writeCursor(cursorKey, maxUpdatedAt);
    out.cursor_after = maxUpdatedAt;
  }
  return out;
}

/** Progress callback hook for callers that want per-entity feedback —
 *  used by the initial-sync overlay. State transitions: 'syncing' →
 *  'done' | 'error'. count reflects the rows merged from the server. */
export type PullProgress = (
  entity: keyof typeof CURSOR_KEYS,
  state: "syncing" | "done" | "error",
  count: number
) => void;

/**
 * Pull all 5 entities sequentially. Sequential (not Promise.all) because:
 *   - The cursor reads/writes against sync_meta are quick but a
 *     parallel storm against the dev server isn't worth it.
 *   - Auth-expired on one entity should halt the rest — easier to
 *     express as a sequential loop with early return.
 *   - Backpressure: pull-then-push on the next tick keeps things
 *     orderly.
 *
 * Optional onProgress callback fires before each entity starts and
 * after it finishes — used by the initial-sync overlay to show
 * per-entity status.
 */
export async function pullAll(onProgress?: PullProgress): Promise<PullResult> {
  const out: PullResult = { entities: [], halted: false };

  const entities: Array<{
    name: keyof typeof CURSOR_KEYS;
    table: Table<SyncableRow, string>;
    fetch: (since: string | null) => Promise<SyncableRow[]>;
  }> = [
    {
      name: "customers",
      table: db.customers as unknown as Table<SyncableRow, string>,
      fetch: pullCustomersAction as unknown as (
        s: string | null
      ) => Promise<SyncableRow[]>,
    },
    {
      name: "sites",
      table: db.sites as unknown as Table<SyncableRow, string>,
      fetch: pullSitesAction as unknown as (
        s: string | null
      ) => Promise<SyncableRow[]>,
    },
    {
      name: "jobs",
      table: db.jobs as unknown as Table<SyncableRow, string>,
      fetch: pullJobsAction as unknown as (
        s: string | null
      ) => Promise<SyncableRow[]>,
    },
    {
      name: "agreements",
      table: db.agreements as unknown as Table<SyncableRow, string>,
      fetch: pullAgreementsAction as unknown as (
        s: string | null
      ) => Promise<SyncableRow[]>,
    },
    {
      name: "tasks",
      table: db.tasks as unknown as Table<SyncableRow, string>,
      fetch: pullTasksAction as unknown as (
        s: string | null
      ) => Promise<SyncableRow[]>,
    },
  ];

  for (const e of entities) {
    onProgress?.(e.name, "syncing", 0);
    const result = await pullEntity(e.name, e.table, e.fetch);
    out.entities.push(result);
    if (result.error) {
      onProgress?.(e.name, "error", result.merged);
      if (result.error.kind === "auth-expired") {
        out.halted = true;
        out.halt_reason = result.error.message;
        return out;
      }
      // Non-halting error — record but continue to the next entity.
      continue;
    }
    onProgress?.(e.name, "done", result.merged);
  }

  return out;
}

// Re-export the entity types so the engine can use them.
export type { Customer, Site, Job, Agreement, Task };
