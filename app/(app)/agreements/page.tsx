import { Suspense } from "react";
import Link from "next/link";
import { getAllAgreements } from "@/lib/data/agreements";
import { formatAddress } from "@/lib/utils/format-address";
import { ROUTES } from "@/lib/constants/routes";
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_COLORS,
} from "@/lib/constants/job-labels";
import { AgreementsFilter } from "@/components/agreements/agreements-filter";
import type { AgreementStatus } from "@/types/database";

interface AgreementsPageProps {
  searchParams: Promise<{
    status?: string;
    q?: string;
  }>;
}

const VALID_STATUSES = new Set(["active", "paused", "cancelled", "all"]);

async function AgreementsTable({
  status,
  search,
}: {
  status?: string;
  search?: string;
}) {
  const normalizedStatus = status && VALID_STATUSES.has(status)
    ? (status as "active" | "paused" | "cancelled" | "all")
    : "all";

  const agreements = await getAllAgreements({
    status: normalizedStatus,
    search,
  });

  if (agreements.length === 0) {
    return (
      <div className="rounded-xl bg-white p-12 text-center shadow-sm">
        <svg
          className="mx-auto h-10 w-10 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          />
        </svg>
        <p className="mt-4 text-sm font-medium text-gray-900">
          {search || (status && status !== "all")
            ? "No agreements match your filters"
            : "No agreements yet"}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {search || (status && status !== "all")
            ? "Try a different filter or search."
            : "Open a customer's site to create their first agreement."}
        </p>
        {!(search || (status && status !== "all")) && (
          <Link
            href={ROUTES.CUSTOMERS}
            className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors"
          >
            Browse Customers
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3 hidden sm:table-cell">Site</th>
              <th className="px-4 py-3 hidden md:table-cell">Visits</th>
              <th className="px-4 py-3 hidden lg:table-cell">Renewal date</th>
              <th className="px-4 py-3 hidden md:table-cell">Value</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {agreements.map((agreement) => (
              <tr key={agreement.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`${ROUTES.AGREEMENTS}/${agreement.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {agreement.customer.name}
                  </Link>
                  {agreement.customer.company_name && (
                    <div className="text-xs text-gray-400">
                      {agreement.customer.company_name}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell text-gray-600">
                  {formatAddress(agreement.site) || "—"}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                  {agreement.visit_frequency
                    ? `${agreement.visit_frequency}/year`
                    : "—"}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-gray-600">
                  {agreement.end_date
                    ? new Date(agreement.end_date).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                  {agreement.contract_value
                    ? `£${Number(agreement.contract_value).toLocaleString()}`
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      AGREEMENT_STATUS_COLORS[
                        agreement.status as AgreementStatus
                      ]
                    }`}
                  >
                    {
                      AGREEMENT_STATUS_LABELS[
                        agreement.status as AgreementStatus
                      ]
                    }
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="animate-pulse">
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="h-4 w-full rounded bg-gray-100" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border-b border-gray-50 px-4 py-3">
            <div className="h-4 w-3/4 rounded bg-gray-50" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function AgreementsPage({
  searchParams,
}: AgreementsPageProps) {
  const params = await searchParams;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Agreements</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pest management contracts across all customers.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <Suspense fallback={null}>
          <AgreementsFilter />
        </Suspense>
      </div>

      <div className="mt-4">
        <Suspense
          key={`${params.status ?? "all"}-${params.q ?? ""}`}
          fallback={<TableSkeleton />}
        >
          <AgreementsTable status={params.status} search={params.q} />
        </Suspense>
      </div>
    </div>
  );
}
