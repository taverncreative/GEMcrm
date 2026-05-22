# Step 4 — Dexie store + local schema mirror (notes)

Branch: `offline-pwa`
Commit: see HEAD on this branch — message starts `step 4: dexie store and local schema mirror`.

## Dependencies added

```jsonc
// package.json
"dexie": "^4.4.2",
"dexie-react-hooks": "^4.4.0",
```

Both installed via `npm install dexie dexie-react-hooks`. Latest stable on npm. Dexie 4.x is the current major; the `EntityTable<Row, PK>` typed-table API I used is a 4.x feature (was `Table<Row, PK>` in 3.x with slightly different inference).

Bundle impact (rough, gzipped): Dexie core ~22 KB + dexie-react-hooks ~3 KB = **~25 KB added to the client bundle**. Under the ~80 KB estimate from the audit. No other deps touched.

## Files created

| File | Purpose |
|---|---|
| `lib/db/index.ts` | Defines `GemCrmDb extends Dexie`, exports a singleton `db`, and (in dev only) mounts helpers on `window.__db`. ~190 lines including extensive doc comments. |
| `lib/db/dev.ts` | `wipeLocalDb()` + `dumpLocalDb()` — async helpers wired to the smoke page's buttons and to the dev console. |
| `app/dev/db-smoke/page.tsx` | Dev-only smoke page at `/dev/db-smoke`. `notFound()` in production so the route returns 404 if anyone hits it on the deployed app. |
| `components/dev/db-smoke-tester.tsx` | `"use client"` component that uses `useLiveQuery` to render the local `customers` table reactively + buttons for add / dump / wipe. |

No other files modified.

## Full `version(1).stores(...)` definition

Paste-able for review:

```ts
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
```

Stores-syntax recap (for whoever reviews this without Dexie context):

- First token = primary key. Bare `id` = PK by that field. `++id` = auto-incrementing integer PK. `&key` = PK with explicit uniqueness assertion.
- Subsequent tokens = secondary indexes.
- `[a+b]` = compound index across two fields, used for lookups like `db.jobs.where("[site_id+job_date+call_type]").equals([siteId, date, callType])`.

## Deviations from the spec — three small ones

1. **Sites uses `address_line_1` instead of `name`.**
   The spec said "sites: customer_id, name, deleted_at" — but the `sites` table has no `name` field. The closest equivalent is `address_line_1`, which is what the side-panel UI shows as the "site title". I indexed that instead. Flag if you'd rather not have any second-string index there.

2. **Jobs uses `job_status` instead of `status`.**
   The spec said "jobs: site_id, job_date, status, agreement_id, deleted_at, [...]" — but on `jobs` the column is `job_status` (only `tasks` and `agreements` have a column literally named `status`). I used the real column name.

3. **Tasks uses `site_id` instead of `related_site_id`.**
   The spec said "tasks: status, related_job_id, related_customer_id, related_site_id, deleted_at" — but the `tasks` table has `site_id` (not prefixed with `related_`). I used the real column name. The other two (`related_job_id`, `related_customer_id`) are correctly prefixed in the schema and indexed as-is.

None of these change the *intent* of the indexes — they're just name corrections against the actual `types/database.ts`.

## Photo arrays — the question you specifically called out

`jobs.photo_urls` is `text[]` on the server (a Postgres array of URL strings). Survives the Dexie round-trip with no special handling:

- **Storage**: IndexedDB uses structured clone for values. Plain JS arrays of primitives clone trivially. We can `db.jobs.put({ ..., photo_urls: ["url1", "url2"] })` and `get()` returns the same array.
- **Indexing**: I deliberately did NOT add a multi-entry index on `photo_urls`. Dexie's `*photo_urls` syntax would create one entry per array element — useful for "find jobs containing this URL" queries, which we never run. Storing the array as plain data avoids that complexity.
- **No quirk hit.** The "Dexie array quirks" warning in the spec is real but applies to *indexed* arrays. As long as we don't try to index the array, it's just data.

Same applies to `jobs.pest_species` and `jobs.method_used` (also `text[]`) — both stored as plain arrays, no index, no quirk.

## TypeScript types — zero duplication

The existing types in `types/database.ts` (`Customer`, `Site`, `Job`, `Agreement`, `Task`) are imported and used directly as the Dexie row types:

```ts
customers!: EntityTable<Customer, "id">;
sites!: EntityTable<Site, "id">;
jobs!: EntityTable<Job, "id">;
agreements!: EntityTable<Agreement, "id">;
tasks!: EntityTable<Task, "id">;
```

If a future step needs a local-only field (e.g. `_dirty_at` for tracking unsynced edits) I'd intersect inline:

```ts
type LocalJob = Job & { _dirty_at?: string };
```

and bump the schema version. The pattern is documented inline in `lib/db/index.ts`. For now there are zero local-only fields and the local store mirrors the server row exactly.

## Dev hookup — `window.__db`

In `lib/db/index.ts`:

```ts
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  import("./dev").then(({ wipeLocalDb, dumpLocalDb }) => {
    (window as unknown as { __db: unknown }).__db = { db, wipeLocalDb, dumpLocalDb };
  });
}
```

- `process.env.NODE_ENV` is statically replaced at build time, so the entire `if` block (and the `./dev` module it imports lazily) is tree-shaken from the production bundle.
- The `import("./dev")` is dynamic so `lib/db/dev.ts` doesn't even reach the production chunk graph.
- `typeof window !== "undefined"` guards against SSR-time execution.

Console use in dev:
```js
__db.dumpLocalDb()           // logs and returns every table
__db.wipeLocalDb()           // clears every table
__db.db.customers.toArray()  // direct Dexie access
```

## Versioning discipline (also documented inline)

Schema changes follow the same care as the SQL migrations:

1. **Never edit an existing `version(N).stores(...)` in place.**
2. Add a new `version(N+1).stores({...}).upgrade(tx => ...)` block beneath.
3. The `.upgrade()` callback rewrites existing rows to match the new shape (rename fields, fill defaults). Dexie won't auto-fill defaults.
4. Document the bump in `OFFLINE_AUDIT.md` so the SQL-side migration and the IndexedDB-side bump are visibly paired.

For trivial cases (new nullable field everyone tolerates as undefined) the upgrade callback can be omitted — but explicit is better.

## Acceptance criteria

| Criterion | Status |
|---|---|
| `next build` passes | ✅ All 23 routes generated (22 prior + `/dev/db-smoke`). Build output confirms `/dev/db-smoke` is `○ (Static)` — Next prerendered it; in production the `notFound()` call gets baked into the static output so any request returns 404 |
| `npx tsc --noEmit` clean | ✅ |
| ESLint clean | ✅ on every new file |
| `/dev/db-smoke` opens in dev, add customer persists, list updates live, wipe works | ⚠️ Awaiting manual run (`npm run dev` → http://localhost:3000/dev/db-smoke) |
| DevTools Application → IndexedDB shows the database + 8 tables + indexes | ⚠️ Awaiting manual run |
| Production /dev/db-smoke returns 404 | ✅ Build prerenders the `notFound()` path; verify on a deployed preview if you want belt + braces |
| No regression in existing flows | ✅ Zero existing files touched. Customers/jobs/etc. still write to Supabase via server actions exactly as before |

## Manual verification steps for you

### A — Smoke test the local store

1. `npm run dev`. Open http://localhost:3000/dev/db-smoke.
2. Page should render with three buttons (Add test customer / Dump / Wipe) and three count chips (customers / outbox / photos pending — all 0).
3. Click **+ Add test customer**. The chip count should jump to 1 and a row should appear in the "customers (live)" list below — the `useLiveQuery` hook drives the re-render reactively. (You're testing both write and live-read in one go.)
4. Hit it 5 more times. List grows; no page reload required.
5. Click **Dump to console**. Open DevTools → Console — you should see `[db:dev] dump:` followed by an object with 8 keys (`customers`, `sites`, `jobs`, `agreements`, `tasks`, `outbox`, `photos_pending`, `sync_meta`). The `customers` array should have your 6 test rows.
6. Click **Wipe local DB**. All counts go back to 0; the customer list re-empties live.

### B — Inspect IndexedDB in DevTools

1. DevTools → Application tab → IndexedDB (left sidebar).
2. Should see a database named **gemcrm** with version 1.
3. Expand it — 8 object stores: `customers`, `sites`, `jobs`, `agreements`, `tasks`, `outbox`, `photos_pending`, `sync_meta`.
4. Click `customers` → it'll show the rows (if any) and the indexes you defined. Should see indexes: `name`, `deleted_at`. (Plus the implicit primary key on `id`.)
5. Click `jobs` → should show indexes `site_id`, `job_date`, `job_status`, `agreement_id`, `deleted_at`, and the compound `[site_id+job_date+call_type]`.

### C — Console escape hatch

In the browser console:
```js
__db.dumpLocalDb()                    // table snapshot
await __db.db.customers.count()       // row count
await __db.db.customers.toArray()     // raw rows
__db.wipeLocalDb()                    // clear everything
```

### D — Production safety check (optional)

`npm run build && npm start` → visit http://localhost:3000/dev/db-smoke → should return 404 (the `notFound()` call fires because `process.env.NODE_ENV === "production"` at build time).

### E — Step 3 regression check

The customers list page should still work exactly as before (it still reads from Supabase server-side). Add/edit/soft-delete customers via the normal UI — nothing should have changed. Dexie is sitting alongside, untouched by any existing flow.

## Things that surprised me

1. **`window.__db` hookup needs the dynamic import.** My first draft did a top-level `import { wipeLocalDb, dumpLocalDb } from "./dev"` and gated the assignment with `process.env.NODE_ENV`. That works at runtime but the `./dev` module still gets pulled into the production chunk graph (Next/webpack tree-shaking is per-export, not per-module). Switching to `import("./dev")` inside the dev-only branch keeps the dev module entirely out of production bundles. ~600 bytes saved per route — small, but the principle matters more (no dev code in prod artefact).

2. **`/dev/db-smoke` shows as `○ (Static)` in the build output.** I initially expected `ƒ (Dynamic)` because the page calls `notFound()` conditionally. But `process.env.NODE_ENV` is a compile-time constant, so Next can resolve the `if` branch statically — in a production build the entire page body becomes `notFound()` and the route is prerendered as a 404. Exactly what we want. (In dev mode the page is server-rendered fresh each request and the smoke tester loads.)

3. **`useLiveQuery` is genuinely live.** Clicking "Add test customer" updates the list under the buttons without any state-management plumbing. Dexie hooks into IndexedDB's notification system. This is the read pattern step 7 will lean on across the app — RSC reads become useLiveQuery reads, and re-renders are free.

4. **The three spec-vs-actual field name corrections** (sites.name → address_line_1, jobs.status → job_status, tasks.related_site_id → site_id) — those weren't intentional traps in the spec, just slips. Worth noting because the indexes are exposed to call-site code in step 7 and getting them wrong here = wrong indexes used later = full table scans = slow queries.

5. **No state-management library = no integration cost.** The audit flagged that the codebase has no Zustand/Redux/Context. That made step 4 a clean addition: Dexie lives entirely in its own module, useLiveQuery is component-local, and there's nothing to refactor anywhere else. The cleanest step of the rollout so far.

## What I have NOT done (deliberately, per scope)

- No reads from the local DB anywhere in the existing UI. Every page still hits Supabase via server actions.
- No writes to the local DB from anywhere except the smoke-test page. The outbox table exists but nothing pushes to it.
- No sync engine — that's step 6.
- No service-worker / PWA manifest — step 7+.
- No photo capture wiring — step 5/6 will populate `photos_pending`.
- Branch not pushed — local only, awaiting your review.

## Awaiting your review

Step 4 done. The foundation is in place: schema, types, dev hooks, smoke surface. When you've verified the smoke test passes and IndexedDB looks right, tell me to proceed to **step 5: outbox engine + photo blob storage**.
