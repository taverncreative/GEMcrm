"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateCustomerAction } from "@/app/(app)/customers/actions";
import { validateCustomerFormData } from "@/components/customers/add-customer-form";
import { CustomerFormFields } from "@/components/customers/customer-form-fields";
import { db } from "@/lib/db";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { ROUTES } from "@/lib/constants/routes";
import type { Customer } from "@/types/database";

/**
 * Edit Customer form.
 *
 * ONLINE ONLY (mirrors delete): unlike the create form's optimistic
 * local-first path, edit calls `updateCustomerAction` directly and is gated
 * on connectivity. The presentational field-set is shared with create via
 * {@link CustomerFormFields}, pre-filled from the existing customer; the
 * commercial "additional service locations" block is intentionally omitted
 * (sites are edited separately).
 *
 * On success the server returns the canonical updated row, which we write
 * straight into Dexie so the Dexie-backed list / side panel / headline
 * reflect the change immediately rather than wait for the next 30s sync
 * pull (which then reconciles to the same values, idempotently). Then we
 * navigate back to the customer's side panel.
 */
export function EditCustomerForm({ customer }: { customer: Customer }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const online = useIsOnline();
  const [type, setType] = useState<"commercial" | "domestic">(
    customer.customer_type
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const backToCustomer = `${ROUTES.CUSTOMERS}?customer=${encodeURIComponent(
    customer.id
  )}`;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);

    // Same client validation as create (reused verbatim, same keys).
    const validationErrors = validateCustomerFormData(fd);
    if (validationErrors) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setServerError(null);
    setSaving(true);

    const result = await updateCustomerAction(customer.id, fd);
    if (result.success && result.customer) {
      // Refresh the local cache so the change is visible at once.
      await db.customers.put(result.customer);
      router.push(backToCustomer);
      return;
    }

    setServerError(result.message ?? "Failed to save changes");
    setErrors(result.errors ?? {});
    setSaving(false);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
      <CustomerFormFields
        type={type}
        onTypeChange={setType}
        errors={errors}
        defaults={customer}
      />

      {serverError && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {serverError}
        </div>
      )}

      {!online && (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          You&rsquo;re offline — editing a customer needs a connection. Your
          changes aren&rsquo;t saved until you&rsquo;re back online.
        </p>
      )}

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <Link
          href={backToCustomer}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving || !online}
          title={online ? undefined : "Online required"}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
