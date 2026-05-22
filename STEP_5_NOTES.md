# Step 5 — Outbox engine + photo blob storage (notes)

Branch: `offline-pwa`
Commit: see HEAD on this branch — message starts `step 5: outbox engine and photo blob storage`.

## What this step delivers

| File | Status | Purpose |
|---|---|---|
| `lib/db/outbox.ts` | **new** | `enqueueAction()` + `removeOutboxEntry()` against the Dexie `outbox` table from step 4 |
| `lib/actions/wrap.ts` | **new** | `useLocalFirstAction` (form-action hook) + `wrapAction` (direct-call function) — both follow the same 3-step local-first contract |
| `lib/db/photos.ts` | **new** | `capturePhoto(file, parentType, parentId)` — compresses to 1600px JPEG q=0.82 and stores Blob in `photos_pending` |
| `lib/photos/src.ts` | **new** | `getPhotoSrc()` sync + `getPhotoSrcAsync()` async — resolves a photo ref (PendingPhoto record / URL / bare client id) to a usable `<img src>` |
| `components/dashboard/complete-task-button.tsx` | modified | Wrapped — **task** entity representative |
| `components/jobs/job-status-actions.tsx` | modified | `JobQuickAction` wrapped — **job** entity representative |
| `components/customers/customers-table.tsx` | modified | `ReviewCheckbox` uses `wrapAction(setReviewReceivedAction, …)` — **customer** entity representative (direct-call pattern) |
| `components/agreements/agreement-status-actions.tsx` | modified | `StatusButton` wrapped — **agreement** entity representative |
| `components/dev/db-smoke-tester.tsx` | modified | Adds outbox-entry inspector + "+ Enqueue outbox entry" + "Clear outbox" buttons |
| `POST_OFFLINE_FOLLOWUPS.md` | modified | Two new step-7 parking-lot items: UI guards on skip-classified actions; wrap `createSiteAction` with explicit `router.push()` |
| `STEP_5_NOTES.md` | new | This file |

**No server action bodies were modified.** No data-layer changes. No new dependencies. No migrations.

## Action audit — full classification (31 actions)

The original audit estimated "~33"; exact enumeration of exported `async function` declarations across `app/(app)/**/actions.ts` is **31**.

| # | Action | File | Entity | Class |
|---|---|---|---|---|
| 1 | `completeTaskAction` | `dashboard/actions.ts` | task | **wrap** ✅ |
| 2 | `bulkCompleteTasksAction` | `dashboard/actions.ts` | task (×N) | **special** |
| 3 | `finishDayAction` *(dashboard)* | `dashboard/actions.ts` | none | **skip** |
| 4 | `updateJobStatusAction` | `jobs/[id]/actions.ts` | job | **wrap** ✅ |
| 5 | `completeServiceSheetAction` | `jobs/[id]/complete/actions.ts` | job (+ report + photos) | **special** |
| 6 | `approveServiceSheetAction` | `jobs/[id]/complete/actions.ts` | job (+ task + email) | **special** |
| 7 | `generateReportAction` | `jobs/[id]/report/actions.ts` | none (PDF only) | **skip** |
| 8 | `updateAgreementStatusAction` | `agreements/[id]/actions.ts` | agreement | **wrap** ✅ |
| 9 | `createAgreementAction` | `sites/[id]/agreements/actions.ts` | agreement + jobs (×N) + PDF + email | **special** |
| 10 | `createBookingAction` | `sites/[id]/bookings/actions.ts` | job | **wrap** |
| 11 | `searchCustomersAction` | `bookings/actions.ts` | none (read) | **skip** |
| 12 | `getSitesForCustomerAction` | `bookings/actions.ts` | none (read) | **skip** |
| 13 | `createQuickBookingAction` | `bookings/actions.ts` | customer? + site? + job | **special** |
| 14 | `createCustomerAction` | `customers/actions.ts` | customer + sites (×N) | **special** |
| 15 | `getCustomerDetailAction` | `customers/actions.ts` | none (read) | **skip** |
| 16 | `setReviewReceivedAction` | `customers/actions.ts` | customer | **wrap** ✅ |
| 17 | `getDeleteImpactAction` | `customers/actions.ts` | none (read) | **skip** |
| 18 | `deleteCustomerAction` | `customers/actions.ts` | customer | **wrap** |
| 19 | `setCustomerTypeAction` | `customers/actions.ts` | customer | **wrap** |
| 20 | `createSiteAction` | `customers/[id]/sites/actions.ts` | site | **wrap** (deferred to step 7 — `redirect()` issue) |
| 21 | `createInvoiceDraftAction` | `invoices/actions.ts` | invoice (non-syncable) + PDF | **skip** |
| 22 | `markInvoicePaidAction` | `invoices/actions.ts` | invoice (non-syncable) | **skip** |
| 23 | `sendInvoiceFollowUpAction` | `invoices/actions.ts` | none (email) | **skip** |
| 24 | `sendInvoiceAction` | `invoices/actions.ts` | invoice (non-syncable) + email | **skip** |
| 25 | `snoozeReviewAction` | `reviews/actions.ts` | customer | **wrap** (verified — writes `review_request_snoozed_until` on `customers`) |
| 26 | `markReviewReceivedAction` | `reviews/actions.ts` | customer | **wrap** (functional duplicate of #16) |
| 27 | `runRenewalCheckAction` | `settings/actions.ts` | none (batch) | **skip** |
| 28 | `finishDayAction` *(settings)* | `settings/actions.ts` | none | **skip** |
| 29 | `submitFeatureRequestAction` | `settings/actions.ts` | feature_request (non-syncable) + email | **skip** |
| 30 | `changePasswordAction` | `settings/actions.ts` | none (auth) | **skip** |
| 31 | `inviteUserAction` | `settings/actions.ts` | none (auth admin) | **skip** |

**Totals:** wrap = **10**, skip = **15**, special-case = **6**.

✅ = wrapped in step 5 as a representative for that entity type.

## Representatives wrapped (4 of 5 planned entities)

| Entity | Action | Call site | Pattern |
|---|---|---|---|
| task | `completeTaskAction` | `components/dashboard/complete-task-button.tsx` | `useLocalFirstAction` (form-action) |
| job | `updateJobStatusAction` | `components/jobs/job-status-actions.tsx` (`JobQuickAction` only — `StatusButton` deliberately left raw) | `useLocalFirstAction` (form-action) |
| customer | `setReviewReceivedAction` | `components/customers/customers-table.tsx` (`ReviewCheckbox`) | `wrapAction` (direct-call) |
| agreement | `updateAgreementStatusAction` | `components/agreements/agreement-status-actions.tsx` | `useLocalFirstAction` (form-action) |
| **site** | **none** | — | **see below** |

### Why no site representative

The action audit shows the only single-row site action is `createSiteAction`, which has been deferred to step 7 per edge case F (server-side `redirect()` doesn't fire offline). No `updateSiteAction` / `renameSiteAction` / `archiveSiteAction` exists in the codebase — sites are created and then read-only until soft-delete-via-customer happens. We deliberately did **not** force-wrap an arbitrary action just to hit the entity-count target.

Sites still participate in the local store (step 4 schema, RLS soft-delete filter, sync engine in step 6); they just have no entity-mutation action of their own to wrap in step 5.

## Edge-case decisions captured

### A. Multi-write atomicity (architecture for step 6)

The outbox schema today is `(action_name, args, entity_type, entity_id)` — one entry, one primary subject. Step-6 sync engine needs to handle three multi-write patterns:

**(b) Atomic array — `entity_ids: string[]` on the outbox entry:**
- `createAgreementAction` — agreement row + N child jobs
- `createQuickBookingAction` — possibly customer + site + job
- `createCustomerAction` — customer + 0..N additional sites

Step-6 implementation: extend `OutboxEntry` schema with optional `entity_ids: string[]` (when set, takes precedence over `entity_id`). Replay submits the original FormData in one shot — server-side stays transactional. Dedup logic in step 6 considers every id in the array.

**(a) Fan-out — N separate outbox entries:**
- `bulkCompleteTasksAction` — each task is independent; replay is N sequential `completeTaskAction` calls

Step-6 implementation: the wrapper for this action decomposes the form's `task_ids[]` into N `enqueueAction` calls, each with `entity_type: "task"` and the individual id. Each entry replays via the single-task action endpoint.

**(c) Deferred to step 6 review — must support offline:**
- `completeServiceSheetAction`

**This is the field operator's core use case.** A pest controller visits a site, fills the service sheet in the van (often with no signal), uploads photos, completes the job. If this is online-only, the offline rollout has failed its primary user.

The deferral is "deferred to step 6 *review*", not "deferred to step 6 *implementation* maybe later online-only". The design needs to be sketched alongside step 6's sync engine because the photos path (`photos_pending`) and the multi-write path (`jobs` row update + `reports` row insert + photos upload) interact, and step 6 is where the sync engine becomes real. **Do not let this drift into "online-only."** When step 6 starts, the first thing to design is how this action goes through the wrapper.

### B. Eventual consistency for cascading side-effects

Accepted. Local writes reflect the user's intent immediately; cascading effects (e.g. `onJobCompleted` server-side spawns a follow-up task, a review prompt, an updated daily-summary) land in Dexie on the next pull sync.

The two wrapped actions with cascading effects are:
- `updateJobStatusAction` with `status === "completed"` — server-side `onJobCompleted` cascade fires server-side only; client sees the job marked done, sees the spawned task/review later
- `approveServiceSheetAction` (still classified special, but the same boundary applies if/when it's wrapped) — finalises job + optionally emails + optionally spawns follow-up booking

The operator's view in the van: "Done" status renders immediately. The desk view: review-request widget / task list updates after the next pull. No data is lost; the boundary is documented and acceptable.

### C. UI guards for skip-classified actions

Added to `POST_OFFLINE_FOLLOWUPS.md` as a step-7 task with the 9 affected action names listed.

### D. `formDataToObject` throws on File

Implemented in `lib/actions/wrap.ts`. Error message verbatim:
> FormData contains a File. Files cannot be queued in the outbox. Use capturePhoto() to store the file in photos_pending and pass the photo id as a string.

Future maintainer adding `<input type="file">` to a wrapped action will get a clear runtime error pointing them at the right path. The current 10 wrap-classified actions all use only string FormData fields (verified during the audit), so this throws on no existing call site.

### E. `wrapAction` typed return

`wrapAction` returns `Promise<LocalActionResult>` where:

```ts
interface LocalActionResult {
  success: boolean;
  error?: string;
}
```

- On local failure (`applyLocal` or `enqueueAction` throws) → `{ success: false, error: err.message }`. Existing call-site revert-on-failure code paths work unchanged.
- On local success → `{ success: true }`, regardless of whether the server call fires (online) or skips (offline). The promise resolves once local + outbox writes land; server failures are silent here and surface via the outbox / step-6 sync engine retry logic.

The `ReviewCheckbox.flip()` call site already checks `if (!res.success) setChecked(!next)` — that path now fires correctly on local failure too, not just server failure.

### F. `createSiteAction` deferred to step 7

Added to `POST_OFFLINE_FOLLOWUPS.md`. Includes the proposed wrapper extension (`onLocalSuccess` callback) so step 7 has the design ready.

### G. `snoozeReviewAction` target table verified

Read `lib/data/reviews.ts:snoozeReviewRequest` — it updates the `customers` table, setting `review_request_snoozed_until`. The column exists on the `Customer` type and Dexie's customers store mirrors that type exactly, so no schema changes needed. **Classified WRAP (customer, direct-call).**

## Divergence between local and server rows (documented in wrap.ts)

Quoting the docstring added to `lib/actions/wrap.ts`:

> Local writes use client-supplied values. Server-computed fields (normalisation, server timestamps, generated reference numbers etc) will overwrite the local row on the next pull sync. If your action depends on a server-computed value at the call site, that's a sync-ordering concern — but no current wrapped action does. Wrapped actions either flip a flag (review received, job status, agreement status) or set a soft-delete timestamp — values the client can compute authoritatively.

This is acceptable for step 5. If/when a wrapped action grows a server-computed-value dependency (e.g. `reference_number` on a created entity), it becomes a step-6 sync-ordering concern and the call site needs to either (a) wait for the sync to overwrite the placeholder, or (b) compute the value client-side authoritatively too.

## Online-fast-path semantics

When online, every wrapped action **always enqueues** an outbox entry, even though the server call also fires. The entry's purpose is recovery — if the tab crashes / the network drops mid-call / the server returns 500 — so it must be there before the server call begins.

Step 6's sync engine handles "this entry was already applied" idempotently via the action's natural idempotency (status updates are idempotent by definition; soft-deletes set `deleted_at = now()` which only matters once). The first drain on a fresh online connection will see entries for actions the server already executed — replaying them is a no-op.

Trade-off accepted: simpler step 5, exercises step 6's dedup logic on the common path, costs one extra outbox row per online action (cheap — Dexie + structured clone, no network).

A future optimisation could delete the outbox entry on server-success in the fast path (skip the dedup work). Skipped in step 5 because it would mean step 6 only sees the offline path during dev — better to exercise both paths from day one.

## Manual smoke test steps

All steps run in `npm run dev`. Production builds skip the dev-only smoke page (the parent `app/dev/db-smoke/page.tsx` calls `notFound()` outside development).

### Step A — verify the smoke page renders

1. `npm run dev`, navigate to `/dev/db-smoke`.
2. Three section cards visible: **Actions**, **outbox entries (live, newest 20)**, **customers (live)**.
3. Top-right grid shows three counters: `customers`, `outbox`, `photos pending`. All start at 0 on a fresh browser.

### Step B — exercise the outbox helper directly

1. Click **+ Enqueue outbox entry**.
2. `outbox` counter increments by 1 immediately.
3. The "outbox entries" list shows one row: action `smokeTestAction`, entity `customer · <uuid prefix>`, current timestamp.
4. Click the **args** disclosure → JSON pretty-prints `{ "hello": "world", "ts": <epoch ms> }`.
5. Click again → second entry, ordered newest-first.
6. Click **Clear outbox** → counter resets to 0, list empties.

### Step C — wrapped action lands in both Dexie and the outbox

1. Open `/customers` in a second tab.
2. With **DevTools → Network throttling → Offline**, click any customer's "Reviewed" checkbox in the list (or the side-panel toggle if that's quicker).
3. UI flips immediately to "ticked".
4. Switch back to `/dev/db-smoke`:
   - `outbox` counter has incremented.
   - A `setReviewReceivedAction` entry appears in the entries list, args showing the customer id + `true`.
   - The `customers` list reflects the new `google_review_received: true` on that row.
5. Re-enable network → reload `/customers` → the change persisted server-side (the outbox entry was processed when online — observable as a settled `outbox` counter on the next reload; step 6 will add the drain logic but for step 5 the online-path wrapper fires the server action directly).

### Step D — File guard

1. From DevTools console at `/dev/db-smoke`:
   ```js
   const fd = new FormData();
   fd.set("file", new File(["x"], "test.txt"));
   const { useLocalFirstAction } = await import("/lib/actions/wrap.ts");
   // (or call enqueue path via a one-off test)
   ```
   Quick alternative: any wrapped action whose form had a `<input type="file">` would throw on submit. None do today — this test is theoretical confirmation the throw fires.
2. Verify the thrown error message contains "FormData contains a File. Files cannot be queued in the outbox."

### Step E — agreement status wrapping

1. With network online or offline, navigate to any agreement detail page with the `AgreementStatusActions` component visible.
2. Click any status button (Activate / Pause / Cancel).
3. Pending indicator briefly shows; UI updates.
4. Offline: status visually updates (Dexie row written), outbox entry queued, no server round-trip.
5. Online: server action fires too; on next refresh the server state matches.

### Step F — typecheck + lint clean

1. `npx tsc --noEmit` → exit 0, no output.
2. `npm run lint` → 0 errors, 21 warnings (all pre-existing `react-hooks/set-state-in-effect` items already documented in POST_OFFLINE_FOLLOWUPS.md).

## What this step does NOT do

- **No data-layer changes.** `lib/data/*` untouched. The wrapper writes to Dexie and queues to the outbox; the server action's `lib/data/*` calls fire only when the network round-trip happens (online), unchanged in shape.
- **No sync engine.** Step 6 builds the drain loop, dedup logic, conflict detection, and the multi-write outbox-array support.
- **No full rollout.** Only 4 representative actions are wrapped to prove the pattern. The remaining 6 wrap-classified actions stay raw until you sign off on the pattern.
- **No detail-page conversion.** Step 7 converts detail pages to client components reading from Dexie via `useLiveQuery`. Today's wrapped components still read via server-rendered props.
- **No `completeServiceSheetAction` wrapping.** Deferred to step 6 review per edge case A(c) above.

## Awaiting your review

Step 5 done as code. Typecheck + lint clean.

When ready, tell me to proceed to **step 6: sync engine + multi-write outbox extension + `completeServiceSheetAction` offline path**.
