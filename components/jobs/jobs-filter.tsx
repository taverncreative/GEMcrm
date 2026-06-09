"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";

/**
 * Jobs search box. The date + call-type dropdowns were removed — date is now
 * a sort (toggle on the Date column header) and status lives in the Open /
 * Completed tabs, so the only control left here is the cross-field search
 * (customer name / company / site address / postcode). The page still honours
 * ?filter=today|upcoming from the dashboard deep-links; there's just no manual
 * dropdown for it.
 */
export function JobsFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          aria-label="Search customer or address"
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

      {isPending && (
        <span className="text-xs text-gray-400">Loading...</span>
      )}
    </div>
  );
}
