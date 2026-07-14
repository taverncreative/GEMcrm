"use client";

import { useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import { BookingModal } from "@/components/bookings/booking-modal";

/**
 * Persistent header actions: New Booking · Add Customer.
 *
 * Desktop (≥ sm): inline buttons. Familiar, scannable.
 * Mobile (< sm): a single brand-coloured "+" button (≥44×44px) that
 * opens a bottom slide-up sheet. The sheet rows are full-width and ≥48px
 * tall — every action is a thumb-friendly tap, and the header stays
 * uncluttered so the customer/page name has room to breathe.
 *
 * No invoice entry here: invoicing is job-driven (multi-select on the
 * Jobs list → Completed tab), with the customer side panel keeping the
 * ad-hoc escape hatch.
 *
 * The Booking modal is reused unchanged; the sheet just triggers the
 * same state setter.
 */
export function QuickActions() {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [serviceSheetOpen, setServiceSheetOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Open a modal from the mobile sheet: close the sheet at the same time
  // so we don't leave a stale layer underneath the modal. Doing this in
  // the handler (rather than a useEffect on the modal-open flags) keeps
  // it a single render and satisfies react-hooks/set-state-in-effect.
  function openBookingFromSheet() {
    setSheetOpen(false);
    setBookingOpen(true);
  }

  function openServiceSheetFromSheet() {
    setSheetOpen(false);
    setServiceSheetOpen(true);
  }

  return (
    <>
      {/* ── Desktop row ──────────────────────────────────────── */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        <button
          type="button"
          onClick={() => setBookingOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
        >
          <PlusIcon />
          New Booking
        </button>
        <button
          type="button"
          onClick={() => setServiceSheetOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <SheetIcon />
          New service sheet
        </button>
        <Link
          href={ROUTES.CUSTOMERS_NEW}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <UserPlusIcon />
          Add Customer
        </Link>
      </div>

      {/* ── Mobile "+" trigger ───────────────────────────────── */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Quick actions"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white shadow-sm transition-colors hover:bg-brand-dark active:bg-brand-darker sm:hidden"
      >
        <PlusIcon />
      </button>

      {/* ── Mobile bottom sheet ─────────────────────────────── */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Quick actions
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col py-2">
              <button
                type="button"
                onClick={openBookingFromSheet}
                className="flex min-h-12 items-center gap-3 px-5 py-3 text-left text-base font-medium text-gray-900 active:bg-gray-50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand-darker">
                  <PlusIcon />
                </span>
                New Booking
              </button>
              <button
                type="button"
                onClick={openServiceSheetFromSheet}
                className="flex min-h-12 items-center gap-3 px-5 py-3 text-left text-base font-medium text-gray-900 active:bg-gray-50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                  <SheetIcon />
                </span>
                New service sheet
              </button>
              <Link
                href={ROUTES.CUSTOMERS_NEW}
                onClick={() => setSheetOpen(false)}
                className="flex min-h-12 items-center gap-3 px-5 py-3 text-left text-base font-medium text-gray-900 active:bg-gray-50"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                  <UserPlusIcon />
                </span>
                Add Customer
              </Link>
            </div>
          </div>
        </div>
      )}

      <BookingModal open={bookingOpen} onClose={() => setBookingOpen(false)} />
      <BookingModal
        open={serviceSheetOpen}
        intent="service-sheet"
        onClose={() => setServiceSheetOpen(false)}
      />
    </>
  );
}

function SheetIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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
