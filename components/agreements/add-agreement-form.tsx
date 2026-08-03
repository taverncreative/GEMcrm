"use client";

import {
  useActionState,
  useState,
  useEffect,
  useRef,
  useTransition,
} from "react";
import {
  createAgreementAction,
  createDraftAgreementAction,
} from "@/app/(app)/sites/[id]/agreements/actions";
import { useEnsureCustomerDocReady } from "@/components/documents/doc-ready-provider";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { isNetworkError } from "@/lib/sync/is-network-error";
import {
  loadAgreementDraft,
  saveAgreementDraft,
  clearAgreementDraft,
  type AgreementDraft,
} from "@/lib/db/agreement-drafts";
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

/** Shown when the submit throws a transport-layer failure. Says the two
 *  things the operator standing in front of a customer needs to know:
 *  nothing was lost, and retrying is the right move. */
const NETWORK_MESSAGE =
  "Couldn't create the agreement — the connection dropped. Everything you " +
  "entered, including both signatures, has been saved on this device. Press " +
  "Create Agreement again once you have signal.";

/** Any other throw. Same reassurance, because the wizard now survives it. */
const UNEXPECTED_MESSAGE =
  "Couldn't create the agreement — something went wrong at our end. " +
  "Everything you entered, including both signatures, is still here. " +
  "Try again.";

/** Pre-flight refusal when the device is known to be offline. */
const OFFLINE_MESSAGE =
  "You're offline. Creating an agreement needs a connection — it uploads " +
  "the signatures, produces the contract PDF and books the visits. Your " +
  "details are saved on this device; finish this off once you have signal.";

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

interface AddAgreementFormProps {
  siteId: string;
  customer?: Customer | null;
  /** Open the wizard on mount instead of showing the "New Agreement"
   *  button — used when arriving from the Agreements list front door,
   *  which has already resolved the customer + site. */
  defaultOpen?: boolean;
}

/**
 * Outer wrapper: resolves the persisted draft BEFORE the body mounts, so
 * the body's useState initial values can be seeded from it and the whole
 * wizard rehydrates in one mount (same pattern as ServiceSheetForm).
 *
 * A one-shot load rather than useLiveQuery: this form writes its own
 * draft on every keystroke, and a reactive query would re-render the
 * tree on each debounced save for no benefit — the body owns the state
 * from mount onwards.
 */
export function AddAgreementForm(props: AddAgreementFormProps) {
  const [draft, setDraft] = useState<AgreementDraft | null | undefined>(
    undefined
  );

  useEffect(() => {
    let alive = true;
    void loadAgreementDraft(props.siteId).then((d) => {
      if (alive) setDraft(d ?? null);
    });
    return () => {
      alive = false;
    };
  }, [props.siteId]);

  // `undefined` = the IDB read is still in flight. It resolves in
  // milliseconds; hold the same footprint so the card doesn't jump.
  if (draft === undefined) {
    return props.defaultOpen ? (
      <div className="animate-pulse">
        <div className="h-9 w-64 rounded bg-gray-100" />
        <div className="mt-6 h-64 rounded-xl bg-gray-100" />
      </div>
    ) : (
      // Placeholder only — hidden from the accessibility tree so it is
      // never announced or focusable as a second "New Agreement" control.
      <button
        type="button"
        disabled
        aria-hidden="true"
        tabIndex={-1}
        className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white opacity-60 shadow-sm"
      >
        New Agreement
      </button>
    );
  }

  return <AddAgreementFormBody {...props} draft={draft} />;
}

function AddAgreementFormBody({
  siteId,
  customer,
  defaultOpen = false,
  draft,
}: AddAgreementFormProps & { draft: AgreementDraft | null }) {
  // The create path deliberately does NOT use useActionState.
  //
  // Two reasons, both live field failures:
  //
  //   1. The dispatch has to happen after `await ensureReady(...)`, which
  //      puts it outside React's form-action transition — useActionState's
  //      isPending then never flips, so the button sat there reading
  //      "Create Agreement", enabled, for the whole request. On a slow
  //      connection that is indistinguishable from a dead button, which is
  //      exactly how it was reported ("nothing happens when you press it").
  //      React warns about this: "An async function with useActionState was
  //      called outside of a transition… isPending will not update
  //      correctly."
  //
  //   2. When the action THREW (dropped connection), useActionState
  //      rethrows during render, the route error boundary catches it, and
  //      the whole wizard unmounts inside 50ms — destroying both
  //      signatures the customer had just given, plus all 14 fields.
  //
  // useTransition + a direct awaited call inside try/catch fixes both: the
  // pending state is real, and NO failure can unmount the form. Note this
  // catches non-network throws too, unlike lib/actions/graceful.ts which
  // rethrows them — here, keeping two captured signatures on screen beats
  // surfacing an unexpected error to the boundary.
  const [state, setState] = useState<ActionState>(initialState);
  const [isPending, startTransition] = useTransition();
  // Covers the pre-dispatch window (the document-completeness gate awaits
  // before the action is ever called). Without it the button would still
  // look idle for that stretch.
  const [submitting, setSubmitting] = useState(false);
  const online = useIsOnline();
  // Draft path: "Save as draft" dispatches here (signatures optional). On
  // success it redirects to the draft detail page, so there is no success
  // card to render for this one.
  const [draftState, draftAction, draftPending] = useActionState(
    createDraftAgreementAction,
    initialState
  );
  const ensureReady = useEnsureCustomerDocReady();
  const [step, setStep] = useState(draft?.step ?? 1);

  // Field errors + message merged across both submit paths (only one runs
  // per submit), so inline errors and the error banner show either way.
  const formErrors = { ...state.errors, ...draftState.errors };
  const formMessage = state.message ?? draftState.message;
  // `submitting` spans the whole operation (gate + action); isPending is
  // the transition's own view of the awaited call. Both feed the button so
  // it is disabled and reads "Creating..." from the first press to the
  // final result, with no dead window at either end.
  const creating = submitting || isPending;
  const pending = creating || draftPending;

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
    // Pre-flight connectivity refusal. Creating an agreement is online-only
    // (signature upload, PDF render, visit generation all happen server
    // side), so say so plainly instead of letting the request hang.
    if (!online) {
      setState({ success: false, errors: {}, message: OFFLINE_MESSAGE });
      return;
    }
    // Set BEFORE the await — the gate can show a prompt and the operator
    // must see the button react to their press either way.
    setSubmitting(true);
    if (customer) {
      await ensureReady(customer, { verb: "send", doc: "agreement" });
    }
    startTransition(async () => {
      try {
        const result = await createAgreementAction(state, formData);
        setState(result);
        // Created for real — the local copy has done its job.
        if (result.success) await clearAgreementDraft(siteId);
      } catch (err) {
        setState({
          success: false,
          errors: {},
          message: isNetworkError(err) ? NETWORK_MESSAGE : UNEXPECTED_MESSAGE,
        });
      } finally {
        setSubmitting(false);
      }
    });
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
    // Also a server action, so also online-only. Refuse the same way
    // rather than letting this one hang.
    if (!online) {
      setState({ success: false, errors: {}, message: OFFLINE_MESSAGE });
      return;
    }
    draftAction(formData);
  }
  // Every one of these seeds from the persisted draft when there is one,
  // so a reload / crash / accidental navigation mid-fill comes back with
  // the wizard exactly as the operator left it — signatures included.
  const [selectedPests, setSelectedPests] = useState<string[]>(
    draft?.selected_pests ?? []
  );
  const [otherPest, setOtherPest] = useState(draft?.other_pest ?? "");
  const [otherPestError, setOtherPestError] = useState<string | null>(null);
  const [clientSig, setClientSig] = useState(draft?.client_signature ?? "");
  const [gemSig, setGemSig] = useState(draft?.gem_signature ?? "");
  const [termsAccepted, setTermsAccepted] = useState(
    draft?.terms_accepted ?? false
  );
  // A restored draft means an agreement was already in progress here, so
  // open the wizard on it rather than hiding it behind the button.
  const [showForm, setShowForm] = useState(defaultOpen || !!draft);
  const prevErrorsRef = useRef<Record<string, string>>({});
  // The data URLs the pads were mounted with. Held constant for the life
  // of the mount: passing the live signature state back in would make the
  // pad repaint its own output on every resize.
  const initialSigsRef = useRef({
    gem: draft?.gem_signature ?? "",
    client: draft?.client_signature ?? "",
  });

  // Every text/date/number input is CONTROLLED, like BookingModal (see its
  // header comment): React's form-action behaviour resets uncontrolled
  // inputs on submit, INCLUDING failed submits. Uncontrolled, a validation
  // failure wiped a fully-filled contract form and the retry submitted the
  // emptied fields (the live bug). Controlled state survives the round trip,
  // so a failure re-renders with everything the user typed still present.
  const [fields, setFields] = useState(() => {
    const defaults = {
      reference_number: "",
      contact_name: "",
      invoice_address: "",
      contact_phone: "",
      mobile: "",
      contact_email: "",
      contract_value: "",
      start_date: todayUk(),
      end_date: (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        return dateUk(d);
      })(),
      visit_frequency: "12",
      callout_terms: "",
      terms_text: DEFAULT_TERMS,
      signed_date: todayUk(),
      client_signatory_name: "",
    };
    // Draft values win where present. Spread key-by-key rather than
    // wholesale so a draft written by an older build (missing a field
    // added since) still loads, with the new field on its default.
    if (!draft) return defaults;
    const restored = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
      const saved = draft.fields[key];
      if (typeof saved === "string") restored[key] = saved;
    }
    return restored;
  });
  const setField =
    (key: keyof typeof fields) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) =>
      setFields((prev) => ({ ...prev, [key]: e.target.value }));

  // ─── Draft persistence ────────────────────────────────────────────
  //
  // Mirror the whole wizard into IndexedDB, debounced, on every change.
  // The in-memory try/catch keeps the form mounted through a failed
  // submit; this keeps the work alive through things React can't catch —
  // a tab reclaimed by the OS, a back-swipe, an app restart, a crash.
  // Signatures are the point: they cannot be re-captured once the
  // customer has walked away.
  const draftSavedOnceRef = useRef(false);
  useEffect(() => {
    // Skip the first run when there is nothing worth saving, so merely
    // opening the wizard doesn't leave a ghost row behind.
    if (!draftSavedOnceRef.current) {
      const hasContent =
        gemSig !== "" ||
        clientSig !== "" ||
        selectedPests.length > 0 ||
        otherPest !== "" ||
        termsAccepted ||
        fields.reference_number !== "" ||
        fields.contact_name !== "" ||
        fields.invoice_address !== "" ||
        fields.contact_phone !== "" ||
        fields.mobile !== "" ||
        fields.contact_email !== "" ||
        fields.contract_value !== "" ||
        fields.callout_terms !== "" ||
        fields.client_signatory_name !== "";
      if (!hasContent) return;
      draftSavedOnceRef.current = true;
    }
    const t = setTimeout(() => {
      void saveAgreementDraft({
        site_id: siteId,
        step,
        fields,
        selected_pests: selectedPests,
        other_pest: otherPest,
        terms_accepted: termsAccepted,
        gem_signature: gemSig,
        client_signature: clientSig,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [
    siteId,
    step,
    fields,
    selectedPests,
    otherPest,
    termsAccepted,
    gemSig,
    clientSig,
  ]);

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

      {/* Connectivity notice, shown UP FRONT — as soon as the wizard is
          open and the device is offline, not after four steps and two
          signatures. Mirrors the gating agreement-finalise.tsx and
          agreement-send.tsx already do. */}
      {!online && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-medium">You&apos;re offline</p>
          <p className="mt-1">
            You can fill this in and it will be saved on this device, but
            creating the agreement needs a connection — it uploads the
            signatures, produces the contract PDF and books the visits.
          </p>
        </div>
      )}

      {formMessage && (
        <div
          role="alert"
          className="mb-6 rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-600"
        >
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
            value={fields.reference_number}
            onChange={setField("reference_number")}
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
            value={fields.contact_name}
            onChange={setField("contact_name")}
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
            value={fields.invoice_address}
            onChange={setField("invoice_address")}
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
            <input id="contact_phone" type="tel" name="contact_phone" value={fields.contact_phone} onChange={setField("contact_phone")} required placeholder="01xxx xxx xxx" className={inputClass} />
            {formErrors.contact_phone && (
              <p className="mt-1 text-xs text-red-500">{formErrors.contact_phone}</p>
            )}
          </div>
          <div>
            <label htmlFor="mobile" className={labelClass}>Mobile</label>
            <input id="mobile" type="tel" name="mobile" value={fields.mobile} onChange={setField("mobile")} placeholder="07xxx xxx xxx" className={inputClass} />
          </div>
        </div>
        <div>
          <label htmlFor="contact_email" className={labelClass}>
            Email <span className="text-red-500">*</span>
          </label>
          <input id="contact_email" type="email" name="contact_email" value={fields.contact_email} onChange={setField("contact_email")} required placeholder="contact@example.com" className={inputClass} />
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
              <input id="contract_value" type="number" name="contract_value" value={fields.contract_value} onChange={setField("contract_value")} required min={0} step="0.01" placeholder="0.00" className={`${inputClass} pl-8`} />
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
              value={fields.start_date}
              onChange={setField("start_date")}
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
              value={fields.end_date}
              onChange={setField("end_date")}
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
            value={fields.visit_frequency}
            onChange={setField("visit_frequency")}
            className={inputClass}
          />
          {formErrors.visit_frequency && <p className="mt-1 text-xs text-red-500">{formErrors.visit_frequency}</p>}
        </div>
        <div>
          <label htmlFor="callout_terms" className={labelClass}>
            Call Out Arrangement <span className="text-red-500">*</span>
          </label>
          <textarea id="callout_terms" name="callout_terms" value={fields.callout_terms} onChange={setField("callout_terms")} rows={3} required placeholder="e.g. Response within 24 hours, included in agreement for covered pests. Out-of-hours rates apply for evenings/weekends." className={inputClass} />
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
            value={fields.terms_text}
            onChange={setField("terms_text")}
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
                the DOM) with empty signatures.

                formNoValidate is LOAD-BEARING: every step stays mounted
                (CSS-hidden), so step 4's required signee field is empty and
                invisible at this point. Without it the browser blocks the
                submit on constraint validation and cannot anchor the
                validation bubble to an invisible control — the click just
                dies (the live "unresponsive Save as draft" bug).
                DraftAgreementSchema is the real gate; its errors surface
                inline and route to the offending step. */}
            <button
              type="submit"
              formAction={handleSaveDraft}
              formNoValidate
              disabled={pending || !online}
              title={online ? undefined : "Saving a draft needs a connection"}
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
          initialDataUrl={initialSigsRef.current.gem}
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
              value={fields.signed_date}
              onChange={setField("signed_date")}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="client_signatory_name" className={labelClass}>
              Name Of Signee <span className="text-red-500">*</span>
            </label>
            <input id="client_signatory_name" type="text" name="client_signatory_name" value={fields.client_signatory_name} onChange={setField("client_signatory_name")} required placeholder="Full name of person signing" className={inputClass} />
            {formErrors.client_signatory_name && (
              <p className="mt-1 text-xs text-red-500">{formErrors.client_signatory_name}</p>
            )}
          </div>
        </div>
        <SignaturePad
          label="Signed By Client *"
          onSignature={setClientSig}
          onClear={() => setClientSig("")}
          initialDataUrl={initialSigsRef.current.client}
        />
        {formErrors.client_signature && (
          <p className="-mt-4 text-xs text-red-500">{formErrors.client_signature}</p>
        )}
        <div className="flex justify-between pt-4">
          <button type="button" onClick={() => setStep(3)} className="rounded-xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">Back</button>
          {/* Same hidden-required-field trap as Save as draft: steps 1-3 are
              CSS-hidden here, so an unfilled earlier step would silently
              block this submit too. AgreementSchema validates server-side
              and its errors route to the offending step. */}
          <button
            type="submit"
            formNoValidate
            disabled={pending || !online}
            title={
              online ? undefined : "Creating an agreement needs a connection"
            }
            className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {/* `creating`, not the transition's isPending alone: the label
                has to change on the first press, before the pre-dispatch
                gate has resolved. */}
            {creating ? "Creating..." : "Create Agreement"}
          </button>
        </div>
      </div>
    </form>
  );
}
