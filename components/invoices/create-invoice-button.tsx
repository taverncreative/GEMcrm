"use client";

import { useState } from "react";
import { InvoiceCreatorModal } from "./invoice-creator-modal";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import type { Customer } from "@/types/database";

interface CreateInvoiceButtonProps {
  label?: string;
  variant?: "primary" | "outline";
  presetCustomer?: Customer | null;
  presetJobId?: string | null;
  presetAmount?: number | null;
  presetDescription?: string | null;
}

// `createInvoiceDraftAction` / `sendInvoiceAction` are skip-classified
// (server-side PDF generation + Resend email). Gate the button itself —
// don't open the modal when offline; the operator would just fill it
// in to fail at submit. The tooltip explains rather than letting them
// reach for it blindly.
export function CreateInvoiceButton({
  label = "Create Invoice",
  variant = "outline",
  presetCustomer = null,
  presetJobId = null,
  presetAmount = null,
  presetDescription = null,
}: CreateInvoiceButtonProps) {
  const [open, setOpen] = useState(false);
  const online = useIsOnline();

  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-75 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
  const cls =
    variant === "primary"
      ? `${base} bg-brand text-white shadow-sm hover:bg-brand-dark`
      : `${base} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`;

  return (
    <>
      <button
        type="button"
        onClick={() => online && setOpen(true)}
        disabled={!online}
        title={!online ? "Needs internet — invoicing is online-only" : undefined}
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
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          />
        </svg>
        {label}
      </button>
      <InvoiceCreatorModal
        open={open}
        onClose={() => setOpen(false)}
        presetCustomer={presetCustomer}
        presetJobId={presetJobId}
        presetAmount={presetAmount}
        presetDescription={presetDescription}
      />
    </>
  );
}
