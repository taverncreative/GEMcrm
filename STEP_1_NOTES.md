# Step 1 — Auth middleware fix (notes)

Branch: `offline-pwa`
Commit: see HEAD on this branch — message starts `step 1: switch middleware to getSession for offline auth support`.

## What changed

**One file**: `proxy.ts` at the repo root (Next 16's renamed middleware file).

- Removed the call to `supabase.auth.getUser()` — this was a network round-trip to Supabase Auth servers to validate the JWT freshly. Fatal for offline use: an offline device with a valid cached cookie still got redirected to `/login` because the validation request failed.
- Replaced with `supabase.auth.getSession()` — reads the JWT directly from the request cookie. No network. Sub-millisecond. Works without signal.
- Added a ~30-line comment block above the call documenting:
  - (a) why we use `getSession` here (offline support — no network call)
  - (b) that `getSession` trusts the cookie locally
  - (c) that sensitive server actions should call `getUser()` themselves for revalidation (defence in depth)
  - (d) reference to the Supabase pattern this follows — https://supabase.com/docs/guides/auth/server-side ("Reading the user"): `getSession()` is acceptable for routing decisions in middleware, `getUser()` must be called before trusting the user identity for any operation with security implications.

This matches the pattern `requireUser()` already uses (in `lib/auth/require-user.ts`) — the middleware was the last place still doing the round-trip.

## Verification

The project has **no `npm test` script** (confirmed via `package.json:5-10` — only `dev`, `build`, `start`, `lint`, `typecheck`). I substituted the equivalent gate:

| Check | Command | Result |
|---|---|---|
| Type safety | `npx tsc --noEmit` | ✅ clean — no errors |
| Lint (changed file + neighbours) | `npx eslint proxy.ts lib/supabase/proxy-client.ts lib/supabase/server.ts lib/auth/require-user.ts` | ✅ clean — no warnings or errors |
| Production build | `npm run build` | ✅ all 22 routes generated, `Proxy (Middleware)` detected, no errors |

The `Proxy (Middleware)` line in the build output confirms Next 16 still recognises `proxy.ts` as middleware after the change — the change was internal to the function body, not the file conventions.

## Verifying no other blocking middleware paths

Grepped the repo for other middleware-shaped files: `find -name "middleware.ts" -o -name "proxy.ts"` — only `proxy.ts` exists (confirmed). `createProxyClient` in `lib/supabase/proxy-client.ts` was inspected: it only constructs the Supabase client and wires the cookie store; it makes no network call itself. The only remaining `await` in `proxy.ts` is now `supabase.auth.getSession()` which is local-only.

## Acceptance criteria

| Criterion | Status |
|---|---|
| `next build` passes | ✅ |
| Manually test login flow online (log in, navigate, log out) | ⚠️ Code change is a pure swap of a single SDK call. I can't run a live browser session from here. The change does not alter the redirect logic or the cookie-write paths — the only difference is *how* the user is retrieved. **Awaiting your hands-on test on a deployed build of this branch.** |
| Simulate offline with valid session cookie present, middleware does NOT redirect | ⚠️ Same — needs a hands-on check. `getSession()` does no network so an offline device with a still-valid cookie will now pass straight through. |
| No test regressions | ✅ No test suite exists; typecheck + lint + build all clean. |

## Surprises / things to flag

1. **`requireUser()` was already using `getSession()`.** That happened in an earlier perf pass before this offline work started. So step 1 brings the middleware in line with what `requireUser` was already doing — the codebase had asymmetric trust between middleware and server-action layers, and the offline work makes both layers consistently cookie-trusting.

2. **No server action currently calls `getUser()` for fresh JWT validation.** The comment block in `proxy.ts` references this as the defence-in-depth pattern, but no call site has been promoted to it yet. Worth a follow-up: identify the genuinely sensitive actions (`deleteCustomerAction`, `changePasswordAction`, `inviteUserAction`, `markInvoicePaidAction`, `sendInvoiceAction`) and add an explicit `getUser()` revalidation at their top. **Not in scope for step 1 — flagging for the rollout plan.**

3. **Build output unchanged.** No new dependencies, no bundle change. The middleware Edge function will be marginally faster (no Auth-server round trip) — a side benefit beyond the offline use case.

4. **Cookie refresh behaviour.** `getSession()` does not refresh the access token. If the access token in the cookie has expired but the refresh token is still valid, `getSession()` will still return the session (it just decodes what's in the cookie). The first authenticated Supabase query made by server-side code will trigger a refresh via the SDK's own background mechanism. This works fine online; offline it means an "expired" access token still admits the user to the app — which is exactly what we want for offline-first. The trade-off is that a long-offline user accumulates an effectively expired session that gets refreshed lazily on next online action.

## Files touched

- `proxy.ts` — modified (auth call + comment block)
- `STEP_1_NOTES.md` — created (this file)

No other files modified. No dependencies added. No env vars added.

## Manual test checklist for reviewer

When you have a deployed build of this branch:

1. **Online happy path**: log out, log in, navigate to `/dashboard`, `/customers`, `/jobs`, log out via Settings. Confirm all redirects behave as before.
2. **Online cookie-stale path**: in DevTools → Application → Cookies, delete just the `sb-*-auth-token` cookie. Reload. Should redirect to `/login` (because `getSession()` finds no session in the cookie). Confirm no hang.
3. **Offline with valid session**: log in normally. Open DevTools → Network → Throttle to "Offline". Reload `/dashboard`. **Expected: page does NOT redirect to /login.** RSC will fail to render fresh data (the data layer still hits the network) — that's fine for step 1. The middleware itself should let the request through without redirect.
4. **Offline with no session cookie**: in an incognito window with no session, throttle to Offline, navigate to `https://gemcrm.vercel.app/dashboard`. Should redirect to `/login`. Confirms the redirect logic still fires; offline tolerance only applies to users with a valid cached cookie.

## Awaiting your review

Step 1 done. Per the plan, stopping here. Step 2 (client-generated UUIDs in `lib/data/*.ts` insert calls) is teed up but not started.
