import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants/routes";

/**
 * Returns the current user, or redirects to /login if there isn't one.
 *
 * Uses `getSession()` (cookie read, no network) rather than `getUser()`
 * (JWT validation round-trip to Supabase auth servers). This is safe
 * because `proxy.ts` already validates the JWT with `getUser()` on
 * every request before any server code runs. By the time `requireUser`
 * executes, we know the cookie is valid.
 *
 * Difference matters: `getUser()` is a network call (~150-300ms when
 * Vercel + Supabase are in different regions, ~30-80ms in the same
 * region). Every server action that calls `requireUser` would pay
 * that cost. Reading the session from the cookie is sub-millisecond.
 */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    const headersList = await headers();
    const pathname = headersList.get("x-next-pathname") ?? headersList.get("x-invoke-path") ?? "";
    const loginUrl = pathname && pathname !== ROUTES.LOGIN
      ? `${ROUTES.LOGIN}?next=${encodeURIComponent(pathname)}`
      : ROUTES.LOGIN;

    redirect(loginUrl);
  }

  return session.user;
}
