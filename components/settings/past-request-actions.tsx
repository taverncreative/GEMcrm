"use client";

/**
 * Delete controls for the Settings past-requests list: a per-row delete and
 * a "Clear all", each behind a small confirm dialog (the app's established
 * destructive-action pattern — see DeleteJobConfirm — pared down: no impact
 * preview, because there is nothing downstream of a feedback row).
 *
 * These are HARD deletes: feature_requests has no deleted_at, and the row
 * is only the operator's local copy — the request itself already went to
 * the developer inbox and Spotlight, so the copy reassures on exactly that.
 *
 * ONLINE-ONLY, same gate as the feedback form: no Dexie mirror, no outbox,
 * so an offline click would reach nothing. Buttons disable when offline.
 *
 * No revalidatePath anywhere in this flow (a broad revalidate purges the
 * whole client router cache and stampedes re-prefetches — the slow-repeat-
 * submits bug). On success we router.refresh(), which re-renders only the
 * Settings page and its list.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearFeatureRequestsAction,
  deleteFeatureRequestAction,
} from "@/app/(app)/settings/actions";
import { wrapDirectCallGracefully } from "@/lib/actions/graceful";
import { useIsOnline } from "@/lib/hooks/use-is-online";

// Transport-layer failures (connection dropping mid-click) resolve to a
// {success:false, message} the dialog already renders, instead of throwing
// out of the transition and hanging it — same safety net as the job delete.
const wrappedDelete = wrapDirectCallGracefully(deleteFeatureRequestAction);
const wrappedClear = wrapDirectCallGracefully(clearFeatureRequestsAction);

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  error: string | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  pendingLabel,
  error,
  isPending,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={isPending ? undefined : onCancel}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl"
      >
        <div className="px-6 pt-6">
          <h2 className="text-center text-lg font-semibold text-gray-900">
            {title}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-500">{body}</p>
          {error && (
            <p className="mt-3 text-center text-sm text-red-600">{error}</p>
          )}
        </div>

        <div className="mt-6 flex gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Bin icon button on each past-request row. */
export function DeleteRequestButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const online = useIsOnline();
  const router = useRouter();

  function handleClose() {
    setError(null);
    setOpen(false);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await wrappedDelete(id);
      if (!res.success) {
        setError(res.message ?? "Failed to delete request");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!online}
        title={online ? "Delete this request" : "You're offline"}
        aria-label="Delete this request"
        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
          />
        </svg>
      </button>

      {open && (
        <ConfirmDialog
          title="Delete this request?"
          body="Removes it from this list for good. It has already reached the developer, so nothing is unsent."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          error={error}
          isPending={isPending}
          onCancel={handleClose}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}

/** "Clear all" control next to the Past requests heading. */
export function ClearRequestsButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const online = useIsOnline();
  const router = useRouter();

  function handleClose() {
    setError(null);
    setOpen(false);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await wrappedClear();
      if (!res.success) {
        setError(res.message ?? "Failed to clear requests");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!online}
        title={online ? undefined : "You're offline"}
        className="text-xs font-medium text-gray-400 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-gray-400"
      >
        Clear all
      </button>

      {open && (
        <ConfirmDialog
          title="Clear all past requests?"
          body="Removes every request from this list for good. They have already reached the developer, so nothing is unsent."
          confirmLabel="Clear all"
          pendingLabel="Clearing…"
          error={error}
          isPending={isPending}
          onCancel={handleClose}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}
