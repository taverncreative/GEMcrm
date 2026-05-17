"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Status filter tabs for the Jobs page. Drops the `in_progress` state per
 * product decision — we don't surface that midpoint to the operator.
 */
const TABS = [
  { value: "all", label: "All" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
] as const;

export function JobsStatusTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const active = searchParams.get("status") ?? "all";

  function setTab(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("status");
    else params.set("status", value);
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
