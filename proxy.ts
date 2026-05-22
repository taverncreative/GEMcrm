import { type NextRequest, NextResponse } from "next/server";
import { createProxyClient } from "@/lib/supabase/proxy-client";
import { ROUTES } from "@/lib/constants/routes";

export async function proxy(request: NextRequest) {
  const { supabase, response } = createProxyClient(request);
  const { pathname } = request.nextUrl;

  // ─── Auth check (cookie-only, offline-safe) ─────────────────────────
  //
  // We use `getSession()` not `getUser()` here so this middleware does
  // not block when the device is offline.
  //
  //   - `getSession()` reads the JWT directly from the request cookie.
  //     No network call. Sub-millisecond. Works without signal.
  //   - `getUser()` would also send the JWT to Supabase Auth servers
  //     for fresh remote validation. That's a 100-300 ms round-trip
  //     even online, and on a flaky/no-signal connection it hangs or
  //     fails — in which case the user gets redirected to /login even
  //     though they have a perfectly valid cached session. Fatal for
  //     a PWA installed in the field.
  //
  // SECURITY TRADE-OFF — please read before changing this:
  //
  //   By trusting the cookie locally we accept that a stolen or
  //   tampered auth cookie won't be caught at the middleware layer.
  //   The JWT signature is enforced by Supabase on every API call we
  //   make (RLS gates every read/write against `auth.uid()`), so the
  //   actual blast radius is limited — an attacker with a stolen
  //   cookie can't fabricate a different user id.
  //
  //   For genuinely sensitive operations (delete a customer with
  //   cascading deletes, change password, invite a teammate, anything
  //   that affects billing) the corresponding server action SHOULD
  //   call `supabase.auth.getUser()` directly to force a fresh
  //   remote JWT validation. That's defence-in-depth: middleware is
  //   the fast filter; the action is the strict gate. The currently
  //   `requireUser()` helper uses `getSession()` too; promoting it to
  //   `getUser()` per-call site is tracked in the offline-pwa rollout.
  //
  //   This is the pattern Supabase themselves use for PWA / offline
  //   support — see https://supabase.com/docs/guides/auth/server-side
  //   ("Reading the user"): getSession() in middleware is acceptable
  //   for routing decisions, getUser() must be called before trusting
  //   the user identity for any operation with security implications.
  //
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (process.env.NODE_ENV === "development") {
    console.log(`[proxy] ${pathname} | user: ${user?.email ?? "none"}`);
  }

  // Unauthenticated user on a protected route → redirect to login
  if (!user && pathname !== ROUTES.LOGIN) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = ROUTES.LOGIN;

    if (process.env.NODE_ENV === "development") {
      console.log(`[proxy] Redirecting unauthenticated user to ${ROUTES.LOGIN}`);
    }

    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user on login page → redirect to dashboard
  if (user && pathname === ROUTES.LOGIN) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = ROUTES.DASHBOARD;

    if (process.env.NODE_ENV === "development") {
      console.log(`[proxy] Redirecting authenticated user to ${ROUTES.DASHBOARD}`);
    }

    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  // Excludes:
  //   _next/static, _next/image   — Next.js build assets
  //   favicon.ico, icon.png        — favicons
  //   logo/.*                      — brand assets in /public/logo
  //   auth/callback                — Supabase auth redirect
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|logo/|auth/callback).*)",
  ],
};
