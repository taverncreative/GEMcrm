"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROUTES } from "@/lib/constants/routes";
import { SyncStatusIndicator } from "@/components/sync/sync-status-indicator";

interface TopbarProps {
  userEmail: string;
}

/**
 * Dark-mode app header. Matches the sidebar palette so the chrome reads
 * as one unit; main content remains light.
 *
 * No mobile hamburger: below `md` the bottom tab bar's "More" sheet is the
 * single overflow path (the slide-in sidebar drawer is desktop-only now).
 * At `md` and up the persistent sidebar carries navigation, so the header
 * stays a thin status/identity strip on every breakpoint.
 */
export function Topbar({ userEmail }: TopbarProps) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(ROUTES.LOGIN);
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink-strong bg-ink px-4 sm:px-6">
      {/* Spacer keeps the status/identity cluster right-aligned on every
          breakpoint (the mobile hamburger that used to sit here is gone —
          "More" in the bottom tab bar is the overflow path now). */}
      <div className="flex-1" />

      {/* Sync status chip + user info + logout */}
      <div className="flex items-center gap-3">
        <SyncStatusIndicator />
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 text-xs font-medium text-brand">
          {userEmail.charAt(0).toUpperCase()}
        </div>
        <span className="hidden text-sm text-gray-300 sm:inline">
          {userEmail}
        </span>
        <button
          onClick={handleLogout}
          className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-ink-soft hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
