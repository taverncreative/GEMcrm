"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { createQuoteAction } from "@/app/(app)/quotes/actions";
import { computeQuoteTotals, formatQuoteCurrency } from "@/lib/quotes/money";
import { INITIAL_ACTION_STATE } from "@/types/actions";
import type { QuoteCustomerOption } from "@/lib/data/quotes";

const DEFAULT_TERMS =
  "This quote is valid for 30 days from the date of issue. Prices are subject " +
  "to a site survey where required. Work will be scheduled once the quote is " +
  "accepted in writing.";

interface LineRow {
  description: string;
  qty: string;
  unit_price: string;
}

function blankRow(): LineRow {
  return { description: "", qty: "1", unit_price: "" };
}

/** Join a customer's structured address parts into one bill-to line. */
function joinAddress(c: QuoteCustomerOption): string {
  return [c.address_line_1, c.address_line_2, c.town, c.county, c.postcode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

interface QuoteFormProps {
  customers: QuoteCustomerOption[];
}

export function QuoteForm({ customers }: QuoteFormProps) {
  const [state, formAction] = useActionState(
    createQuoteAction,
    INITIAL_ACTION_STATE
  );

  const [mode, setMode] = useState<"existing" | "prospect">(
    customers.length > 0 ? "existing" : "prospect"
  );
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const [rows, setRows] = useState<LineRow[]>([blankRow()]);
  const [vatRegistered, setVatRegistered] = useState(false);
  const [vatRate, setVatRate] = useState("20");
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");

  function selectCustomer(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) {
      setCustomerName(c.company_name?.trim() || c.name);
      setCustomerAddress(joinAddress(c));
      setCustomerEmail(c.email ?? "");
    }
  }

  function switchMode(next: "existing" | "prospect") {
    setMode(next);
    // Clear the link + fields so the two paths never leak into each other.
    setCustomerId("");
    setCustomerName("");
    setCustomerAddress("");
    setCustomerEmail("");
  }

  function updateRow(i: number, patch: Partial<LineRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, blankRow()]);
  }
  function removeRow(i: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  // Live totals preview — same pure maths the server uses authoritatively.
  const totals = useMemo(
    () =>
      computeQuoteTotals(
        rows.map((r) => ({
          description: r.description,
          qty: Number(r.qty),
          unit_price: Number(r.unit_price),
        })),
        vatRegistered,
        Number(vatRate)
      ),
    [rows, vatRegistered, vatRate]
  );

  // Line items serialised for the server action (server recomputes line_total).
  const lineItemsJson = JSON.stringify(
    rows.map((r) => ({
      description: r.description.trim(),
      qty: Number(r.qty) || 0,
      unit_price: Number(r.unit_price) || 0,
    }))
  );

  const err = state.errors;

  return (
    <form action={formAction} className="space-y-6">
      {state.message && !state.success && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.message}
        </div>
      )}

      {/* Customer */}
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Customer</h2>
        <div className="mt-3 inline-flex rounded-lg border border-gray-200 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => switchMode("existing")}
            disabled={customers.length === 0}
            className={`rounded-md px-3 py-1.5 font-medium ${
              mode === "existing"
                ? "bg-brand text-white"
                : "text-gray-600 disabled:opacity-40"
            }`}
          >
            Existing customer
          </button>
          <button
            type="button"
            onClick={() => switchMode("prospect")}
            className={`rounded-md px-3 py-1.5 font-medium ${
              mode === "prospect" ? "bg-brand text-white" : "text-gray-600"
            }`}
          >
            New prospect
          </button>
        </div>

        {mode === "existing" && (
          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-500">
              Pick a customer
            </label>
            <select
              value={customerId}
              onChange={(e) => selectCustomer(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name?.trim() || c.name}
                  {c.company_name?.trim() ? ` (${c.name})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500">
              Name / company
            </label>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Who is the quote for?"
            />
            {err.customer_name && (
              <p className="mt-1 text-xs text-red-600">{err.customer_name}</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500">Address</label>
            <input
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Optional"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500">Email</label>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Optional"
            />
            {err.customer_email && (
              <p className="mt-1 text-xs text-red-600">{err.customer_email}</p>
            )}
          </div>
        </div>
      </section>

      {/* Line items */}
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Line items</h2>
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            + Add line
          </button>
        </div>
        {err.line_items && (
          <p className="mt-2 text-xs text-red-600">{err.line_items}</p>
        )}

        <div className="mt-3 space-y-2">
          {rows.map((row, i) => {
            const lineTotal =
              (Number(row.qty) || 0) * (Number(row.unit_price) || 0);
            return (
              <div key={i} className="flex items-start gap-2">
                <input
                  value={row.description}
                  onChange={(e) => updateRow(i, { description: e.target.value })}
                  placeholder="Description"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  value={row.qty}
                  onChange={(e) => updateRow(i, { qty: e.target.value })}
                  inputMode="decimal"
                  placeholder="Qty"
                  className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-right text-sm"
                />
                <input
                  value={row.unit_price}
                  onChange={(e) => updateRow(i, { unit_price: e.target.value })}
                  inputMode="decimal"
                  placeholder="Unit £"
                  className="w-24 rounded-lg border border-gray-300 px-2 py-2 text-right text-sm"
                />
                <div className="w-24 py-2 text-right text-sm tabular-nums text-gray-700">
                  {formatQuoteCurrency(lineTotal)}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={rows.length === 1}
                  aria-label="Remove line"
                  className="mt-1 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {/* VAT + totals */}
        <div className="mt-5 border-t border-gray-100 pt-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={vatRegistered}
              onChange={(e) => setVatRegistered(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            VAT registered
          </label>
          {vatRegistered && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-gray-500">Rate</span>
              <input
                value={vatRate}
                onChange={(e) => setVatRate(e.target.value)}
                inputMode="decimal"
                className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm"
              />
              <span className="text-gray-500">%</span>
            </div>
          )}

          <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
            {vatRegistered && (
              <>
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatQuoteCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>VAT ({Number(vatRate) || 0}%)</span>
                  <span className="tabular-nums">{formatQuoteCurrency(totals.vat_amount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold text-gray-900">
              <span>Total</span>
              <span className="tabular-nums">{formatQuoteCurrency(totals.total)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Details */}
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Details</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-500">Valid until</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-500">Terms</label>
          <textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-500">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional, shown on the quote"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </section>

      {/* Hidden fields carrying the serialised state into the form action. */}
      <input type="hidden" name="customer_id" value={mode === "existing" ? customerId : ""} />
      <input type="hidden" name="customer_name" value={customerName} />
      <input type="hidden" name="customer_address" value={customerAddress} />
      <input type="hidden" name="customer_email" value={customerEmail} />
      <input type="hidden" name="line_items" value={lineItemsJson} />
      {vatRegistered && <input type="hidden" name="vat_registered" value="on" />}
      <input type="hidden" name="vat_rate" value={vatRate} />
      <input type="hidden" name="terms" value={terms} />
      <input type="hidden" name="valid_until" value={validUntil} />
      <input type="hidden" name="notes" value={notes} />

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create quote"}
    </button>
  );
}
