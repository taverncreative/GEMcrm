"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteSiteAction,
  getSiteDeleteImpactAction,
} from "@/app/(app)/sites/[id]/actions";
import type { SiteDeleteImpact } from "@/lib/data/sites";
import { wrapDirectCallGracefully } from "@/lib/actions/graceful";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { ROUTES } from "@/lib/constants/routes";
import { db } from "@/lib/db";

// Same safety net as the customer and job deletes: a transport-layer
// failure resolves to a `{success:false}` shape the error rendering already
// understands, instead of throwing out of the transition and hanging the
// dialog.
const wrappedDeleteSite = wrapDirectCallGracefully(deleteSiteAction);

interface DeleteSiteButtonProps {
  siteId: string;
  /** A short human label for the site, e.g. "12 Mill Lane". */
  siteLabel: string;
  /** Where to land afterwards — the site's customer. */
  customerId: string;
}

/**
 * Delete-a-site: trigger button plus its confirm dialog.
 *
 * Lives on the site detail page (not the customer panel's site list): this
 * is the one screen that shows what is actually attached to the site, so
 * the operator can see the jobs and agreements right above the button they
 * are about to press.
 *
 * A site delete CASCADES — its jobs and its dead (draft/cancelled)
 * agreements go with it, in one transaction inside the RPC. That is not a
 * detail to bury, so the dialog spells out the counts before the button is
 * live, and warns separately that any service sheets survive in Documents.
 * A site with an ACTIVE or PAUSED agreement can't be deleted at all; the
 * dialog says why and offers no delete button.
 *
 * Soft delete, so the copy stays "Delete site" / "Removes" — never
 * "permanently" / "forever". Online-only, like every other delete here.
 */
export function DeleteSiteButton({
  siteId,
  siteLabel,
  customerId,
}: DeleteSiteButtonProps) {
  const router = useRouter();
  const online = useIsOnline();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<SiteDeleteImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fetch the impact preview when the dialog opens. Async-only (no
  // synchronous setState in the effect body) — resets happen in
  // handleClose, an event handler.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void getSiteDeleteImpactAction(siteId).then((res) => {
      if (active) setImpact(res);
    });
    return () => {
      active = false;
    };
  }, [open, siteId]);

  function handleClose() {
    setImpact(null);
    setError(null);
    setOpen(false);
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await wrappedDeleteSite(siteId);
      if (!res.success) {
        setError(res.message ?? "Failed to delete site");
        return;
      }
      // Mirror the cascade into Dexie so the offline-first views (the
      // customer panel's site list, the jobs list) drop the rows straight
      // away rather than waiting for the next sync pull. The server rows
      // are already updated; a failure here is reconciled by that pull.
      const now = new Date().toISOString();
      try {
        await db.sites.update(siteId, { deleted_at: now });
        await db.jobs
          .where("site_id")
          .equals(siteId)
          .modify({ deleted_at: now });
      } catch {
        // Non-fatal.
      }
      router.push(ROUTES.customerDetail(customerId));
      router.refresh();
    });
  }

  const blocked = (impact?.liveAgreements ?? 0) > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!online}
        title={online ? undefined : "Online required to delete a site"}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
          />
        </svg>
        Delete
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={handleClose}
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
                    d="M12 9v3.75m0 3.75h.007v.008H12v-.008Zm0-12.75c5.385 0 9.75 4.365 9.75 9.75s-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12 6.615 2.25 12 2.25Z"
                  />
                </svg>
              </div>
              <h2 className="text-center text-lg font-semibold text-gray-900">
                Delete {siteLabel}?
              </h2>

              {blocked ? (
                <div className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">
                    This site has{" "}
                    {impact!.liveAgreements === 1
                      ? "a live agreement"
                      : `${impact!.liveAgreements} live agreements`}
                    .
                  </p>
                  <p>
                    A live contract is never removed by deleting a site.
                    Cancel the agreement first, then come back here.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-center text-sm text-gray-500">
                    Removes this site from the customer, along with its
                    bookings.
                  </p>

                  {impact && (impact.jobs > 0 || impact.deadAgreements > 0) && (
                    <div className="mt-4 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      {impact.jobs > 0 && (
                        <p>
                          <span className="font-semibold">
                            {impact.jobs} {impact.jobs === 1 ? "job" : "jobs"}
                          </span>{" "}
                          at this site will be deleted with it
                          {impact.upcomingJobs > 0 && (
                            <>
                              , including {impact.upcomingJobs} still on the
                              calendar
                            </>
                          )}
                          .
                        </p>
                      )}
                      {impact.deadAgreements > 0 && (
                        <p>
                          {impact.deadAgreements} draft or cancelled{" "}
                          {impact.deadAgreements === 1
                            ? "agreement"
                            : "agreements"}{" "}
                          will be deleted too.
                        </p>
                      )}
                    </div>
                  )}

                  {impact && impact.serviceSheets > 0 && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                      {impact.serviceSheets === 1
                        ? "1 service sheet stays"
                        : `${impact.serviceSheets} service sheets stay`}{" "}
                      in Documents as the record of work performed, and must
                      be deleted separately.
                    </div>
                  )}
                </>
              )}

              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            </div>

            <div className="mt-6 flex gap-2 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {blocked ? "Close" : "Cancel"}
              </button>
              {!blocked && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isPending || impact === null}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? "Deleting…" : "Delete site"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
