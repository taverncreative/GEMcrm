"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  createInvoiceDraftAction,
  sendInvoiceAction,
  type CreateDraftResult,
} from "@/app/(app)/invoices/actions";
import { searchCustomersAction } from "@/app/(app)/bookings/actions";
import { buildInvoiceEmailDraft } from "@/lib/services/invoice-email";
import { dateUkOffset } from "@/lib/utils/today-uk";
import { BUSINESS } from "@/lib/constants/branding";
import type { Customer, Invoice } from "@/types/database";
import { wrapFormActionGracefully } from "@/lib/actions/graceful";

// Wrapped so a transport-layer failure on submit (Wi-Fi off etc) lands
// in the modal's state with a "…connection lost…" message instead of
// hanging silently. Server-side errors pass through unchanged.
const gracefulCreateInvoiceDraftAction = wrapFormActionGracefully(
  createInvoiceDraftAction
);

const initialState: CreateDraftResult = {
  success: false,
  errors: {},
  message: null,
};

type VatMode = "standard_exclusive" | "standard_inclusive" | "zero";

const VAT_RATE = 20;

interface InvoiceCreatorModalProps {
  open: boolean;
  onClose: () => void;
  presetCustomer?: Customer | null;
  presetJobId?: string | null;
  presetAmount?: number | null;
  presetDescription?: string | null;
}

interface AmountBreakdown {
  subtotal: number;
  vat: number;
  total: number;
}

/**
 * Compute the three figures the PDF stores from the user's input.
 *
 *   standard_exclusive: amount IS net   → total = amount * 1.2
 *   standard_inclusive: amount IS gross → net = amount / 1.2
 *   zero:               amount IS net   → total == amount, vat = 0
 */
function computeBreakdown(amount: number, mode: VatMode): AmountBreakdown {
  const round = (n: number) => Math.round(n * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { subtotal: 0, vat: 0, total: 0 };
  }
  if (mode === "zero") {
    return { subtotal: round(amount), vat: 0, total: round(amount) };
  }
  if (mode === "standard_inclusive") {
    const subtotal = round(amount / (1 + VAT_RATE / 100));
    const vat = round(amount - subtotal);
    return { subtotal, vat, total: round(amount) };
  }
  const vat = round(amount * (VAT_RATE / 100));
  const total = round(amount + vat);
  return { subtotal: round(amount), vat, total };
}

function formatGbp(value: number): string {
  return `£${Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Two-step invoice modal — Xero-style.
 *
 *   Step 1 (Edit):    customer + amount + VAT mode + description + due date
 *   Step 2 (Preview): PDF preview + editable email subject/body, then Send
 *
 * Step 1 saves a draft and generates the PDF. Step 2 dispatches the email
 * and flips status to sent. The user can close the modal at any point —
 * the draft persists.
 *
 * All inputs are controlled state so re-renders / failed submits never
 * wipe the user's work.
 */
export function InvoiceCreatorModal({
  open,
  onClose,
  presetCustomer = null,
  presetJobId = null,
  presetAmount = null,
  presetDescription = null,
}: InvoiceCreatorModalProps) {
  const router = useRouter();
  const lastOpenRef = useRef(false);

  const [step, setStep] = useState<"edit" | "preview">("edit");

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    presetCustomer
  );
  const [customerQuery, setCustomerQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [amount, setAmount] = useState<string>(
    presetAmount != null ? String(presetAmount) : ""
  );
  const [vatMode, setVatMode] = useState<VatMode>("standard_exclusive");
  const [description, setDescription] = useState<string>(
    presetDescription ?? ""
  );
  const [dueDate, setDueDate] = useState<string>(() => dateUkOffset(30));

  const [draftInvoice, setDraftInvoice] = useState<{
    id: string;
    pdfUrl: string | null;
  } | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [isSending, startSendTransition] = useTransition();

  const [draftState, draftAction, draftPending] = useActionState(
    gracefulCreateInvoiceDraftAction,
    initialState
  );

  useEffect(() => {
    if (!open) {
      lastOpenRef.current = false;
      return;
    }
    if (lastOpenRef.current) return;
    lastOpenRef.current = true;

    setStep("edit");
    setSelectedCustomer(presetCustomer);
    setCustomerQuery("");
    setAmount(presetAmount != null ? String(presetAmount) : "");
    setVatMode("standard_exclusive");
    setDescription(presetDescription ?? "");
    setDueDate(dateUkOffset(30));
    setDraftInvoice(null);
    setEmailSubject("");
    setEmailBody("");
    setSendError(null);
    setSendSuccess(false);

    if (!presetCustomer) {
      setLoadingResults(true);
      void searchCustomersAction("").then((r) => {
        setResults(r);
        setLoadingResults(false);
      });
    }
  }, [open, presetCustomer, presetAmount, presetDescription]);

  // After successful draft save, move to preview + prefill email.
  useEffect(() => {
    if (draftState.success && draftState.invoiceId) {
      setDraftInvoice({
        id: draftState.invoiceId,
        pdfUrl: draftState.pdfUrl ?? null,
      });
      setStep("preview");
      router.refresh();

      if (selectedCustomer) {
        const breakdown = computeBreakdown(Number(amount), vatMode);
        const draftSummary = buildInvoiceEmailDraft(selectedCustomer, {
          id: draftState.invoiceId,
          customer_id: selectedCustomer.id,
          job_id: presetJobId ?? null,
          amount: breakdown.total,
          subtotal_amount: breakdown.subtotal,
          vat_amount: breakdown.vat,
          vat_rate: vatMode === "zero" ? 0 : VAT_RATE,
          description: description || null,
          due_date: dueDate || null,
          invoice_number: null,
          status: "draft",
          issued_at: null,
          paid_at: null,
          pdf_url: draftState.pdfUrl ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Invoice);
        setEmailSubject(draftSummary.subject);
        setEmailBody(draftSummary.body);
      }
    }
  }, [
    draftState,
    selectedCustomer,
    amount,
    vatMode,
    description,
    dueDate,
    presetJobId,
    router,
  ]);

  const runSearch = useCallback((value: string) => {
    setCustomerQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setLoadingResults(true);
      void searchCustomersAction(value).then((r) => {
        setResults(r);
        setLoadingResults(false);
      });
    }, 200);
  }, []);

  function handleSend() {
    if (!draftInvoice) return;
    setSendError(null);
    startSendTransition(async () => {
      const res = await sendInvoiceAction(draftInvoice.id, {
        subject: emailSubject,
        body: emailBody,
      });
      if (res.success) {
        setSendSuccess(true);
        router.refresh();
      } else {
        setSendError(res.message ?? "Failed to send");
      }
    });
  }

  if (!open) return null;

  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelClass = "block text-xs font-medium text-gray-600";

  const breakdown = computeBreakdown(Number(amount), vatMode);

  return (
    // Full-screen on mobile; centered dialog capped at 90vh on tablet/desktop.
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:py-8">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative flex h-full w-full flex-col bg-white shadow-xl sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {step === "edit" ? "Create Invoice" : "Approve & Send"}
            </h2>
            <p className="text-xs text-gray-500">
              {step === "edit"
                ? "Step 1 of 2 — invoice details"
                : "Step 2 of 2 — review PDF and email"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 md:p-1.5"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {step === "edit" && (
          <form action={draftAction} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <input
              type="hidden"
              name="customer_id"
              value={selectedCustomer?.id ?? ""}
            />
            {presetJobId && (
              <input type="hidden" name="job_id" value={presetJobId} />
            )}
            <input type="hidden" name="subtotal" value={breakdown.subtotal} />
            <input type="hidden" name="vat_amount" value={breakdown.vat} />
            <input type="hidden" name="total" value={breakdown.total} />
            <input
              type="hidden"
              name="vat_rate"
              value={vatMode === "zero" ? 0 : VAT_RATE}
            />
            <input type="hidden" name="description" value={description} />
            <input type="hidden" name="due_date" value={dueDate} />

            {draftState.message && !draftState.success && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                {draftState.message}
              </div>
            )}

            {/* Customer */}
            <section>
              <p className={labelClass}>Customer</p>
              {selectedCustomer ? (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-brand bg-brand-soft px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-brand-darker">
                      {selectedCustomer.name}
                    </p>
                    {selectedCustomer.company_name && (
                      <p className="text-xs text-brand-darker">
                        {selectedCustomer.company_name}
                      </p>
                    )}
                  </div>
                  {!presetCustomer && (
                    <button
                      type="button"
                      onClick={() => setSelectedCustomer(null)}
                      className="text-xs font-medium text-brand-darker hover:text-brand-darker"
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={customerQuery}
                    onChange={(e) => runSearch(e.target.value)}
                    placeholder="Search…"
                    className={inputClass}
                  />
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-gray-100">
                    {loadingResults ? (
                      <p className="px-3 py-4 text-center text-xs text-gray-400">
                        Searching…
                      </p>
                    ) : results.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-gray-400">
                        No customers.
                      </p>
                    ) : (
                      results.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCustomer(c)}
                          className="flex w-full items-center gap-3 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50"
                        >
                          <span className="text-sm font-medium text-gray-900">
                            {c.name}
                          </span>
                          {c.company_name && (
                            <span className="truncate text-xs text-gray-500">
                              ({c.company_name})
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  {draftState.errors.customer_id && (
                    <p className="mt-1 text-xs text-red-500">
                      {draftState.errors.customer_id}
                    </p>
                  )}
                </>
              )}
            </section>

            {/* Description + amount + due date */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="ic-description" className={labelClass}>
                  Description
                </label>
                <textarea
                  id="ic-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="e.g. Routine pest control — wasps · 12 Jun 2026"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="ic-amount" className={labelClass}>
                  Amount <span className="text-red-500">*</span>
                </label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    £
                  </span>
                  <input
                    id="ic-amount"
                    type="number"
                    min={0.01}
                    step="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="block w-full rounded-lg border border-gray-200 bg-white py-2 pl-7 pr-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
                {(draftState.errors.subtotal || draftState.errors.total) && (
                  <p className="mt-1 text-xs text-red-500">
                    {draftState.errors.subtotal ?? draftState.errors.total}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="ic-due_date" className={labelClass}>
                  Due date
                </label>
                <input
                  id="ic-due_date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            {/* VAT mode */}
            <div>
              <p className={labelClass}>VAT treatment</p>
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <VatChoice
                  label="Add VAT (20%)"
                  hint="Amount is net; VAT added on top"
                  active={vatMode === "standard_exclusive"}
                  onClick={() => setVatMode("standard_exclusive")}
                />
                <VatChoice
                  label="VAT included (20%)"
                  hint="Amount is gross; split out"
                  active={vatMode === "standard_inclusive"}
                  onClick={() => setVatMode("standard_inclusive")}
                />
                <VatChoice
                  label="Zero rate"
                  hint="No VAT charged"
                  active={vatMode === "zero"}
                  onClick={() => setVatMode("zero")}
                />
              </div>

              <dl className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">Subtotal</dt>
                  <dd className="text-gray-900">
                    {formatGbp(breakdown.subtotal)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">
                    VAT {vatMode === "zero" ? "(Zero rated)" : `(${VAT_RATE}%)`}
                  </dt>
                  <dd className="text-gray-900">{formatGbp(breakdown.vat)}</dd>
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-gray-200 pt-2">
                  <dt className="font-semibold text-gray-900">Total due</dt>
                  <dd className="font-semibold text-gray-900">
                    {formatGbp(breakdown.total)}
                  </dd>
                </div>
              </dl>
            </div>

            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 bg-white px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:pb-3">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 sm:min-h-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={draftPending || !selectedCustomer || !amount}
                className="min-h-[44px] rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 sm:min-h-0"
              >
                {draftPending ? "Generating PDF…" : "Save & preview"}
              </button>
            </div>
          </form>
        )}

        {step === "preview" && draftInvoice && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <section>
              <p className={labelClass}>Invoice PDF</p>
              {draftInvoice.pdfUrl ? (
                <iframe
                  src={draftInvoice.pdfUrl}
                  title="Invoice preview"
                  className="mt-1 h-80 w-full rounded-lg border border-gray-200 bg-gray-50"
                />
              ) : (
                <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  PDF not generated. The invoice draft was saved — re-open it
                  later to retry. (Common cause: storage bucket not configured.)
                </div>
              )}
              {draftInvoice.pdfUrl && (
                <a
                  href={draftInvoice.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs font-medium text-brand-darker hover:text-brand-darker"
                >
                  Open in new tab →
                </a>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <p className={labelClass}>To</p>
                <input
                  type="email"
                  value={selectedCustomer?.email ?? ""}
                  readOnly
                  className={`${inputClass} bg-gray-50`}
                />
                {!selectedCustomer?.email && (
                  <p className="mt-1 text-xs text-amber-700">
                    This customer has no email on file. Add one to enable
                    sending.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="ic-subject" className={labelClass}>
                  Subject
                </label>
                <input
                  id="ic-subject"
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="ic-body" className={labelClass}>
                  Message
                </label>
                <textarea
                  id="ic-body"
                  rows={10}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className={`${inputClass} font-mono text-[13px] leading-relaxed`}
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  Signed off as {BUSINESS.signoffName}, {BUSINESS.name} — edit as needed.
                </p>
              </div>
            </section>

            {sendError && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                {sendError}
              </div>
            )}
            {sendSuccess && (
              <div className="rounded-lg border border-brand-soft bg-brand-soft p-3 text-sm text-brand-darker">
                Invoice sent. Status set to Sent.
              </div>
            )}

            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-gray-100 bg-white px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:pb-3">
              <button
                type="button"
                onClick={() => setStep("edit")}
                disabled={isSending || sendSuccess}
                className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 sm:min-h-0"
              >
                ← Back to edit
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 sm:min-h-0"
                >
                  {sendSuccess ? "Close" : "Keep as draft"}
                </button>
                {!sendSuccess && (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={isSending || !selectedCustomer?.email}
                    className="min-h-[44px] rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 sm:min-h-0"
                  >
                    {isSending ? "Sending…" : "Approve & send"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VatChoice({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? "border-brand bg-brand-soft"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      <p
        className={`text-sm font-medium ${
          active ? "text-brand-darker" : "text-gray-900"
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-0.5 text-[11px] ${
          active ? "text-brand-darker" : "text-gray-500"
        }`}
      >
        {hint}
      </p>
    </button>
  );
}
