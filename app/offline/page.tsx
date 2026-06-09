"use client";

import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";

/**
 * Offline fallback shell — served by the service worker (public/sw.js) when
 * a navigation can't be satisfied from cache offline (a route never visited
 * online). Precached at SW install, and PUBLIC (excluded from the proxy
 * auth matcher) so it's always cacheable regardless of session state.
 *
 * Visuals mirror the (app) offline panel (app/(app)/error.tsx) so the two
 * read as one. error.tsx itself is left unchanged.
 *
 * Not a dead end: the bottom nav links to the offline-capable sections
 * (Jobs / Customers, both Dexie-backed via useLiveQuery). They're plain
 * <Link> anchors — so a tap navigates even if this fallback page never
 * hydrated — and the SW serves the cached section (no dino) for anything
 * visited online. Styling matches components/bottom-nav.tsx; shown on all
 * viewports because the offline shell has no sidebar.
 */

const TRY_AGAIN_CLS =
  "mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white " +
  "outline-none transition-colors duration-75 " +
  "hover:bg-gray-800 " +
  "active:bg-black active:scale-[0.98] " +
  "focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col">
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
          <h1 className="text-lg font-semibold text-gray-900">You&apos;re offline</h1>
          <p className="mt-2 text-sm text-gray-500">
            This section hasn&apos;t been opened on this device yet, so it
            isn&apos;t available offline. Your Jobs and Customers lists work
            offline — head to those below, or try again once you have signal.
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

      {/* Bottom nav → offline-ready sections. Plain anchors (work unhydrated). */}
      <nav
        className="flex items-stretch border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]"
        aria-label="Offline sections"
      >
        <OfflineTab href={ROUTES.JOBS} label="Jobs" icon={<JobsIcon />} />
        <OfflineTab
          href={ROUTES.CUSTOMERS}
          label="Customers"
          icon={<CustomersIcon />}
        />
      </nav>
    </div>
  );
}

function OfflineTab({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-brand-darker"
    >
      {icon}
      {label}
    </Link>
  );
}

// Glyphs mirror components/bottom-nav.tsx so the offline nav matches.
function JobsIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function CustomersIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}
