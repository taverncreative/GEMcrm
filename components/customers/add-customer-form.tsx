"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createCustomerAction } from "@/app/(app)/customers/actions";
import { INITIAL_ACTION_STATE } from "@/types/actions";
import { ROUTES } from "@/lib/constants/routes";

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

export function AddCustomerForm() {
  const [state, formAction, isPending] = useActionState(
    createCustomerAction,
    INITIAL_ACTION_STATE
  );
  const [type, setType] = useState<"commercial" | "domestic">("commercial");
  // Additional sites only relevant for commercial customers (multiple
  // locations). For domestic the primary address is the single site.
  const [extraSites, setExtraSites] = useState<ExtraSite[]>([]);

  const isCommercial = type === "commercial";
  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500";
  const labelClass = "block text-sm font-medium text-gray-700";

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="customer_type" value={type} />

      {/* Customer type */}
      <div>
        <label className={labelClass}>
          Customer type <span className="text-red-500">*</span>
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["commercial", "domestic"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex cursor-pointer items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                type === t
                  ? "border-brand bg-brand-soft text-brand-darker"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {t === "commercial" ? "Commercial" : "Domestic"}
            </button>
          ))}
        </div>
        <p className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Pest Management Agreements are optional — set one up for
          recurring contracted work after the customer is created, or
          skip for one-off jobs.
        </p>
      </div>

      {/* ── Identity ── */}
      <section className="space-y-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Identity
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className={labelClass}>
              Contact name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="Full name of primary contact"
              className={inputClass}
            />
            {state.errors.name && (
              <p className="mt-1 text-sm text-red-500">{state.errors.name}</p>
            )}
          </div>

          {isCommercial && (
            <>
              <div>
                <label htmlFor="company_name" className={labelClass}>
                  Company name <span className="text-red-500">*</span>
                </label>
                <input
                  id="company_name"
                  name="company_name"
                  type="text"
                  required
                  placeholder="Legal trading name"
                  className={inputClass}
                />
                {state.errors.company_name && (
                  <p className="mt-1 text-sm text-red-500">{state.errors.company_name}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="position" className={labelClass}>
                  Position / role
                </label>
                <input
                  id="position"
                  name="position"
                  type="text"
                  placeholder="e.g. Operations Manager, Director"
                  className={inputClass}
                />
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Contact ── */}
      <section className="space-y-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Contact
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="phone" className={labelClass}>
              Telephone {isCommercial && <span className="text-red-500">*</span>}
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required={isCommercial}
              placeholder="01xxx xxx xxx"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="mobile" className={labelClass}>
              Mobile
            </label>
            <input
              id="mobile"
              name="mobile"
              type="tel"
              placeholder="07xxx xxx xxx"
              className={inputClass}
            />
          </div>
          <div className={isCommercial ? "sm:col-span-2" : "sm:col-span-2"}>
            <label htmlFor="email" className={labelClass}>
              Email {isCommercial && <span className="text-red-500">*</span>}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required={isCommercial}
              placeholder="contact@example.com"
              className={inputClass}
            />
            {state.errors.email && (
              <p className="mt-1 text-sm text-red-500">{state.errors.email}</p>
            )}
          </div>
          {isCommercial && (
            <div className="sm:col-span-2">
              <label htmlFor="website" className={labelClass}>
                Website
              </label>
              {/* type="text" not "url" — browser URL validation rejects
                  "example.com" without a protocol; our schema accepts
                  bare domains and auto-prepends https:// server-side. */}
              <input
                id="website"
                name="website"
                type="text"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="example.com"
                className={inputClass}
              />
              {state.errors.website && (
                <p className="mt-1 text-sm text-red-500">{state.errors.website}</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Commercial-only: annual contract value ── */}
      {isCommercial && (
        <section className="space-y-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Commercial details
          </h3>
          <div>
            <label htmlFor="annual_contract_value" className={labelClass}>
              Annual contract value
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                £
              </span>
              <input
                id="annual_contract_value"
                name="annual_contract_value"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 40000"
                className={`${inputClass} pl-7`}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Optional headline value (e.g. &pound;40,000 pa). Filled-in
              detail and visit schedule belong on the Pest Management
              Agreement.
            </p>
          </div>
        </section>
      )}

      {/* ── Address (optional for both types) ── */}
      <section className="space-y-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {isCommercial ? "Billing / registered address" : "Address"}
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="sm:col-span-6">
            <label htmlFor="address_line_1" className={labelClass}>
              Address line 1
            </label>
            <input
              id="address_line_1"
              name="address_line_1"
              type="text"
              placeholder="Street / building"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-6">
            <label htmlFor="address_line_2" className={labelClass}>
              Address line 2
            </label>
            <input
              id="address_line_2"
              name="address_line_2"
              type="text"
              placeholder="Apartment, unit, etc. (optional)"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="town" className={labelClass}>
              Town / city
            </label>
            <input
              id="town"
              name="town"
              type="text"
              placeholder="e.g. Maidstone"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-3">
            <label htmlFor="county" className={labelClass}>
              County
            </label>
            <input
              id="county"
              name="county"
              type="text"
              placeholder="e.g. Kent"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="postcode" className={labelClass}>
              Postcode
            </label>
            <input
              id="postcode"
              name="postcode"
              type="text"
              placeholder="ME14 1XX"
              className={`${inputClass} uppercase`}
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          {isCommercial
            ? "Used on invoices, and also saved as the primary service location. Add more locations below if the business has several sites."
            : "Saved as the address where visits will happen. You can edit it later from the customer page."}
        </p>
      </section>

      {/* ── Additional service locations (commercial only) ──
          For businesses with multiple sites. Each row becomes a separate
          `sites` record, so bookings can be assigned to whichever
          location applies. */}
      {isCommercial && (
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
      )}

      {/* ── Notes ── */}
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Notes
        </h3>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="e.g. preferred visit times, access instructions, key contacts, anything worth remembering."
          className={inputClass}
        />
      </section>

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
