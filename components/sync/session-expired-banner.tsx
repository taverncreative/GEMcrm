"use client";

/**
 * Banner that appears when sync hits a 401/403.
 *
 * Surfaced from the global app shell so any in-app screen shows it
 * regardless of route. Auto-clears when the operator returns from the
 * login flow (the post-login hook runs `clearAuthExpired()` + triggers
 * a fresh sync — see `lib/sync/post-login.ts` from commit 8).
 *
 * The dismiss button manually clears the flag without re-logging-in.
 * Useful for the rare case where the engineer wants to stop seeing
 * the warning while they finish a local-only task — but they'll see
 * it again on the next sync attempt that re-hits the same 401.
 */

import Link from "next/link";
import { useSyncStatus, clearAuthExpired } from "@/lib/sync/status";
import { ROUTES } from "@/lib/constants/routes";

export function SessionExpiredBanner() {
  const status = useSyncStatus();
  if (!status.authExpired) return null;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <div className="flex items-center gap-2">
        <svg
          className="h-4 w-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m0 3v.008m0-9.75c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9Z"
          />
        </svg>
        <span>
          <strong className="font-semibold">Session expired</strong> — sign
          in to continue syncing your offline changes. Local data is
          safe.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={ROUTES.LOGIN}
          className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
        >
          Sign in
        </Link>
        <button
          type="button"
          onClick={() => clearAuthExpired()}
          aria-label="Dismiss"
          className="rounded-md p-1 text-amber-700 hover:bg-amber-100"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18 18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
