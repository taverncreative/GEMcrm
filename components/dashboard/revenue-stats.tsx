import { WidgetCard } from "./widget-card";
import type { RevenueStats } from "@/lib/data/invoices";

interface RevenueStatsProps {
  stats: RevenueStats;
}

function gbp(n: number): string {
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

export function RevenueStatsWidget({ stats }: RevenueStatsProps) {
  const year = new Date().getFullYear();
  return (
    <WidgetCard title="Revenue">
      {/* Widget lives in a column of the masonry grid (~half page), so we
          stay 2-up on every viewport rather than expanding to 3 wide. */}
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label={`Total ${year}`}
          value={gbp(stats.revenueYtd)}
          tone="strong"
        />
        <Stat
          label="Committed PMA / yr"
          value={gbp(stats.commercialCommittedAnnual)}
          hint="Sum of active PMAs"
        />
        <Stat
          label="Commercial YTD"
          value={gbp(stats.revenueYtdCommercial)}
          tone="brand"
        />
        <Stat
          label="Domestic YTD"
          value={gbp(stats.revenueYtdDomestic)}
          tone="purple"
        />
        <Stat
          label="Outstanding"
          value={gbp(stats.unpaidInvoicesTotal)}
          tone={stats.unpaidInvoicesTotal > 0 ? "warn" : "muted"}
        />
        <Stat label="Today" value={gbp(stats.revenueToday)} />
      </div>

      {stats.unpaidJobsCount > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          {stats.unpaidJobsCount} completed job{stats.unpaidJobsCount === 1 ? "" : "s"} not yet paid.
        </p>
      )}
    </WidgetCard>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "strong" | "warn" | "muted" | "brand" | "purple";
}) {
  const colour = {
    default: "text-gray-900",
    strong: "text-gray-900",
    warn: "text-red-600",
    muted: "text-gray-900",
    brand: "text-brand-darker",
    purple: "text-purple-700",
  }[tone];

  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p className={`mt-1 text-xl font-semibold ${colour}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}
