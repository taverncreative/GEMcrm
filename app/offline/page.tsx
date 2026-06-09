"use client";

/**
 * Offline fallback shell — served by the service worker (public/sw.js) when
 * a navigation can't be satisfied from cache offline (a route never visited
 * online). Precached at SW install, and PUBLIC (excluded from the proxy
 * auth matcher) so it's always cacheable regardless of session state.
 *
 * Visuals mirror the (app) offline panel (app/(app)/error.tsx) so the two
 * read as one. error.tsx itself is left unchanged.
 *
 * "Try again" reloads rather than reset()ing a boundary — this is a
 * standalone route, not an error boundary. Once back online (or once the
 * target route has been cached), the reload resolves to the real page.
 */

const TRY_AGAIN_CLS =
  "mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white " +
  "outline-none transition-colors duration-75 " +
  "hover:bg-gray-800 " +
  "active:bg-black active:scale-[0.98] " +
  "focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
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
        <h1 className="text-lg font-semibold text-gray-900">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-gray-500">
          This section hasn&apos;t been opened on this device yet, so it
          isn&apos;t available offline. Your Jobs and Customers lists work
          offline — head back to those, or try again once you have signal.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={TRY_AGAIN_CLS}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
