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
