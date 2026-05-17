"use client";

import { useRouter, useSearchParams } from "next/navigation";

const TABS = [
  { value: "all", label: "All" },
  { value: "commercial", label: "Commercial" },
  { value: "domestic", label: "Domestic" },
] as const;

export function CustomersTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("type") ?? "all";

  function setTab(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "all") sp.delete("type");
    else sp.set("type", value);
    const qs = sp.toString();
    router.push(qs ? `/customers?${qs}` : "/customers");
  }

  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
      {TABS.map((t) => {
        const isActive = active === t.value;
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
