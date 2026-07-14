"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import {
  createAgreementAction,
  createDraftAgreementAction,
} from "@/app/(app)/sites/[id]/agreements/actions";
import { useEnsureCustomerDocReady } from "@/components/documents/doc-ready-provider";
import { PMA_PESTS } from "@/lib/constants/job-labels";
import { OTHER_PILL, encodeOther } from "@/lib/utils/other-describe";
import { DEFAULT_TERMS } from "@/lib/constants/agreement-terms";
import { SignaturePad } from "@/components/ui/signature-pad";
import { todayUk, dateUk } from "@/lib/utils/today-uk";
import type { ActionState } from "@/types/actions";
import type { Customer } from "@/types/database";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

const STEP_LABELS = ["Contact", "Agreement", "Terms", "Signatures"] as const;

function getErrorStep(errors: Record<string, string>): number | null {
  if (
    errors.reference_number ||
    errors.contact_name ||
    errors.contact_phone ||
    errors.contact_email ||
    errors.invoice_address
  )
    return 1;
  if (
    errors.start_date ||
    errors.visit_frequency ||
    errors.contract_value ||
    errors.pest_species ||
    errors.callout_terms
  )
    return 2;
  if (errors.terms_text) return 3;
  if (errors.gem_signature || errors.client_signature || errors.client_signatory_name)
    return 4;
  return null;
}

export function AddAgreementForm({
  siteId,
  customer,
}: {
  siteId: string;
  customer?: Customer | null;
}) {
  const [state, action, isPending] = useActionState(
    createAgreementAction,
    initialState
  );
  // Draft path: "Save as draft" dispatches here (signatures optional). On
  // success it redirects to the draft detail page, so there is no success
  // card to render for this one.
  const [draftState, draftAction, draftPending] = useActionState(
    createDraftAgreementAction,
    initialState
  );
  const ensureReady = useEnsureCustomerDocReady();
  const [step, setStep] = useState(1);

  // Field errors + message merged across both submit paths (only one runs
  // per submit), so inline errors and the error banner show either way.
  const formErrors = { ...state.errors, ...draftState.errors };
  const formMessage = state.message ?? draftState.message;
  const pending = isPending || draftPending;

  // Form action: offer the document-completeness gate first (so the
  // customer's email can be added before the server action's send leg runs),
  // then dispatch either way — the agreement always generates; only the SEND
  // is conditional on the email being present server-side. This lives on the
  // FORM (not a button onClick) so an Enter-key submit can't bypass the gate.
  async function handleSubmit(formData: FormData) {
    // An "Other" pill with no description must not save a bare "Other".
    // Block before the send-gate/dispatch and route back to the pest step.
    if (selectedPests.includes(OTHER_PILL) && !otherPest.trim()) {
      setOtherPestError("Describe the other pest");
      setStep(2);
      return;
    }
    setOtherPestError(null);
    if (customer) {
      await ensureReady(customer, { verb: "send", doc: "agreement" });
    }
    action(formData);
  }

  // "Save as draft": create an unsigned proposal and go to its detail page
  // (no signatures, no visits, no send-gate — the review copy is sent from
  // there). Same "Other" pest guard as the full submit.
  function handleSaveDraft(formData: FormData) {
    if (selectedPests.includes(OTHER_PILL) && !otherPest.trim()) {
      setOtherPestError("Describe the other pest");
      setStep(2);
      return;
    }
    setOtherPestError(null);
    draftAction(formData);
  }
  const [selectedPests, setSelectedPests] = useState<string[]>([]);
  const [otherPest, setOtherPest] = useState("");
  const [otherPestError, setOtherPestError] = useState<string | null>(null);
  const [clientSig, setClientSig] = useState("");
  const [gemSig, setGemSig] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const prevErrorsRef = useRef<Record<string, string>>({});

  // Navigate to the offending step when server-side validation errors arrive.
  useEffect(() => {
    const prev = prevErrorsRef.current;
    const curr = { ...state.errors, ...draftState.errors };
    const changed = Object.keys(curr).some((k) => curr[k] !== prev[k]);
    if (changed) {
      const errorStep = getErrorStep(curr);
      if (errorStep) setStep(errorStep);
      prevErrorsRef.current = curr;
    }
  }, [state.errors, draftState.errors]);

  if (state.success) {
    return (
      <div className="rounded-xl border border-brand bg-brand-soft p-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft">
          <svg className="h-5 w-5 text-brand-darker" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <p className="text-sm font-medium text-brand-darker">Pest Management Agreement created</p>
        <p className="mt-1 text-xs text-brand-darker">Scheduled visits generated and contract PDF produced.</p>
      </div>
    );
  }

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-dark"
      >
        New Agreement
      </button>
    );
  }

  const togglePest = (pest: string) => {
    setSelectedPests((prev) =>
      prev.includes(pest) ? prev.filter((p) => p !== pest) : [...prev, pest]
    );
  };

  const inputClass =
    "mt-1 block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

  const labelClass = "block text-sm font-medium text-gray-700 mb-0.5";

  return (
    <form action={handleSubmit}>
      <input type="hidden" name="site_id" value={siteId} />
      <input type="hidden" name="pest_species" value={JSON.stringify(encodeOther(selectedPests, otherPest))} />
      <input type="hidden" name="client_signature" value={clientSig} />
      <input type="hidden" name="gem_signature" value={gemSig} />

      {/* Step indicators */}
      <div className="mb-8 flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const num = i + 1;
          const isActive = num === step;
          const isDone = num < step;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setStep(num)}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                isActive
                  ? "bg-brand text-white shadow-sm"
                  : isDone
                    ? "bg-brand-soft text-brand-darker"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {isDone ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                num
              )}
            </button>
          );
        })}
        <span className="ml-3 text-sm font-medium text-gray-500">
          {STEP_LABELS[step - 1]}
        </span>
      </div>

      {formMessage && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-600">
          {formMessage}
        </div>
      )}

      {/* ── Step 1: Customer & Contact Details ── */}
      <div className={step === 1 ? "space-y-5" : "hidden"}>
        <div>
          <label htmlFor="reference_number" className={labelClass}>
            GEM Services Reference <span className="text-red-500">*</span>
          </label>
          <input
            id="reference_number"
            type="text"
            name="reference_number"
            placeholder="e.g. GEM-2026-001"
            autoFocus
            required
            className={inputClass}
          />
          {formErrors.reference_number && (
            <p className="mt-1 text-xs text-red-500">{formErrors.reference_number}</p>
          )}
        </div>
        <div>
          <label htmlFor="contact_name" className={labelClass}>
            Company / Owner Name <span className="text-red-500">*</span>
          </label>
          <input
            id="contact_name"
            type="text"
            name="contact_name"
            required
            placeholder="Business name or primary contact"
            className={inputClass}
          />
          {formErrors.contact_name && (
            <p className="mt-1 text-xs text-red-500">{formErrors.contact_name}</p>
          )}
        </div>
        <div>
          <label htmlFor="invoice_address" className={labelClass}>
            Invoice Address <span className="text-red-500">*</span>
          </label>
          <textarea
            id="invoice_address"
            name="invoice_address"
            rows={3}
            required
            placeholder="Street, Town, County, Postcode"
            className={inputClass}
          />
          {formErrors.invoice_address && (
            <p className="mt-1 text-xs text-red-500">{formErrors.invoice_address}</p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="contact_phone" className={labelClass}>
              Telephone <span className="text-red-500">*</span>
            </label>
            <input id="contact_phone" type="tel" name="contact_phone" required placeholder="01xxx xxx xxx" className={inputClass} />
            {formErrors.contact_phone && (
              <p className="mt-1 text-xs text-red-500">{formErrors.contact_phone}</p>
            )}
          </div>
          <div>
            <label htmlFor="mobile" className={labelClass}>Mobile</label>
            <input id="mobile" type="tel" name="mobile" placeholder="07xxx xxx xxx" className={inputClass} />
          </div>
        </div>
        <div>
          <label htmlFor="contact_email" className={labelClass}>
            Email <span className="text-red-500">*</span>
          </label>
          <input id="contact_email" type="email" name="contact_email" required placeholder="contact@example.com" className={inputClass} />
          {formErrors.contact_email && (
            <p className="mt-1 text-xs text-red-500">{formErrors.contact_email}</p>
          )}
        </div>
        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button type="button" onClick={() => setStep(2)} className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">
            Next
          </button>
        </div>
      </div>

      {/* ── Step 2: Agreement Details ── */}
      <div className={step === 2 ? "space-y-5" : "hidden"}>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="contract_value" className={labelClass}>
              Annual Agreement Value <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">&pound;</span>
              <input id="contract_value" type="number" name="contract_value" required min={0} step="0.01" placeholder="0.00" className={`${inputClass} pl-8`} />
            </div>
            {formErrors.contract_value && <p className="mt-1 text-xs text-red-500">{formErrors.contract_value}</p>}
          </div>
          <div>
            <label htmlFor="start_date" className={labelClass}>
              Start Date <span className="text-red-500">*</span>
            </label>
            <input
              id="start_date"
              type="date"
              name="start_date"
              required
              defaultValue={todayUk()}
              className={inputClass}
            />
            {formErrors.start_date && <p className="mt-1 text-xs text-red-500">{formErrors.start_date}</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="end_date" className={labelClass}>
              Renewal Date
            </label>
            <input
              id="end_date"
              type="date"
              name="end_date"
              defaultValue={(() => {
                const d = new Date();
                d.setFullYear(d.getFullYear() + 1);
                return dateUk(d);
              })()}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400">
              When this PMA is up for renewal. Defaults to one year from
              start.
            </p>
          </div>
        </div>
        <div>
          <label className={labelClass}>
            Pest Species Managed <span className="text-red-500">*</span>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {PMA_PESTS.map((pest) => (
              <button
                key={pest}
                type="button"
                onClick={() => togglePest(pest)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedPests.includes(pest)
                    ? "border-brand bg-brand text-white"
                    : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                {pest}
              </button>
            ))}
          </div>
          {formErrors.pest_species && <p className="mt-1 text-xs text-red-500">{formErrors.pest_species}</p>}
          {selectedPests.includes(OTHER_PILL) && (
            <div className="mt-3">
              <label htmlFor="pest_other" className={labelClass}>
                Describe the other pest <span className="text-red-500">*</span>
              </label>
              <input
                id="pest_other"
                type="text"
                value={otherPest}
                onChange={(e) => {
                  setOtherPest(e.target.value);
                  if (otherPestError) setOtherPestError(null);
                }}
                placeholder="e.g. Cockroaches"
                className={inputClass}
              />
              {otherPestError && (
                <p className="mt-1 text-xs text-red-500">{otherPestError}</p>
              )}
            </div>
          )}
        </div>
        <div>
          <label htmlFor="visit_frequency" className={labelClass}>
            Scheduled Visits Per Year <span className="text-red-500">*</span>
          </label>
          <input
            id="visit_frequency"
            type="number"
            name="visit_frequency"
            required
            min={1}
            max={52}
            defaultValue={12}
            className={inputClass}
          />
          {formErrors.visit_frequency && <p className="mt-1 text-xs text-red-500">{formErrors.visit_frequency}</p>}
        </div>
        <div>
          <label htmlFor="callout_terms" className={labelClass}>
            Call Out Arrangement <span className="text-red-500">*</span>
          </label>
          <textarea id="callout_terms" name="callout_terms" rows={3} required placeholder="e.g. Response within 24 hours, included in agreement for covered pests. Out-of-hours rates apply for evenings/weekends." className={inputClass} />
          {formErrors.callout_terms && <p className="mt-1 text-xs text-red-500">{formErrors.callout_terms}</p>}
        </div>
        <div className="flex justify-between pt-4">
          <button type="button" onClick={() => setStep(1)} className="rounded-xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">Back</button>
          <button type="button" onClick={() => setStep(3)} className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">Next</button>
        </div>
      </div>

      {/* ── Step 3: Terms & Conditions ── */}
      <div className={step === 3 ? "space-y-5" : "hidden"}>
        <div>
          <label htmlFor="terms_text" className={labelClass}>Terms &amp; Conditions</label>
          <textarea
            id="terms_text"
            name="terms_text"
            rows={16}
            defaultValue={DEFAULT_TERMS}
            className="mt-1 block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm leading-relaxed text-gray-900 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <p className="mt-2 text-xs text-gray-400">Standard PMA terms are pre-filled. Edit only if required for this agreement.</p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded border-gray-300 text-brand-darker focus:ring-brand"
          />
          <div>
            <span className="text-sm font-medium text-gray-900">I have read, understood and agree to the terms &amp; conditions</span>
            <p className="mt-0.5 text-xs text-gray-500">Both parties will be bound once signed on the next step.</p>
          </div>
        </label>
        <div className="flex items-center justify-between pt-4">
          <button type="button" onClick={() => setStep(2)} className="rounded-xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">Back</button>
          <div className="flex items-center gap-2">
            {/* Save an unsigned draft to send for review. Not gated on the
                "I agree" tick (the customer has not agreed yet); signatures
                are captured later. Submits the whole form (all steps are in
                the DOM) with empty signatures. */}
            <button
              type="submit"
              formAction={handleSaveDraft}
              disabled={pending}
              className="rounded-xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {draftPending ? "Saving..." : "Save as draft"}
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              disabled={!termsAccepted}
              className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Step 4: Signatures ── */}
      <div className={step === 4 ? "space-y-6" : "hidden"}>
        <SignaturePad
          label="Signed By GEM Services *"
          onSignature={setGemSig}
          onClear={() => setGemSig("")}
        />
        {formErrors.gem_signature && (
          <p className="-mt-4 text-xs text-red-500">{formErrors.gem_signature}</p>
        )}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="signed_date" className={labelClass}>Date</label>
            <input
              id="signed_date"
              type="date"
              name="signed_date"
              defaultValue={todayUk()}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="client_signatory_name" className={labelClass}>
              Name Of Signee <span className="text-red-500">*</span>
            </label>
            <input id="client_signatory_name" type="text" name="client_signatory_name" required placeholder="Full name of person signing" className={inputClass} />
            {formErrors.client_signatory_name && (
              <p className="mt-1 text-xs text-red-500">{formErrors.client_signatory_name}</p>
            )}
          </div>
        </div>
        <SignaturePad
          label="Signed By Client *"
          onSignature={setClientSig}
          onClear={() => setClientSig("")}
        />
        {formErrors.client_signature && (
          <p className="-mt-4 text-xs text-red-500">{formErrors.client_signature}</p>
        )}
        <div className="flex justify-between pt-4">
          <button type="button" onClick={() => setStep(3)} className="rounded-xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">Back</button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {isPending ? "Creating..." : "Create Agreement"}
          </button>
        </div>
      </div>
    </form>
  );
}
