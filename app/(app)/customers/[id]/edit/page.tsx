"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { db } from "@/lib/db";
import { ROUTES } from "@/lib/constants/routes";
import { EditCustomerForm } from "@/components/customers/edit-customer-form";
import type { Customer } from "@/types/database";

/**
 * Edit a customer. Client + Dexie-backed (like every other customer
 * surface) — the prefill reads the synced local row via useLiveQuery, so it
 * works the same online or off; the SAVE is online-only (see
 * EditCustomerForm). Lives at /customers/[id]/edit, a sibling of the retired
 * /customers/[id] redirect.
 *
 * useLiveQuery returns `undefined` while the query is in flight and `null`
 * once we've confirmed the row is missing or soft-deleted (the inner
 * predicate maps both to null), so the two states are distinguishable.
 */
export default function EditCustomerPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  // Optional round-trip target (e.g. the service-sheet gate). Validated in
  // the form before any redirect.
  const returnTo = useSearchParams().get("returnTo");

  const customer = useLiveQuery<Customer | null>(
    async () => {
      if (!id) return null;
      const c = await db.customers.get(id);
      return c && !c.deleted_at ? c : null;
    },
    [id]
  );

  if (customer === undefined) {
    return (
      <div className="max-w-lg">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  if (customer === null) {
    return (
      <div className="max-w-lg">
        <h1 className="text-2xl font-semibold text-gray-900">Customer not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          This customer may have been deleted, or your local data hasn&rsquo;t
          synced yet.
        </p>
        <Link
          href={ROUTES.CUSTOMERS}
          className="mt-4 inline-block rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Back to customers
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Edit customer</h1>
      <div className="mt-6 max-w-lg rounded-xl bg-white p-6 shadow-sm">
        <EditCustomerForm customer={customer} returnTo={returnTo} />
      </div>
    </div>
  );
}
