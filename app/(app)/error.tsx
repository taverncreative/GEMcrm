"use client";

/**
 * (app) route group error boundary.
 *
 * Two distinct screens depending on what caused the throw:
 *
 *   1. **Offline screen** — when `useIsOnline() === false`, OR (as a
 *      secondary signal) when the error message looks network-shaped.
 *      Shown for all unconverted RSC pages (dashboard, reports,
 *      settings, calendar, agreements) that throw `TypeError: fetch
 *      failed` server-side when the field tech opens them with no
 *      signal. The two converted lists (customers + jobs) read from
 *      Dexie and never reach this boundary.
 *
 *   2. **Generic error** — the original "Something went wrong" panel.
 *      Fallback for any error that ISN'T offline-related: real bugs,
 *      validation failures, unhandled state.
 *
 * Why `useIsOnline()` is the PRIMARY signal (not the error text):
 *
 *   Next.js sanitises server-component error messages in production
 *   builds — the client error boundary receives a `digest` and a
 *   generic "An error occurred in the Server Components render" but
 *   NOT the original "TypeError: fetch failed" string. So a
 *   message-based check is unreliable outside dev. Branching on
 *   `useIsOnline()` is the only check that works in both modes:
 *
 *     - Cold offline: navigator.onLine === false → screen shows.
 *     - Wi-Fi on but Supabase unreachable: the sync engine's
 *       `serverReachable` flips to false on first failed pull (15s
 *       cadence) and useIsOnline() reflects that.
 *
 *   `isNetworkError(error)` is kept as a secondary signal for the
 *   rare in-dev case where useIsOnline() === true but a specific
 *   fetch threw (e.g. CORS, single-endpoint outage). False positives
 *   are not harmful — at worst a server-side bug gets shown as
 *   "offline" instead of "something went wrong". The retry button
 *   recovers the same way either way.
 *
 * The `reset()` function is Next.js's mechanism for re-rendering the
 * failing tree. Pressing the Retry button re-attempts the original
 * fetch; if connectivity has recovered (or the server bug was
 * transient), the page renders normally. If not, the boundary
 * re-engages.
 */

import { useEffect } from "react";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { isNetworkError } from "@/lib/sync/is-network-error";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const online = useIsOnline();
  // Log to the console so we can still diagnose the underlying error
  // in dev / when the offline screen masks a real bug. The digest is
  // the only useful handle in production builds.
  useEffect(() => {
    console.error("[GemCRM:App] Error:", error);
  }, [error]);

  const treatAsOffline = !online || isNetworkError(error);

  if (treatAsOffline) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <svg
              className="h-6 w-6 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.364 5.636 5.636 18.364m12.728 0L5.636 5.636M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            You&apos;re offline
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            This page needs a connection to load. Your job and customer
            lists still work offline — go back and try those.
          </p>
          <button
            onClick={reset}
            className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          There was a problem loading this page.
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
