"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Status segmentation for the Jobs page — three segments:
 *
 *   - Open      → job_status in {scheduled, in_progress} (the active queue)
 *   - Completed → job_status === completed (the done/archive view)
 *   - Drafts    → job_status === draft (quick captures awaiting upgrade)
 *
 * Open is the default — a field tech lands on their active work. "Open"
 * omits the `status` param (clean default URL); the others set
 * ?status=completed / ?status=draft. Each tab enumerates exactly the
 * status(es) it wants, so a draft only ever shows under Drafts.
 */
const TABS = [
  { value: "open", label: "Open" },
  { value: "completed", label: "Completed" },
  { value: "draft", label: "Drafts" },
] as const;

export function JobsStatusTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const param = searchParams.get("status");
  const active =
    param === "completed" ? "completed" : param === "draft" ? "draft" : "open";

  function setTab(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "completed" || value === "draft") params.set("status", value);
    else params.delete("status");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/jobs?${qs}` : "/jobs");
    });
  }

  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
      {TABS.map((t) => {
        const isActive = t.value === active;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? "bg-brand text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
