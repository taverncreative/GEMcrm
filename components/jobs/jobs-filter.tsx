"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import type { CallType } from "@/types/database";

export function JobsFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentFilter = searchParams.get("filter") ?? "all";
  const currentCallType = searchParams.get("callType") ?? "";
  const currentSearch = searchParams.get("q") ?? "";
  const [searchValue, setSearchValue] = useState(currentSearch);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      startTransition(() => {
        router.push(`/jobs?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition]
  );

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value });
    }, 400);
  };

  const handleSearchSubmit = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    updateParams({ q: searchValue });
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex gap-2 sm:w-72">
        <input
          type="search"
          placeholder="Search customer or address..."
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearchSubmit();
          }}
          className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-300 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSearchSubmit}
          className="h-9 shrink-0 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800"
        >
          Search
        </button>
      </div>

      <select
        value={currentFilter}
        onChange={(e) => updateParams({ filter: e.target.value })}
        className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-gray-300 focus:outline-none"
      >
        <option value="all">All dates</option>
        <option value="today">Today</option>
        <option value="upcoming">Upcoming</option>
      </select>

      <select
        value={currentCallType}
        onChange={(e) => updateParams({ callType: e.target.value })}
        className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-gray-300 focus:outline-none"
      >
        <option value="">All types</option>
        {(Object.entries(CALL_TYPE_LABELS) as [CallType, string][]).map(
          ([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          )
        )}
      </select>

      {isPending && (
        <span className="text-xs text-gray-400">Loading...</span>
      )}
    </div>
  );
}
