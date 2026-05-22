# Post-offline follow-ups

Parking lot for non-offline work surfaced during the PWA conversion. **Nothing here is in scope for the `offline-pwa` branch.** Each entry below is a separate piece of work that can be picked up after the offline rollout lands.

Owner / priority left blank — set when promoting to a real task.

---

## Security: sensitive server actions need `getUser()` revalidation

**Background.** Step 1 of the offline rollout (`proxy.ts` middleware) intentionally swapped `supabase.auth.getUser()` for `supabase.auth.getSession()` — the latter is cookie-only and works offline, the former is a network round-trip to Supabase Auth that hangs / fails with no signal. This was the right call for the middleware (a routing decision, not a security gate), but it means **no layer in the codebase currently does a fresh remote JWT validation**.

`requireUser()` in `lib/auth/require-user.ts` was already using `getSession()` from an earlier perf pass, and every server action calls `requireUser()`. So both layers (middleware + actions) now trust the cookie locally without remote verification.

For *most* actions this is fine — RLS on every Supabase query is the real security boundary, and RLS enforces the JWT signature on every request server-side regardless of what middleware did. An attacker with a stolen cookie can't escalate to a different `auth.uid()`.

But for actions whose blast radius is large or irreversible, a fresh `getUser()` call at the top of the action body is worth the extra ~150–300 ms it costs. These are:

| Action | File | Why sensitive |
|---|---|---|
| `deleteCustomerAction` | `app/(app)/customers/actions.ts` | Cascades to sites, jobs, agreements, invoices — many rows destroyed |
| `changePasswordAction` | `app/(app)/settings/actions.ts` | Account takeover vector if a stolen cookie can change the password |
| `inviteUserAction` | `app/(app)/settings/actions.ts` | Creates a new authenticated user with full app access |
| `markInvoicePaidAction` | `app/(app)/invoices/actions.ts` | Financial state change |
| `sendInvoiceAction` | `app/(app)/invoices/actions.ts` | Sends mail externally + financial state change |

**Recommended fix.** Add a `requireFreshUser()` helper (or inline `supabase.auth.getUser()` at the top of each) and have these 5 actions call it instead of `requireUser()`. Keep the existing `requireUser()` for all other actions — the perf cost matters across 33+ action endpoints, but is irrelevant for these 5 which fire infrequently.

**Not in scope for the offline rollout.** Tracked here so it isn't forgotten.

---

## Schema-types drift risk

`types/database.ts` is hand-written and mirrors the SQL schema in `supabase/setup.sql`. Drift is already visible — `Customer.address` is marked `@deprecated` because it was replaced by structured address columns. Generating types via `supabase gen types typescript` would lock the TS types to the live DB and eliminate this risk class entirely. ~30 min of work + a CI step to regenerate on schema change.

---

## Observability — Sentry not yet wired

`app/global-error.tsx` has a `console.error` call where `Sentry.captureException(error)` should go. README has the wizard install command. Awaiting decision on Sentry account / DSN setup before this can be done.

---

## Pre-existing `react-hooks/set-state-in-effect` warnings

10 documented warnings in `eslint.config.mjs` covering the hydration-safe `mounted` pattern, modal open/reset effects, and error-tracker effects. The `eslint.config.mjs` rule was downgraded to `warn` with an explanatory comment. Could be refactored to event-driven state, but each instance is invasive for marginal benefit. Revisit if the React team makes the rule stricter or removes the downgrade option.

---

## Diagnostic console.error in customer create action

`app/(app)/customers/actions.ts` has temporary diagnostic `console.error("[createCustomerAction] ...")` calls added when debugging the domestic-customer save bug. The bug is fixed; the logs can be stripped now that the cause is known.

---

## `Customer.address` legacy column

Migration 026 introduced structured address (`address_line_1` etc) and the `Customer.address` column is marked `@deprecated`. Code reads still use the legacy column as a fallback for old rows; once any pre-migration-026 customer rows have been edited (or backfilled), the column can be dropped via a migration. Low priority — costs nothing to keep.

---

## Inner-join visibility cascade (soft delete side-effect)

**Surfaced in step 3.** With migration 029, RLS on `customers`, `sites`, `jobs`, `agreements`, `tasks` filters `deleted_at IS NULL` on SELECT. Most list queries in `lib/data/calendar.ts`, `lib/data/jobs.ts`, and `lib/data/invoices.ts` use Postgres foreign-table inner-join syntax via Supabase (`*, site:sites!inner(*, customer:customers!inner(*))`). When the customer (or site) is soft-deleted, the inner join finds no parent row and the entire child row is filtered out of results.

Concretely:
- Soft-delete a customer → all of their jobs disappear from list views (`getAllJobs`, `getJobsToday`, `getUpcomingJobs`, `getRecentJobs`, `getJobsInRange`)
- Soft-delete a site → jobs scoped to that site disappear
- Same effect on calendar views

This is **accepted behaviour for now** (per the step-3 decision call) because in GEM's workflow "deleted customer" usually means "we're not doing business with them any more" and hiding the footprint is the desired UX. The data is still in the DB, restorable via SQL by an admin.

**Refactor when needed:** convert the 10 affected `!inner` joins to outer joins (`!left`) and have UI templates handle `job.site?.customer?.name` null-checks. Add a `?include_deleted=true` query param to admin / historical views if/when that need surfaces.

**Affected files** (~10 query sites):
- `lib/data/calendar.ts:16`
- `lib/data/jobs.ts:74, 115, 137, 164, 187` (and other `!inner` queries throughout)
- `lib/data/invoices.ts:193, 315, 407, 430`

---

## Financial reporting refactor — preserve historical revenue under soft delete

**Surfaced in step 3.** `getRevenueStats` and related financial queries in `lib/data/invoices.ts` (lines 407, 430) inner-join through `customers` to bucket revenue by `customer_type` (commercial vs domestic). If a customer is soft-deleted, their historical invoices stop contributing to revenue figures — retroactively distorting year-to-date totals, committed PMA values, and the revenue widget.

Pre-launch this is harmless (no live accounting data yet). Once live, this should be refactored to either:
- (a) LEFT JOIN through `customers`, defaulting `customer_type` to `'commercial'` or similar when null
- (b) Bake `customer_type` onto `invoices` at insert time so revenue queries don't need the join
- (c) Read from `invoices` directly with no customer join, and group by a denormalised type field

Option (b) is the cleanest — adds one column to `invoices`, fills at insert, removes the join dependency entirely. Non-blocking for the offline rollout.

---

## Customer delete-confirmation dialog wording

**Surfaced in step 3.** The `DeleteCustomerConfirm` UI says things like "will be deleted" / "cannot be undone". With soft delete, the row stays in the DB and can be restored via SQL by an admin. Wording should be updated to reflect this — "will be hidden", "removable from view", "ask admin to restore if needed". Small UI copy update, low effort, low priority.

---

## Restore UI

**De-scoped from offline-pwa rollout** per step-3 decision. Currently restoration is admin-SQL only:

```sql
UPDATE customers SET deleted_at = NULL WHERE id = '<uuid>';
```

A real "Restore" button (and a "Recently deleted" inbox view) would make sense once the operator has accidentally soft-deleted something they wanted back. Low priority — wait for the first request.

---

## Hard-delete admin path (GDPR right-to-erasure)

**De-scoped from offline-pwa rollout** per step-3 decision. Soft delete keeps data forever. UK GDPR's right-to-erasure (where it applies — commercial customers are mostly outside scope; domestic customers might invoke it) requires a path to truly remove a person's data.

The RLS `Authenticated users can delete (hard)` policy (migration 029) is intentionally kept so an admin can `DELETE FROM customers WHERE id = '<uuid>'` via SQL when needed. This cascades through FK relationships and removes the customer + all their child rows.

A nicer UX would be a "Permanently delete" button visible only to admins, with a 2-step confirmation. Low priority — request is rare and SQL is fine for now.
