import { WidgetCard } from "./widget-card";

interface RevenueStatsProps {
  /** Sum of contract_value across active commercial agreements. */
  committedAnnual: number;
}

function gbp(n: number): string {
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

/**
 * Committed annual revenue from signed agreements.
 *
 * This widget used to carry six figures: revenue today, total YTD, a
 * commercial/domestic split, outstanding invoices and a count of unpaid
 * jobs. Every one of those came from the invoices table or the legacy
 * `jobs.is_paid` flag, and Nate invoices in QuickBooks — so they only ever
 * reported what the app had auto-generated at him (9 invoices, 1 ever marked
 * paid). A homepage reading "£0 today, £105 this year" is worse than no
 * figure at all, so slice 2b removed them.
 *
 * What is left is the one figure that was never invoice-derived: the annual
 * value of active commercial PMAs. It comes from signed agreements, it is
 * forward-looking, and it is worth seeing.
 *
 * The widget keeps its `revenue-stats` id so a saved dashboard layout still
 * places it where the operator put it. (DashboardGrid filters saved ids
 * against the registry and appends unknown ones, so a changed or removed id
 * degrades gracefully either way — keeping it just avoids a layout shift.)
 */
export function RevenueStatsWidget({ committedAnnual }: RevenueStatsProps) {
  return (
    <WidgetCard title="Revenue">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">
        Committed PMA / yr
      </p>
      <p className="mt-1 text-3xl font-semibold text-gray-900">
        {gbp(committedAnnual)}
      </p>
      <p className="mt-1 text-[11px] text-gray-400">
        Annual value of active commercial agreements
      </p>
    </WidgetCard>
  );
}
