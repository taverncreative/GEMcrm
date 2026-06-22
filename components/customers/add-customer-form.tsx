"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createCustomerAction } from "@/app/(app)/customers/actions";
import { INITIAL_ACTION_STATE } from "@/types/actions";
import { ROUTES } from "@/lib/constants/routes";
import {
  useLocalFirstAction,
  formDataToObject,
  type WrapMeta,
} from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import { newId } from "@/lib/utils/id";
import {
  CustomerSchema,
  type CustomerInput,
} from "@/lib/validation/customer";
import { CustomerFormFields } from "@/components/customers/customer-form-fields";
import type { Customer, Site } from "@/types/database";

/**
 * Add Customer form.
 *
 * For commercial customers we collect a fuller contact set (company,
 * position, mobile, billing/registered address, website, notes) because
 * those records typically need to support invoicing. For domestic we
 * keep the form lighter — name + basics, plus optional notes.
 *
 * PMAs (Pest Management Agreements) are a contract framework for
 * recurring work and are optional for both customer types — they can
 * be set up from the side panel any time after the customer exists.
 *
 * Optimistic local-first (the 2c6d434 booking treatment): submit runs
 * applyLocal (customer + auto-created sites into Dexie, where the
 * customers list reads via useLiveQuery) → ONE outbox entry carrying
 * the client-generated ids → localSuccessState navigates back to the
 * list, which already shows the new row. The server is never called at
 * submit; the engine's drainOutbox replays the entry (online:
 * seconds; offline: when the connection returns).
 */
interface ExtraSite {
  address_line_1: string;
  address_line_2: string;
  town: string;
  county: string;
  postcode: string;
}

function emptyExtraSite(): ExtraSite {
  return {
    address_line_1: "",
    address_line_2: "",
    town: "",
    county: "",
    postcode: "",
  };
}

// ─── Optimistic create machinery ─────────────────────────────────────

function trimToNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** Mirrors the data layer's hasUsableSiteAddress: line 1 + town at
 *  minimum (postcode optional) — applyLocal must only write the sites
 *  the server will actually create on replay. */
function usableSite(s: {
  address_line_1?: string;
  town?: string;
}): boolean {
  return Boolean(trimToNull(s.address_line_1) && trimToNull(s.town));
}

interface ExtraSiteWithId extends ExtraSite {
  id: string;
}

export interface CreateCustomerParsedInput {
  customerId: string;
  /** Used only when the customer's own address block is usable. */
  primarySiteId: string;
  customer: CustomerInput;
  /** Usable extra sites only, each carrying its client id. */
  extraSites: ExtraSiteWithId[];
}

function buildRawCustomer(fd: FormData) {
  const str = (key: string): string => (fd.get(key) as string | null) ?? "";
  return {
    name: str("name"),
    company_name: str("company_name"),
    position: str("position"),
    email: str("email"),
    phone: str("phone"),
    mobile: str("mobile"),
    address_line_1: str("address_line_1"),
    address_line_2: str("address_line_2"),
    town: str("town"),
    county: str("county"),
    postcode: str("postcode"),
    website: str("website"),
    notes: str("notes"),
    annual_contract_value: str("annual_contract_value"),
    customer_type: str("customer_type") || "commercial",
  };
}

/** Parse + client-generate the ids the whole pipeline shares: applyLocal
 *  writes these rows, the outbox replay upserts the SAME ids server-side
 *  (createCustomer's opts.id / primarySiteId / additionalSites[].id).
 *  Exported for the optimistic-create tests. */
export function parseCreateCustomerFormData(
  fd: FormData
): CreateCustomerParsedInput | null {
  const result = CustomerSchema.safeParse(buildRawCustomer(fd));
  if (!result.success) return null;

  const extraSites: ExtraSiteWithId[] = [];
  const rawSites = (fd.get("additional_sites") as string | null) ?? "";
  if (rawSites) {
    try {
      const parsed: unknown = JSON.parse(rawSites);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry && typeof entry === "object") {
            const e = entry as Record<string, string | undefined>;
            const site: ExtraSite = {
              address_line_1: e.address_line_1 ?? "",
              address_line_2: e.address_line_2 ?? "",
              town: e.town ?? "",
              county: e.county ?? "",
              postcode: e.postcode ?? "",
            };
            if (usableSite(site)) extraSites.push({ ...site, id: newId() });
          }
        }
      }
    } catch {
      // Malformed JSON — match the server action: save customer, skip extras.
    }
  }

  return {
    customerId: newId(),
    primarySiteId: newId(),
    customer: result.data,
    extraSites,
  };
}

/** Client-side validation for the optimistic submit (the server's Zod
 *  bounce can't supply field errors when the server is never called at
 *  submit). Same schema, same keys the form renders. */
export function validateCustomerFormData(
  fd: FormData
): Record<string, string> | null {
  const result = CustomerSchema.safeParse(buildRawCustomer(fd));
  if (result.success) return null;
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** Exported for the optimistic-create tests. */
export const createCustomerMeta: WrapMeta<CreateCustomerParsedInput> = {
  actionName: "createCustomerAction",
  entityType: "customer",
  entityId: (input) => input.customerId,
  parseInput: parseCreateCustomerFormData,
  op: "create",
  // ONLY newly-created ids (discard-revert deletes exactly these).
  entityIds: (input) => [
    input.customerId,
    ...(usableSite(input.customer) ? [input.primarySiteId] : []),
    ...input.extraSites.map((s) => s.id),
  ],
  // Persisted replay args = raw form fields + the client ids, so the
  // server-side upserts create the SAME rows applyLocal wrote.
  replayArgs: (input, formData) => ({
    ...formDataToObject(formData),
    id: input.customerId,
    primary_site_id: usableSite(input.customer) ? input.primarySiteId : "",
    additional_sites: JSON.stringify(input.extraSites),
  }),
  // Mirrors the server-side createCustomer writes (trim/normalise the
  // same way so the eventual pull doesn't churn the rows).
  applyLocal: async (input) => {
    const now = new Date().toISOString();
    const c = input.customer;
    const customerRow: Customer = {
      id: input.customerId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      name: c.name.trim(),
      company_name: trimToNull(c.company_name),
      email: trimToNull(c.email),
      phone: trimToNull(c.phone),
      customer_type: c.customer_type ?? "commercial",
      google_review_received: false,
      review_request_snoozed_until: null,
      review_email_sent_at: null,
      mobile: trimToNull(c.mobile),
      position: trimToNull(c.position),
      address: null,
      address_line_1: trimToNull(c.address_line_1),
      address_line_2: trimToNull(c.address_line_2),
      town: trimToNull(c.town),
      county: trimToNull(c.county),
      postcode: trimToNull(c.postcode)?.toUpperCase() ?? null,
      website: trimToNull(c.website),
      notes: trimToNull(c.notes),
      annual_contract_value:
        typeof c.annual_contract_value === "number"
          ? c.annual_contract_value
          : null,
    };
    await db.customers.add(customerRow);

    const localSite = (
      id: string,
      s: { address_line_1?: string; address_line_2?: string; town?: string; county?: string; postcode?: string }
    ): Site => ({
      id,
      customer_id: input.customerId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      address_line_1: trimToNull(s.address_line_1),
      address_line_2: trimToNull(s.address_line_2),
      town: trimToNull(s.town),
      county: trimToNull(s.county),
      postcode: trimToNull(s.postcode)?.toUpperCase() ?? null,
    });

    const sites: Site[] = [];
    if (usableSite(c)) sites.push(localSite(input.primarySiteId, c));
    for (const s of input.extraSites) sites.push(localSite(s.id, s));
    if (sites.length > 0) await db.sites.bulkAdd(sites);
  },
};

/** Optimistic path: local write + ONE outbox entry ARE the operation;
 *  the server is never called at submit. Module-level for a stable ref. */
const createCustomerOpts = {
  localSuccessState: () => ({ success: true, errors: {}, message: null }),
};

export function AddCustomerForm() {
  // Optimistic local-first: applyLocal + outbox enqueue at submit, the
  // server syncs in the background via drainOutbox.
  const [state, formAction, isPending] = useLocalFirstAction(
    createCustomerAction,
    INITIAL_ACTION_STATE,
    createCustomerMeta,
    createCustomerOpts
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [type, setType] = useState<"commercial" | "domestic">("commercial");
  // Additional sites only relevant for commercial customers (multiple
  // locations). For domestic the primary address is the single site.
  const [extraSites, setExtraSites] = useState<ExtraSite[]>([]);

  // Client + (fallback) server errors merged — client validation is the
  // primary source now the server isn't called at submit.
  const errors = { ...state.errors, ...clientErrors };

  // Local success → the customer is committed (Dexie + outbox). Navigate
  // back to the list, which already shows the new row via useLiveQuery.
  useEffect(() => {
    if (state.success) router.push(ROUTES.CUSTOMERS);
  }, [state, router]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const validationErrors = validateCustomerFormData(fd);
    if (validationErrors) {
      setClientErrors(validationErrors);
      return;
    }
    setClientErrors({});
    void formAction(fd);
  }

  const isCommercial = type === "commercial";
  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500";
  const labelClass = "block text-sm font-medium text-gray-700";

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
      <CustomerFormFields
        type={type}
        onTypeChange={setType}
        errors={errors}
        extraSection={
          /* ── Additional service locations (commercial only) ──
             Create-only: each row becomes a separate `sites` record. The
             edit form omits this — sites are managed separately. */
          isCommercial ? (
            <section className="space-y-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Additional service locations
              </h3>
              {extraSites.length === 0 ? (
                <p className="text-xs text-gray-400">
                  Just the one location? Skip this. Add more if the business
                  has multiple sites that need treatment.
                </p>
              ) : (
                <div className="space-y-3">
                  {extraSites.map((site, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-600">
                          Location {i + 2}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setExtraSites((prev) =>
                              prev.filter((_, idx) => idx !== i)
                            )
                          }
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          × Remove
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                        <div className="sm:col-span-6">
                          <label className={labelClass}>Address line 1</label>
                          <input
                            type="text"
                            value={site.address_line_1}
                            onChange={(e) =>
                              setExtraSites((prev) =>
                                prev.map((s, idx) =>
                                  idx === i
                                    ? { ...s, address_line_1: e.target.value }
                                    : s
                                )
                              )
                            }
                            placeholder="Street / building"
                            className={inputClass}
                          />
                        </div>
                        <div className="sm:col-span-6">
                          <label className={labelClass}>Address line 2</label>
                          <input
                            type="text"
                            value={site.address_line_2}
                            onChange={(e) =>
                              setExtraSites((prev) =>
                                prev.map((s, idx) =>
                                  idx === i
                                    ? { ...s, address_line_2: e.target.value }
                                    : s
                                )
                              )
                            }
                            placeholder="Apartment, unit, etc. (optional)"
                            className={inputClass}
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className={labelClass}>Town / city</label>
                          <input
                            type="text"
                            value={site.town}
                            onChange={(e) =>
                              setExtraSites((prev) =>
                                prev.map((s, idx) =>
                                  idx === i ? { ...s, town: e.target.value } : s
                                )
                              )
                            }
                            placeholder="e.g. Maidstone"
                            className={inputClass}
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className={labelClass}>County</label>
                          <input
                            type="text"
                            value={site.county}
                            onChange={(e) =>
                              setExtraSites((prev) =>
                                prev.map((s, idx) =>
                                  idx === i
                                    ? { ...s, county: e.target.value }
                                    : s
                                )
                              )
                            }
                            placeholder="e.g. Kent"
                            className={inputClass}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className={labelClass}>Postcode</label>
                          <input
                            type="text"
                            value={site.postcode}
                            onChange={(e) =>
                              setExtraSites((prev) =>
                                prev.map((s, idx) =>
                                  idx === i
                                    ? { ...s, postcode: e.target.value }
                                    : s
                                )
                              )
                            }
                            placeholder="ME14 1XX"
                            className={`${inputClass} uppercase`}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  setExtraSites((prev) => [...prev, emptyExtraSite()])
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:border-brand hover:text-brand-darker"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add another location
              </button>
              {/* JSON-encoded extras travel through FormData as a single
                  field; the action parses + validates each. */}
              <input
                type="hidden"
                name="additional_sites"
                value={JSON.stringify(extraSites)}
              />
            </section>
          ) : null
        }
      />

      {state.message && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {state.message}
        </div>
      )}

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        <Link
          href={ROUTES.CUSTOMERS}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save Customer"}
        </button>
      </div>
    </form>
  );
}
