"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  snoozeReviewAction,
  markReviewReceivedAction,
} from "@/app/(app)/reviews/actions";
import { buildReviewEmail } from "@/lib/services/review-email";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import type { ReviewCandidate } from "@/lib/data/reviews";
import type { CallType, Customer } from "@/types/database";

interface ReviewRequestsProps {
  candidates: ReviewCandidate[];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Open the user's mail client with a pre-written review-request email.
 * Uses a mailto link so it works in any browser without an SMTP setup.
 */
function openMailClient(customer: Customer) {
  const draft = buildReviewEmail(customer);
  const url = `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(
    draft.subject
  )}&body=${encodeURIComponent(draft.body)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ReviewRequests({ candidates }: ReviewRequestsProps) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function hideRow(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function runAction(
    id: string,
    fn: () => Promise<{ success: boolean; message?: string }>
  ) {
    hideRow(id);
    setConfirmingId(null);
    startTransition(async () => {
      const res = await fn();
      if (res.success) {
        router.refresh();
      } else {
        // Re-show on failure
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  const visible = candidates.filter((c) => !hidden.has(c.customer.id));

  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">Request review</h3>
        <span className="text-xs text-gray-400">{visible.length}</span>
      </div>
      <ul className="space-y-2">
        {visible.map((c) => {
          const isConfirming = confirmingId === c.customer.id;
          return (
            <li
              key={c.customer.id}
              className="rounded-lg border border-gray-100 px-3 py-3"
            >
              {isConfirming ? (
                <div>
                  <p className="text-sm text-gray-900">
                    Don&apos;t ask {c.customer.name} again?
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        runAction(c.customer.id, () =>
                          snoozeReviewAction(c.customer.id)
                        )
                      }
                      className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
                    >
                      Ask later
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runAction(c.customer.id, () =>
                          markReviewReceivedAction(c.customer.id)
                        )
                      }
                      className="rounded-lg bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-darker hover:bg-brand-soft"
                    >
                      Already reviewed
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runAction(c.customer.id, () =>
                          markReviewReceivedAction(c.customer.id)
                        )
                      }
                      className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
                    >
                      Never ask
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {c.customer.name}
                    </p>
                    {c.lastJob && (
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {formatDate(c.lastJob.job_date)}
                        {c.lastJob.call_type
                          ? ` · ${CALL_TYPE_LABELS[c.lastJob.call_type as CallType] ?? c.lastJob.call_type}`
                          : ""}
                        {c.lastJob.site_address
                          ? ` · ${c.lastJob.site_address}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openMailClient(c.customer)}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark"
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(c.customer.id)}
                      aria-label="Dismiss"
                      className="rounded-lg p-2.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
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
                          d="M6 18 18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
