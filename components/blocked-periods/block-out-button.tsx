"use client";

import { useState } from "react";
import { BlockOutModal } from "@/components/blocked-periods/block-out-modal";

interface BlockOutButtonProps {
  label?: string;
  /** "primary" renders a filled brand button, "outline" an outline variant. */
  variant?: "primary" | "outline";
}

export function BlockOutButton({
  label = "Block out days",
  variant = "outline",
}: BlockOutButtonProps) {
  const [open, setOpen] = useState(false);

  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors";
  const cls =
    variant === "primary"
      ? `${base} bg-brand text-white shadow-sm hover:bg-brand-dark`
      : `${base} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cls}>
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
            d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
        {label}
      </button>
      {open && <BlockOutModal onClose={() => setOpen(false)} />}
    </>
  );
}
