"use client";

import { useState } from "react";
import { BookingModal } from "@/components/bookings/booking-modal";
import { useIsOnline } from "@/lib/hooks/use-is-online";

interface StartJobButtonProps {
  label?: string;
  /** "primary" renders a filled emerald button, "outline" an outline variant. */
  variant?: "primary" | "outline";
}

export function StartJobButton({
  label = "New Booking",
  variant = "primary",
}: StartJobButtonProps) {
  const [open, setOpen] = useState(false);
  // Online-only: createQuickBookingAction is multi-entity (creates a
  // job + optionally a site / customer in a single transaction). The
  // multi-entity entity_ids[] sync-engine guard hasn't shipped, so
  // wrapping isn't safe — the modal stays online-only. Disabling the
  // entry point prevents the modal opening into a broken submit.
  const online = useIsOnline();

  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors";
  const enabledCls =
    variant === "primary"
      ? `${base} bg-brand text-white shadow-sm hover:bg-brand-dark`
      : `${base} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`;
  const cls = online
    ? enabledCls
    : `${base} cursor-not-allowed bg-gray-200 text-gray-400`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!online}
        title={online ? undefined : "Online required"}
        className={cls}
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
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        {label}
      </button>
      <BookingModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
