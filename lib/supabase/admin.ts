import { createClient } from "@supabase/supabase-js";

/**
 * Supabase **admin** client — uses the service role key, bypasses RLS,
 * and can perform privileged operations (creating/inviting users,
 * deleting rows regardless of policy, etc).
 *
 * ⚠️ Server-only. Never import this from a `"use client"` file. The
 * service role key would be bundled into the browser if you did.
 *
 * Currently used by:
 *   - Settings → Invite teammate (`auth.admin.inviteUserByEmail`)
 *
 * The client is a fresh instance per call (no session, no cookies — we
 * don't want admin actions to be tied to any particular signed-in user).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  }
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured — required for admin operations like inviting users"
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
