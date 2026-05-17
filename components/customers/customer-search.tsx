"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function CustomerSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleSearch(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("q", value);
    } else {
      params.delete("q");
    }
    startTransition(() => {
      router.replace(`/customers?${params.toString()}`);
    });
  }

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search customers..."
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => handleSearch(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 sm:w-72"
      />
      {isPending && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
        </div>
      )}
    </div>
  );
}
