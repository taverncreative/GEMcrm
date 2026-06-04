"use client";

/**
 * Mobile bottom tab bar (house-style UI refresh, piece 1: navigation).
 *
 * Shown only below `md` — the desktop sidebar (components/sidebar.tsx) is
 * untouched and remains the nav at `md:` and up. Purely additive: this
 * links to existing routes and triggers existing create modals; no
 * routing, create-logic, or screen internals change.
 *
 * Layout: 2 tabs · raised center "+ New" · 2 tabs.
 *   Jobs · Customers · [+ New] · Calendar · More
 *
 * "+ New" opens the create menu (reusing the BookingModal — now offline
 * capable — + InvoiceCreatorModal + Add Customer link). "More" opens an
 * overflow sheet (Dashboard / Documentation / Settings).
 *
 * Tabs are a flat, easily-editable config array — reorder/add by editing
 * TABS (the center "+ New" is injected at the midpoint, so the split
 * follows the array automatically). Forward note: when the dashboard is
 * reworked into a field-primary "Today" home, it'll likely graduate from
 * the More sheet to a top-level tab here.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/constants/routes";
import { BookingModal } from "@/components/bookings/booking-modal";
import { InvoiceCreatorModal } from "@/components/invoices/invoice-creator-modal";

type IconName = "jobs" | "customers" | "calendar" | "more";

type Tab =
  | { key: string; kind: "route"; label: string; href: string; icon: IconName }
  | { key: string; kind: "more"; label: string; icon: IconName };

// Editable tab config. The center "+ New" action is injected at the
// midpoint, so reordering/adding tabs here Just Works.
const TABS: Tab[] = [
  { key: "jobs", kind: "route", label: "Jobs", href: ROUTES.JOBS, icon: "jobs" },
  {
    key: "customers",
    kind: "route",
    label: "Customers",
    href: ROUTES.CUSTOMERS,
    icon: "customers",
  },
  {
    key: "calendar",
    kind: "route",
    label: "Calendar",
    href: ROUTES.CALENDAR,
    icon: "calendar",
  },
  { key: "more", kind: "more", label: "More", icon: "more" },
];

// Overflow destinations under "More".
const MORE_LINKS = [
  { label: "Dashboard", href: ROUTES.DASHBOARD },
  { label: "Documentation", href: ROUTES.REPORTS },
  { label: "Settings", href: ROUTES.SETTINGS },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  // Reuse the sidebar's exact active-state predicate.
  const isRouteActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const isMoreActive = MORE_LINKS.some((l) => isRouteActive(l.href));

  // Inject the center "+ New" at the midpoint of the tab array.
  const mid = Math.ceil(TABS.length / 2);
  const leftTabs = TABS.slice(0, mid);
  const rightTabs = TABS.slice(mid);

  function renderTab(tab: Tab) {
    if (tab.kind === "more") {
      return (
        <button
          key={tab.key}
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          aria-current={isMoreActive ? "page" : undefined}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
            isMoreActive ? "text-brand-darker" : "text-gray-500"
          }`}
        >
          <NavIcon icon={tab.icon} />
          {tab.label}
        </button>
      );
    }
    const active = isRouteActive(tab.href);
    return (
      <Link
        key={tab.key}
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
          active ? "text-brand-darker" : "text-gray-500"
        }`}
      >
        <NavIcon icon={tab.icon} />
        {tab.label}
      </Link>
    );
  }

  return (
    <>
      {/* Fixed bottom bar — mobile only. Hidden at md: where the sidebar
          takes over. Safe-area padding keeps tabs clear of the iOS home
          indicator. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Primary"
      >
        {leftTabs.map(renderTab)}

        {/* Raised center "+ New" */}
        <div className="flex w-16 shrink-0 items-center justify-center">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label="Create new"
            className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg ring-4 ring-white transition-colors hover:bg-brand-dark active:bg-brand-darker"
          >
            <PlusIcon />
          </button>
        </div>

        {rightTabs.map(renderTab)}
      </nav>

      {/* ── "+ New" create menu (reuses existing modals) ──────────── */}
      {createOpen && (
        <Sheet title="Create" onClose={() => setCreateOpen(false)}>
          <SheetButton
            icon={<PlusIcon />}
            label="New Booking"
            tone="brand"
            onClick={() => {
              setCreateOpen(false);
              setBookingOpen(true);
            }}
          />
          <SheetButton
            icon={<InvoiceIcon />}
            label="New Invoice"
            onClick={() => {
              setCreateOpen(false);
              setInvoiceOpen(true);
            }}
          />
          <SheetLink
            icon={<UserPlusIcon />}
            label="Add Customer"
            href={ROUTES.CUSTOMERS_NEW}
            onNavigate={() => setCreateOpen(false)}
          />
        </Sheet>
      )}

      {/* ── "More" overflow sheet ─────────────────────────────────── */}
      {moreOpen && (
        <Sheet title="More" onClose={() => setMoreOpen(false)}>
          {MORE_LINKS.map((l) => (
            <SheetLink
              key={l.href}
              label={l.label}
              href={l.href}
              onNavigate={() => setMoreOpen(false)}
            />
          ))}
        </Sheet>
      )}

      {/* Create modals — reused unchanged. */}
      <BookingModal open={bookingOpen} onClose={() => setBookingOpen(false)} />
      <InvoiceCreatorModal
        open={invoiceOpen}
        onClose={() => setInvoiceOpen(false)}
      />
    </>
  );
}

// ─── Bottom-sheet primitives (mobile create/overflow menus) ─────────
// Mirrors the bottom-sheet pattern from QuickActions; kept local so the
// bottom nav is self-contained. Could be extracted to a shared sheet
// component in a later pass.

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col py-2">{children}</div>
      </div>
    </div>
  );
}

function SheetButton({
  icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "brand";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 items-center gap-3 px-5 py-3 text-left text-base font-medium text-gray-900 active:bg-gray-50"
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full ${
          tone === "brand"
            ? "bg-brand-soft text-brand-darker"
            : "bg-gray-100 text-gray-500"
        }`}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

function SheetLink({
  icon,
  label,
  href,
  onNavigate,
}: {
  icon?: React.ReactNode;
  label: string;
  href: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex min-h-12 items-center gap-3 px-5 py-3 text-left text-base font-medium text-gray-900 active:bg-gray-50"
    >
      {icon && (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          {icon}
        </span>
      )}
      {label}
    </Link>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────
// Tab-bar glyphs mirror the sidebar's set (components/sidebar.tsx).

function NavIcon({ icon }: { icon: IconName }) {
  const cls = "h-6 w-6";
  switch (icon) {
    case "jobs":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
      );
    case "customers":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
        </svg>
      );
    case "calendar":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
      );
    case "more":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      );
  }
}

function PlusIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
    </svg>
  );
}
