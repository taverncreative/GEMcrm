"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, useRef } from "react";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export function AgreementsFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [localQuery, setLocalQuery] = useState(urlQuery);
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  // Keep local query in sync when URL changes externally (e.g. back button)
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setLocalQuery(urlQuery);
  }
  const status = params.get("status") ?? "all";
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParams = useCallback(
    (next: { status?: string; q?: string }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.status !== undefined) {
        if (next.status === "all") sp.delete("status");
        else sp.set("status", next.status);
      }
      if (next.q !== undefined) {
        if (next.q === "") sp.delete("q");
        else sp.set("q", next.q);
      }
      const qs = sp.toString();
      router.push(qs ? `/agreements?${qs}` : "/agreements");
    },
    [params, router]
  );

  function onSearchChange(value: string) {
    setLocalQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value.trim() });
    }, 300);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((opt) => {
          const active = opt.value === status;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateParams({ status: opt.value })}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-brand text-white"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className="relative w-full sm:w-64">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="search"
          value={localQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by customer…"
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>
    </div>
  );
}
