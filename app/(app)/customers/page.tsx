import { Suspense } from "react";
import Link from "next/link";
import { getCustomerListItems } from "@/lib/data/customers";
import { CustomerSearch } from "@/components/customers/customer-search";
import { CustomersTabs } from "@/components/customers/customers-tabs";
import { CustomersTable } from "@/components/customers/customers-table";
import { ROUTES } from "@/lib/constants/routes";
import type { CustomerType } from "@/types/database";

function TableSkeleton() {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
      <div className="animate-pulse">
        <div className="border-b border-gray-100 px-6 py-3">
          <div className="h-4 w-48 rounded bg-gray-100" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border-b border-gray-50 px-6 py-3">
            <div className="h-4 w-64 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function CustomerListInner({
  query,
  type,
}: {
  query: string | undefined;
  type: string;
}) {
  const normalizedType: CustomerType | "all" =
    type === "commercial" || type === "domestic" ? type : "all";
  const rows = await getCustomerListItems({
    type: normalizedType,
    search: query,
  });
  return <CustomersTable rows={rows} query={query} typeFilter={normalizedType} />;
}

interface CustomersPageProps {
  searchParams: Promise<{ q?: string; type?: string }>;
}

export default async function CustomersPage({
  searchParams,
}: CustomersPageProps) {
  const { q, type } = await searchParams;
  const suspenseKey = `${q ?? ""}-${type ?? "all"}`;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-500">
            Click a row to see the customer panel.
          </p>
        </div>
        <Link
          href={`${ROUTES.CUSTOMERS}/new`}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors"
        >
          Add Customer
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Suspense fallback={null}>
          <CustomersTabs />
        </Suspense>
        <CustomerSearch />
      </div>

      <div className="mt-4">
        <Suspense key={suspenseKey} fallback={<TableSkeleton />}>
          <CustomerListInner query={q} type={type ?? "all"} />
        </Suspense>
      </div>
    </div>
  );
}
