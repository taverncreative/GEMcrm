"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { deleteQuoteAction } from "@/app/(app)/quotes/actions";

/**
 * Delete a quote from the list. Two-step inline confirm (no blocking dialog),
 * online-only (the delete goes through a server RPC), and on success a scoped
 * router.refresh() refetches the list — no revalidatePath, so no router-cache
 * stampede. Mirrors the agreement discard control.
 */
export function DeleteQuoteButton({
  quoteId,
  label,
}: {
  quoteId: string;
  label: string;
}) {
  const router = useRouter();
  const online = useIsOnline();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteQuoteAction(quoteId);
      if (res.success) {
        router.refresh();
      } else {
        setError(res.message ?? "Couldn't delete the quote.");
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-gray-500">Delete {label}?</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={isPending || !online}
          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={!online}
        title={online ? "Delete quote" : "Delete needs a connection"}
        className="rounded-lg px-2 py-1 text-xs font-medium text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Delete
      </button>
    </span>
  );
}
