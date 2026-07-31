"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteReportAction } from "@/app/(app)/reports/actions";
import { wrapDirectCallGracefully } from "@/lib/actions/graceful";

// Wrap so a transport-layer failure resolves to a `{success:false}` shape the
// error rendering understands, instead of throwing out of the transition and
// hanging the dialog (same safety net as job / customer delete).
const wrappedDeleteReport = wrapDirectCallGracefully(deleteReportAction);

interface DeleteReportButtonProps {
  reportId: string;
  /** Row title, e.g. "Service Sheet 00091" — named in the confirm copy. */
  title: string;
  /** The sheet's job was soft-deleted (or is missing). Changes the copy:
   *  there is no job left to go back to, so this really is the last copy in
   *  the app. */
  jobDeleted?: boolean;
}

/**
 * Delete a service sheet from the Documents list — the only delete path a
 * report has.
 *
 * Two-step by design. A service sheet is a signed record of work performed,
 * which puts it a clear notch above the other row actions in stakes, so the
 * confirm spells out what it is before it goes. It is still a SOFT delete
 * (the row is stamped, the PDF stays in the bucket), so the copy stays
 * "Remove" / "no longer appear" — never "permanently" or "forever".
 *
 * Online-only, like the sibling row actions.
 */
export function DeleteReportButton({
  reportId,
  title,
  jobDeleted,
}: DeleteReportButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await wrappedDeleteReport(reportId);
      if (!res.success) {
        setError(res.message ?? "Failed to delete service sheet");
        return;
      }
      setConfirming(false);
      // The action deliberately skips revalidatePath (prefetch stampede), so
      // refresh just this route's payload to drop the row.
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-700"
      >
        Delete
      </button>

      {confirming && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            aria-hidden="true"
          />

          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="px-6 pt-6">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <svg
                  className="h-5 w-5 text-red-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              </div>
              <h2 className="text-center text-lg font-semibold text-gray-900">
                Delete this service sheet?
              </h2>
              <p className="mt-2 text-center text-sm text-gray-500">
                <span className="font-medium text-gray-700">{title}</span> will
                no longer appear in Documents.
              </p>

              <div className="mt-4 space-y-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
                <p>
                  This is a{" "}
                  <span className="font-semibold">
                    signed record of work performed
                  </span>
                  , not a draft. It may be the only evidence that this visit
                  took place.
                </p>
                {jobDeleted && (
                  <p>
                    The job behind this sheet has already been deleted, so
                    nothing else in the app records this visit.
                  </p>
                )}
              </div>

              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            </div>

            <div className="mt-6 flex gap-2 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setError(null);
                }}
                disabled={isPending}
                className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Delete sheet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
