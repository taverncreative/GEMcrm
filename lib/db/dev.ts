/**
 * Dev-only helpers for poking the local IndexedDB store from the
 * browser console or the /dev/db-smoke page. Not for use in app code.
 *
 * Auto-mounted on `window.__db` in development by `lib/db/index.ts`.
 * Console examples:
 *
 *   __db.dumpLocalDb()            // logs and returns every table
 *   __db.wipeLocalDb()            // clears every table
 *   __db.db.customers.toArray()   // direct Dexie access
 */

import { db } from "./index";

/**
 * Clear every table in the local DB. Used by the smoke test page's
 * "Wipe" button and by anyone debugging from the console after a
 * failed sync experiment.
 *
 * Idempotent — clearing an empty table is a no-op. Wrapped in a single
 * transaction so it's atomic from the local-DB's perspective (either
 * everything wipes or nothing does, no partial state).
 */
export async function wipeLocalDb(): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  console.log(
    `[db:dev] wiped ${db.tables.length} tables (${db.tables
      .map((t) => t.name)
      .join(", ")})`
  );
}

/**
 * Dump every table's contents to the console and return the same object,
 * so it's usable both as a "let me see what's in there" console one-liner
 * and as a programmatic snapshot.
 */
export async function dumpLocalDb(): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    result[table.name] = await table.toArray();
  }
  console.log("[db:dev] dump:", result);
  return result;
}
