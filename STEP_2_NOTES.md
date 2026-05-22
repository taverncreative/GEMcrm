# Step 2 — Client-generated UUIDs in data layer (notes)

Branch: `offline-pwa`
Commit: see HEAD on this branch — message starts `step 2: client-generated UUIDs in data layer`.

## Goal

Every insert across the data layer supplies an `id` at the moment of creation, generated client-side via `crypto.randomUUID()` (wrapped in a single `newId()` helper). The Postgres `DEFAULT gen_random_uuid()` columns stay in place as a safety net for any insert path that ever forgets to call the helper.

This is the prerequisite for offline inserts in step 4 — an offline device needs to know a row's permanent ID immediately so it can reference it from later mutations (e.g. inserting a `jobs` row that references a `sites` row created in the same offline session).

## Files modified

| File | Change |
|---|---|
| `lib/utils/id.ts` | **New.** Exports `newId(): string` wrapping `crypto.randomUUID()`. Single entry point for swapping the algorithm later if needed (e.g. ULID for sortability). |
| `lib/data/customers.ts` | Added `id: newId()` to the customer insert (line ~104) AND to the `siteRow()` helper that's used for the bulk auto-site insert (line ~85). Both single insert and bulk array insert paths covered. |
| `lib/data/sites.ts` | Added `id: newId()` to `createSite`. |
| `lib/data/jobs.ts` | Added `id: newId()` to `createBooking`. |
| `lib/data/agreements.ts` | Already had `crypto.randomUUID()` directly (the agreement id needed to exist *before* insert so it could be used in the signature storage path). Routed through `newId()` for consistency. |
| `lib/data/tasks.ts` | Added `id: newId()` to `createTask`. |
| `lib/data/invoices.ts` | Added `id: newId()` to both `createInvoiceForJob` and `createStandaloneInvoice`. |
| `lib/data/reports.ts` | Added `id: newId()` to `createReport`. |
| `lib/data/feature-requests.ts` | Added `id: newId()` to `createFeatureRequest`. |
| `lib/services/agreement-events.ts` | Bulk insert of scheduled jobs from a new PMA (`generateAgreementJobs`) — each pushed row now gets `id: newId()`. |

11 insert call sites touched in total. No schema changes. No new dependencies.

## `crypto.randomUUID()` runtime confirmation

| Environment | Status | Source of truth |
|---|---|---|
| Local Node | ✅ Node 24.14.0 detected, `crypto.randomUUID` available as a global | `node -e "console.log(typeof crypto?.randomUUID)"` |
| Vercel Node runtime | ✅ Vercel defaults to Node 22 (current LTS), exceeds the Node 19+ threshold for global `crypto.randomUUID` | Vercel docs |
| Vercel Edge runtime (proxy.ts) | ✅ Web Crypto API is part of the Edge runtime spec | Vercel + Web standards |
| Modern browsers (PWA client) | ✅ Available since 2021 — Chrome 92+, Safari 15.4+, Firefox 95+ | MDN |

`package.json` has no `engines` field, but `@types/node` is `^20` which signals Node 20+ target. Vercel will run Node 22 by default; the Edge runtime always has Web Crypto. **No runtime concerns.**

## Coverage vs the audit's syncable-entity list

Audit identified 5 syncable entities going into the outbox: `customers`, `sites`, `jobs`, `agreements`, `tasks`. All covered.

The user's step-2 instructions extended the rule to "every insert in `lib/data/*`" for consistency, so I also covered the entities that **won't** sync offline:

| Entity | Syncable in outbox? | `id: newId()` added? | Why include |
|---|---|---|---|
| customers | yes | ✓ | core |
| sites | yes | ✓ | core |
| jobs | yes | ✓ | core |
| agreements | yes | ✓ | core |
| tasks | yes | ✓ | core |
| reports | no — server-generated PDF metadata | ✓ | consistency; PDF route generates these but the data-layer helper is callable from any context |
| invoices | no — online-only per decision | ✓ | consistency; even online inserts now have client UUIDs (no harm) |
| feature_requests | no — submitted from Settings, server-only flow | ✓ | consistency; tiny audit-log table, but cheap to align |
| daily_summaries | no — cron-output aggregate | **skipped** | upsert keyed by `summary_date` not `id`; including `id` in an upsert payload would either no-op or risk overwriting the existing row's id (no FKs reference it, but safer to leave the DB default alone for this table) |

## Discoveries that surprised me

1. **`lib/data/agreements.ts` was already using `crypto.randomUUID()` directly** (line 69 before this change). The reason: when an agreement is created with signatures attached, the signature image gets uploaded to Supabase Storage at path `agreements/${agreementId}/client.png` — and the storage upload needs to happen *before* the row insert (because the insert payload references the uploaded URL). So the agreement id had to exist client-side before the DB call. This pattern was an early adopter of the same approach we're now systematising; I routed it through `newId()` for consistency but no behaviour change.

2. **No insert calls live outside `lib/data/*` or `lib/services/*`.** `grep` across `app/` for `.insert(` returned zero hits — confirming the data-layer abstraction is clean and there are no "stray" inserts in route handlers or server actions. Means the single `lib/utils/id.ts` helper genuinely is the one place to swap.

3. **`daily_summaries.upsert` is the only non-insert write path** I found in the data layer. Skipped for the reasons above. If we ever want it to follow the same rule, we'd have to also pass `ignoreDuplicates: false` and design how `id` interacts with the `onConflict: "summary_date"` clause. Not worth doing now — the table isn't syncable.

4. **No other entities discovered that aren't already in the audit.** Coverage is complete.

5. **Behaviour identical at runtime.** With the new id supplied by the client, the DB sees `INSERT INTO customers (id, name, ...) VALUES (<provided-uuid>, ...)` instead of `INSERT INTO customers (name, ...) VALUES (...)`. Postgres uses the provided id rather than firing the default. The returned row has the same shape. No code downstream cares whether the id was server-generated or client-generated.

## Acceptance criteria

| Criterion | Status |
|---|---|
| `next build` passes | ✅ All 22 routes generated, no errors |
| `npx tsc --noEmit` clean | ✅ |
| ESLint clean on every modified file | ✅ |
| Every insert in `lib/data/*` either accepts an `id` parameter or generates one via `newId()` | ✅ 10/10 sites covered (the 11th is the bulk insert in `lib/services/agreement-events.ts` which is technically not under `lib/data/`, but it's the same syncable entity (`jobs`) so covered too) |
| Existing tests pass | ✅ No test suite exists in the repo; build + typecheck + lint serve as the substitute gate |
| Manual smoke: create a customer via the UI, confirm the inserted row has a client-supplied UUID | ⚠️ Requires hands-on browser test. The change is data-layer only — no UI behaviour difference. **To verify**: add a `console.log(input.id ?? 'newly generated')` next to the insert, create a customer, check Vercel runtime logs vs the inserted row's `id` in Supabase. Or simpler: just trust the build/typecheck — every code path now flows through `newId()` which is a single-line function. |

## Why I didn't add an `id` parameter to the data-layer functions (yet)

The user's acceptance criterion allowed either:
- (a) accepts an `id` parameter and uses it, OR
- (b) generates one via `newId()` before insert and includes it in the insert payload

I took option (b) for step 2. Reasoning:

- It's the minimum scope needed to unblock step 4 (Dexie store) — the outbox engine itself can generate the id on the client side before queueing.
- Adding an optional `id?: string` parameter to every data-layer function is a wider API change that wants its own dedicated step, probably alongside the outbox-replay wiring in step 5 or 6. When the outbox replays a queued mutation, the original client-generated id needs to be preserved (otherwise local references break) — that's when the function signature change earns its keep.
- Doing it now and leaving it unused for steps 3-4 would just be churn.

**To be added in step 5/6 (outbox build)**: extend each `lib/data/*.ts` create function to accept an optional `opts.id`, defaulting to `newId()` when absent. Mechanical change once the outbox replay path needs it.

## What I have NOT done

- No DB schema change (`DEFAULT gen_random_uuid()` columns untouched, as instructed).
- No `id` parameter added to function signatures yet (deferred to step 5/6).
- No changes to `daily_summaries.upsert` (different semantics, not syncable).
- Did not push the branch — local only, awaiting your review.

## Files touched

- `lib/utils/id.ts` — new (24 lines)
- `lib/data/customers.ts` — 2 edits (import + customer insert + siteRow helper)
- `lib/data/sites.ts` — 2 edits
- `lib/data/jobs.ts` — 2 edits
- `lib/data/agreements.ts` — 2 edits (route existing call through newId)
- `lib/data/tasks.ts` — 2 edits
- `lib/data/invoices.ts` — 3 edits (import + 2 insert sites)
- `lib/data/reports.ts` — 2 edits
- `lib/data/feature-requests.ts` — 2 edits
- `lib/services/agreement-events.ts` — 2 edits
- `STEP_2_NOTES.md` — new (this file)

No other files modified. No dependencies added. No env vars added. No migrations added.

## Awaiting your review

Step 2 done. Per the plan, stopping here. Step 3 (soft deletes migration adding `deleted_at` to the 5 syncable entities + partial unique indexes) is teed up but not started.
