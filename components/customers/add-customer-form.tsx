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
 * those records need to support an invoice + a Pest Management Agreement.
 * For domestic, we keep it light — name + the basics, plus optional notes.
 */
export function AddCustomerForm() {
  const [state, formAction, isPending] = useActionState(
    createCustomerAction,
    INITIAL_ACTION_STATE
  );
  const [type, setType] = useState<"commercial" | "domestic">("commercial");

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
        {isCommercial && (
          <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Commercial customers should have a Pest Management Agreement.
            You can set this up later from the customer&apos;s side panel —
            we&apos;ll prompt you if it&apos;s missing.
          </p>
        )}
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
              <input
                id="website"
                name="website"
                type="url"
                placeholder="https://example.com"
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
            ? "Used on invoices when an invoice address isn't set on a specific agreement. Site addresses for the actual visits are added separately."
            : "Optional — handy to have on file for invoices and follow-up letters."}
        </p>
      </section>

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
