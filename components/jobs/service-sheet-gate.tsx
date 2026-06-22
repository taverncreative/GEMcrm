import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import type { Customer, Site } from "@/types/database";
import type { ServiceSheetField } from "@/lib/documents/service-sheet-readiness";

interface ServiceSheetGateProps {
  customer: Customer | null;
  site: Site | null;
  missing: ServiceSheetField[];
  jobId: string;
}

/**
 * Blocking panel shown in place of the service-sheet form when the job's
 * customer/site are under-filled (see customerServiceSheetReadiness). Lists
 * the missing items in plain words and routes the operator to the right
 * edit surface — contact gaps to the customer, the address to the site —
 * each carrying a `returnTo` so saving lands them back on this sheet.
 */
export function ServiceSheetGate({
  customer,
  site,
  missing,
  jobId,
}: ServiceSheetGateProps) {
  const returnTo = `${ROUTES.jobDetail(jobId)}/complete`;
  const name = customer ? customerDisplayName(customer) : "This customer";
  const hasContactGap = missing.some((f) => f.fixOn === "customer");
  const hasAddressGap = missing.some((f) => f.fixOn === "site");

  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
          />
        </svg>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-amber-900">
            Before filling the service sheet, {name} needs:
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {missing.map((field) => (
              <li key={field.key}>{field.label}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-amber-800">
            The service sheet prints these details, so add them before
            filling it in.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {hasContactGap && customer && (
              <Link
                href={`${ROUTES.customerEdit(customer.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
              >
                Add contact details
              </Link>
            )}
            {hasAddressGap && site && (
              <Link
                href={`${ROUTES.siteEdit(site.id)}?returnTo=${encodeURIComponent(returnTo)}`}
                className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Add site address
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
