"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROUTES } from "@/lib/constants/routes";
import { SyncStatusIndicator } from "@/components/sync/sync-status-indicator";

interface TopbarProps {
  userEmail: string;
  onToggleSidebar: () => void;
}

/**
 * Dark-mode app header. Matches the sidebar palette so the chrome reads
 * as one unit; main content remains light.
 */
export function Topbar({ userEmail, onToggleSidebar }: TopbarProps) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(ROUTES.LOGIN);
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink-strong bg-ink px-4 sm:px-6">
      {/* Mobile hamburger */}
      <button
        onClick={onToggleSidebar}
        className="rounded-lg p-2 text-gray-400 hover:bg-ink-soft hover:text-gray-200 md:hidden"
        aria-label="Open menu"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
          />
        </svg>
      </button>

      <div className="md:flex-1" />

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
