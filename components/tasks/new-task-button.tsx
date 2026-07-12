"use client";

import { useState } from "react";
import { NewTaskModal } from "@/components/tasks/new-task-modal";

interface NewTaskButtonProps {
  label?: string;
  /** "primary" renders a filled brand button, "outline" an outline variant. */
  variant?: "primary" | "outline";
}

export function NewTaskButton({
  label = "New task",
  variant = "outline",
}: NewTaskButtonProps) {
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
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        {label}
      </button>
      {open && <NewTaskModal onClose={() => setOpen(false)} />}
    </>
  );
}
