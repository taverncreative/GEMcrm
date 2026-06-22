"use client";

import type { ReactNode } from "react";

/**
 * Shared presentational field-set for the customer create + edit forms.
 *
 * This renders ONLY the inputs (with their `name` attributes) and the
 * commercial/domestic conditional visibility — no `<form>`, no submit, no
 * data layer. Each owning form keeps its own submit path: the create form
 * stays optimistic local-first (useLocalFirstAction + applyLocal + outbox +
 * site creation); the edit form is a plain online-only action. Sharing only
 * the markup keeps the verified create flow untouched.
 *
 * Inputs are uncontrolled (read via FormData on submit, the create form's
 * existing contract). `defaults` pre-fills them for edit; create omits it,
 * so the inputs render empty exactly as before.
 *
 * `extraSection` is rendered between the Address block and Notes — the
 * create form passes its commercial "additional service locations" block
 * here so the field order is unchanged; the edit form omits it (sites are
 * edited separately).
 */
export interface CustomerFieldDefaults {
  name?: string | null;
  company_name?: string | null;
  position?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  website?: string | null;
  annual_contract_value?: number | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
  notes?: string | null;
}

interface CustomerFormFieldsProps {
  type: "commercial" | "domestic";
  onTypeChange: (type: "commercial" | "domestic") => void;
  errors: Record<string, string>;
  defaults?: CustomerFieldDefaults;
  extraSection?: ReactNode;
}

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500";
const labelClass = "block text-sm font-medium text-gray-700";

export function CustomerFormFields({
  type,
  onTypeChange,
  errors,
  defaults,
  extraSection,
}: CustomerFormFieldsProps) {
  const isCommercial = type === "commercial";
  const dv = (v: string | number | null | undefined): string | number =>
    v ?? "";

  return (
    <>
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
              onClick={() => onTypeChange(t)}
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
              defaultValue={dv(defaults?.name)}
              placeholder="Full name of primary contact"
              className={inputClass}
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-500">{errors.name}</p>
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
                  defaultValue={dv(defaults?.company_name)}
                  placeholder="Legal trading name"
                  className={inputClass}
                />
                {errors.company_name && (
                  <p className="mt-1 text-sm text-red-500">{errors.company_name}</p>
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
                  defaultValue={dv(defaults?.position)}
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
              defaultValue={dv(defaults?.phone)}
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
              defaultValue={dv(defaults?.mobile)}
              placeholder="07xxx xxx xxx"
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="email" className={labelClass}>
              Email {isCommercial && <span className="text-red-500">*</span>}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required={isCommercial}
              defaultValue={dv(defaults?.email)}
              placeholder="contact@example.com"
              className={inputClass}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-500">{errors.email}</p>
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
                defaultValue={dv(defaults?.website)}
                placeholder="example.com"
                className={inputClass}
              />
              {errors.website && (
                <p className="mt-1 text-sm text-red-500">{errors.website}</p>
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
                defaultValue={dv(defaults?.annual_contract_value)}
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
              defaultValue={dv(defaults?.address_line_1)}
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
              defaultValue={dv(defaults?.address_line_2)}
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
              defaultValue={dv(defaults?.town)}
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
              defaultValue={dv(defaults?.county)}
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
              defaultValue={dv(defaults?.postcode)}
              placeholder="ME14 1XX"
              className={`${inputClass} uppercase`}
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          {isCommercial
            ? "Used on invoices, and also saved as the primary service location."
            : "Saved as the address where visits will happen. You can edit it later from the customer page."}
        </p>
      </section>

      {extraSection}

      {/* ── Notes ── */}
      <section className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Notes
        </h3>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={dv(defaults?.notes)}
          placeholder="e.g. preferred visit times, access instructions, key contacts, anything worth remembering."
          className={inputClass}
        />
      </section>
    </>
  );
}
