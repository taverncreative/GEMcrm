import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import type { AgreementWithContext } from "@/lib/data/agreements";
import { customerDisplayName } from "@/lib/utils/customer-display-name";

interface ExpiringAgreementsProps {
  agreements: AgreementWithContext[];
}

/**
 * PMA renewals widget. Each row colour-codes the renewal proximity:
 *   - red    : already past renewal date (overdue)
 *   - amber  : within 14 days
 *   - yellow : within 30 days
 *   - green  : > 30 days
 */
export function ExpiringAgreements({ agreements }: ExpiringAgreementsProps) {
  // Compute "now" once on the server render. Calling Date.now() during render
  // is impure and unreliable under React strict mode.
  const nowMs = new Date().getTime();
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  if (agreements.length === 0) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="text-sm font-medium text-gray-500">PMA renewals</h3>
        <p className="mt-3 text-sm text-gray-400">
          Nothing renewing in the next 30 days.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">PMA renewals</h3>
        <span className="text-xs text-gray-400">{agreements.length}</span>
      </div>
      <ul className="space-y-2">
        {agreements.map((agreement) => {
          const endDate = agreement.end_date ? new Date(agreement.end_date) : null;
          const daysLeft = endDate
            ? Math.ceil((endDate.getTime() - nowMs) / MS_PER_DAY)
            : null;

          let badgeClass = "bg-gray-100 text-gray-700";
          let badgeText: string | null = null;
          if (daysLeft !== null) {
            if (daysLeft < 0) {
              badgeClass = "bg-red-100 text-red-700";
              badgeText = `Overdue ${Math.abs(daysLeft)}d`;
            } else if (daysLeft <= 14) {
              badgeClass = "bg-amber-100 text-amber-700";
              badgeText = `${daysLeft}d`;
            } else if (daysLeft <= 30) {
              badgeClass = "bg-yellow-100 text-yellow-700";
              badgeText = `${daysLeft}d`;
            } else {
              badgeClass = "bg-brand-soft text-brand-darker";
              badgeText = `${daysLeft}d`;
            }
          }

          return (
            <li
              key={agreement.id}
              className="rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
            >
              <Link
                href={`${ROUTES.AGREEMENTS}/${agreement.id}`}
                className="block"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">
                    {agreement.customer
                      ? customerDisplayName(agreement.customer)
                      : "Unknown"}
                  </span>
                  {badgeText && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                    >
                      {badgeText}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {agreement.site?.address_line_1 ?? ""}
                  {agreement.visit_frequency
                    ? ` · ${agreement.visit_frequency} visits/yr`
                    : ""}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
