/**
 * Generate a fresh ID for a new row.
 *
 * Single entry point so the underlying algorithm can be swapped without
 * touching call sites. If we ever need lexicographically-sortable IDs
 * (e.g. ULID for time-ordered list paging) the change happens here.
 *
 * Current implementation: Web Crypto `crypto.randomUUID()`. Available as
 * a global in:
 *   - Browsers (all modern, since 2021)
 *   - Node.js 19+ (we target 20+ via @types/node)
 *   - Vercel Node runtime (Node 22 default)
 *   - Vercel Edge runtime (Web Crypto is part of the Edge spec)
 *
 * Used by `lib/data/*.ts` insert calls so every new row carries a
 * client-generated UUID at the moment of creation. This is the
 * prerequisite for offline inserts in the offline-pwa work — an offline
 * device needs to know a row's permanent ID immediately to reference
 * it from later mutations (e.g. inserting a `jobs` row that references
 * a `sites` row created in the same offline session). The Postgres
 * `DEFAULT gen_random_uuid()` columns are kept as a safety net for any
 * future insert path that forgets to call this.
 */
export function newId(): string {
  return crypto.randomUUID();
}
