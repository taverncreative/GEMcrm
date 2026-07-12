"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { completeServiceSheetAction } from "@/app/(app)/jobs/[id]/complete/actions";
import { ROUTES } from "@/lib/constants/routes";
import {
  RISK_LEVELS,
  TREATMENT_METHODS,
  CALL_TYPES,
  ServiceSheetSchema,
  type ServiceSheetInput,
} from "@/lib/validation/service-sheet";
import {
  RISK_LEVEL_LABELS,
  COMMON_PESTS,
  CALL_TYPE_LABELS,
} from "@/lib/constants/job-labels";
import { SignaturePad } from "@/components/ui/signature-pad";
import { PhotoUpload } from "@/components/ui/photo-upload";
import { todayUk, dateUkOffset } from "@/lib/utils/today-uk";
import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import { isPhotoClientId, photoPublicUrl } from "@/lib/photos/path";
import {
  loadDraft,
  saveDraft,
  clearDraft,
  type ServiceSheetDraft,
} from "@/lib/db/drafts";
import { useLiveQuery } from "dexie-react-hooks";
import { useEnsureCustomerDocReady } from "@/components/documents/doc-ready-provider";

/** Sheet input + the combined-finalize flag (offline-pwa pass B) and
 *  the amend flag (L2). The flags ride along so applyLocal knows
 *  whether this submission also completes the job locally (finalize)
 *  or is editing an already-completed sheet (amend — job_status is
 *  never touched). */
export interface CompleteSheetInput extends ServiceSheetInput {
  finalize: boolean;
  amend: boolean;
}

function buildRawSheetInput(formData: FormData) {
  function parseJsonArray(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (i): i is string => typeof i === "string" && i.length > 0
      );
    } catch {
      return [];
    }
  }
  return {
    job_id: (formData.get("job_id") as string) ?? "",
    call_type: (formData.get("call_type") as string) ?? "",
    pest_species: parseJsonArray(formData.get("pest_species") as string | null),
    findings: (formData.get("findings") as string) ?? "",
    recommendations: (formData.get("recommendations") as string) ?? "",
    report_notes: (formData.get("report_notes") as string) ?? "",
    method_used: parseJsonArray(formData.get("method_used") as string | null),
    pesticides_used: (formData.get("pesticides_used") as string) ?? "",
    risk_level: (formData.get("risk_level") as string) ?? "",
    risk_comments: (formData.get("risk_comments") as string) ?? "",
    photo_data_urls: parseJsonArray(
      formData.get("photo_data_urls") as string | null
    ),
    technician_signature: (formData.get("technician_signature") as string) ?? "",
    client_present: (formData.get("client_present") as string) ?? "",
    client_signature: (formData.get("client_signature") as string) ?? "",
    client_name: (formData.get("client_name") as string) ?? "",
  };
}

// Re-parse the form fields the action expects, mirroring the server-side
// completeServiceSheetAction shape. Returning null skips the local write
// (and the enqueue). The review step validates BEFORE submission, so a
// null here is belt-and-braces, not a UX path. Exported for the
// combined-entry tests.
export function parseServiceSheetFormData(
  formData: FormData
): CompleteSheetInput | null {
  const result = ServiceSheetSchema.safeParse(buildRawSheetInput(formData));
  if (!result.success) return null;
  return {
    ...result.data,
    finalize: (formData.get("finalize") as string) === "true",
    amend: (formData.get("amend") as string) === "true",
  };
}

/** Client-side validation for the optimistic submit: the server is
 *  never called at submit (pass B), so its Zod bounce can no longer
 *  supply field errors — run the SAME schema locally. Returns the
 *  field→message map, or null when valid. */
export function validateServiceSheetFormData(
  formData: FormData
): Record<string, string> | null {
  const result = ServiceSheetSchema.safeParse(buildRawSheetInput(formData));
  if (result.success) return null;
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

// WrapMeta for completeServiceSheetAction — wraps the field operator's
// most important offline action. applyLocal mirrors the server-side
// writeServiceSheet's UPDATE so the UI sees the change immediately.
// Signatures stay as base64 in the args (uploaded server-side on
// replay via the legacy `data:image/...` path in writeServiceSheet);
// photos go through `photos_pending` and arrive here as client-UUID
// strings (the new path in writeServiceSheet computes URLs from those).
// Exported for the combined-entry tests.
export const completeServiceSheetMeta: WrapMeta<CompleteSheetInput> = {
  actionName: "completeServiceSheetAction",
  entityType: "job",
  entityId: (input) => input.job_id,
  parseInput: parseServiceSheetFormData,
  applyLocal: async (input) => {
    const now = new Date().toISOString();
    // photo_data_urls holds either client-UUID strings (offline path,
    // photos already in photos_pending) or `data:image/...` strings
    // (online direct path). For local rendering we resolve UUIDs to
    // their deterministic Storage URL — matches what writeServiceSheet
    // writes server-side. The Storage object behind the URL doesn't
    // exist until the photos loop catches up, so the URL is dead
    // briefly — same broken-image trade-off step 6 already committed
    // to. data: URLs are renderable as-is.
    const localPhotoUrls = input.photo_data_urls.map((ref) =>
      isPhotoClientId(ref) ? photoPublicUrl(ref) : ref
    );
    await db.jobs.update(input.job_id, {
      call_type: input.call_type,
      pest_species: input.pest_species,
      findings: input.findings || null,
      recommendations: input.recommendations || null,
      treatment: input.method_used.join(", ") || null,
      method_used: input.method_used,
      pesticides_used: input.pesticides_used || null,
      risk_level: input.risk_level,
      risk_comments: input.risk_comments || null,
      report_notes: input.report_notes || null,
      photo_urls: localPhotoUrls,
      client_present: input.client_present,
      client_name: input.client_name || null,
      // Combined entry (finalize) completes the job locally — the
      // optimistic mirror of the server's finalizeServiceSheet. The
      // non-finalize shape keeps today's in_progress semantics. Amend
      // (L2) edits an already-completed sheet: job_status is NEVER
      // written — the local row must not lie about a downgrade the
      // server will refuse.
      ...(input.amend
        ? {}
        : { job_status: input.finalize ? "completed" : "in_progress" }),
      updated_at: now,
    });
    // The draft is obsolete the moment the completion is committed
    // locally — and clearing it HERE matters: flipping job_status above
    // makes the /complete page swap to the view-only sheet via
    // useLiveQuery, unmounting the form before its success effect (the
    // other clearDraft site) gets to run. Caught live in the pass-B
    // preview run: outbox drained, draft still haunting. Best-effort —
    // a draft-clear hiccup must not abort the completion itself.
    // Amend saves are final the same way — clear their draft too.
    if (input.finalize || input.amend) {
      try {
        await clearDraft(input.job_id);
      } catch (err) {
        console.warn("[serviceSheet] applyLocal clearDraft failed:", err);
      }
    }
  },
};

/** Optimistic-path options (the 2c6d434 booking treatment): the local
 *  write + ONE combined outbox entry ARE the operation; the server is
 *  never called at submit. Module-level so the reference is stable. */
const completeServiceSheetOpts = {
  localSuccessState: (input: CompleteSheetInput) => ({
    success: true,
    errors: {},
    message: null,
    jobId: input.job_id,
    pdfUrl: null,
    finalized: input.finalize,
  }),
};

const STEP_LABELS = ["Visit", "Service", "Risk", "Photos", "Sign off"] as const;

function getErrorStep(errors: Record<string, string>): number | null {
  if (errors.call_type) return 1;
  if (
    errors.findings ||
    errors.recommendations ||
    errors.method_used ||
    errors.pesticides_used ||
    errors.pest_species
  )
    return 2;
  if (errors.risk_level || errors.risk_comments) return 3;
  if (errors.technician_signature) return 5;
  return null;
}

interface ServiceSheetFormProps {
  jobId: string;
  defaultCallType?: string;
  defaultPests?: string[];
  defaultMethods?: string[];
  defaultRiskLevel?: string;
  defaultFindings?: string;
  defaultRecommendations?: string;
  defaultPesticides?: string;
  defaultReportNotes?: string;
  defaultRiskComments?: string;
  /** Pre-filled customer context shown in the header strip. */
  customerName?: string;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  siteAddress?: string;
  /** The sheet location was resolved from the customer's own address (the
   *  job's site was bare), not the site itself — surfaces a "from customer
   *  record" note + an edit affordance so the operator can make it
   *  site-specific if needed. */
  addressFromCustomer?: boolean;
  /** The job's site id — drives the "edit location" link. */
  siteId?: string;
  /** L2: "amend" edits an already-completed sheet — job_status is never
   *  touched, the review modal reads Save instead of Complete, and the
   *  email send is an explicit choice defaulting OFF. Default: "fill". */
  mode?: "fill" | "amend";
  /** L3: the customer's id — lets the review modal's "Add email & send"
   *  save an address inline (wrapped, offline-capable). */
  customerId?: string;
}

/**
 * Outer wrapper: gates render on the draft query so the body's useState
 * initial values get the draft if there is one. `useLiveQuery` returns
 * `undefined` while the IDB query is in flight; we map "no row" → `null`
 * so the body can distinguish loading from confirmed-no-draft.
 *
 * The brief skeleton here is the cost of guaranteeing draft-aware
 * initialization without losing the React rule that hooks must be
 * called unconditionally. Once the draft is loaded (or known absent),
 * the body mounts ONCE with the right initial values.
 */
export function ServiceSheetForm(props: ServiceSheetFormProps) {
  const draft = useLiveQuery(
    async (): Promise<ServiceSheetDraft | null> => {
      const d = await loadDraft(props.jobId);
      return d ?? null;
    },
    [props.jobId]
  );

  if (draft === undefined) {
    return (
      <div className="animate-pulse">
        <div className="h-8 w-48 rounded bg-gray-100" />
        <div className="mt-6 h-64 rounded-xl bg-gray-100" />
      </div>
    );
  }

  return <ServiceSheetFormBody {...props} draft={draft} />;
}

interface ServiceSheetFormBodyProps extends ServiceSheetFormProps {
  /** null if no draft exists, the stored draft otherwise. */
  draft: ServiceSheetDraft | null;
}

function ServiceSheetFormBody({
  jobId,
  defaultCallType = "",
  defaultPests = [],
  defaultMethods = [],
  defaultRiskLevel = "low",
  defaultFindings = "",
  defaultRecommendations = "",
  defaultPesticides = "",
  defaultReportNotes = "",
  defaultRiskComments = "",
  customerName,
  customerCompany,
  customerEmail,
  customerPhone,
  siteAddress,
  addressFromCustomer = false,
  siteId,
  mode = "fill",
  customerId,
  draft,
}: ServiceSheetFormBodyProps) {
  const amend = mode === "amend";
  // Initial values: prefer draft if one exists, otherwise the job's
  // saved values / defaults. `draft` is null on confirmed no-draft (the
  // outer wrapper gated render until the IDB query resolved), so the
  // nullish-coalesce falls through cleanly when there's nothing stored.
  //
  // useState initial values are read on the FIRST mount only — once the
  // body is mounted with these values, subsequent draft writes never
  // override what the operator is typing. The outer wrapper guarantees
  // one-shot mounting (it renders the body only once `draft !== undefined`).
  const [step, setStep] = useState<number>(draft?.step ?? 1);
  const [callType, setCallType] = useState(draft?.call_type ?? defaultCallType);
  const [selectedPests, setSelectedPests] = useState<string[]>(
    draft?.selected_pests ?? defaultPests
  );
  const [selectedMethods, setSelectedMethods] = useState<string[]>(
    draft?.selected_methods ?? defaultMethods
  );
  // All text inputs below are CONTROLLED via state. React 19's
  // <form action={fn}> resets uncontrolled inputs to their defaults
  // whenever the action returns (regardless of success/error payload),
  // which would wipe operator-typed values on a validation bounce.
  // Controlled inputs survive — state holds the truth; React rebinds
  // value={state} on every render.
  const [findings, setFindings] = useState(draft?.findings ?? defaultFindings);
  const [recommendations, setRecommendations] = useState(
    draft?.recommendations ?? defaultRecommendations
  );
  const [pesticidesUsed, setPesticidesUsed] = useState(
    draft?.pesticides_used ?? defaultPesticides
  );
  const [reportNotes, setReportNotes] = useState(
    draft?.report_notes ?? defaultReportNotes
  );
  const [riskLevel, setRiskLevel] = useState(draft?.risk_level ?? defaultRiskLevel);
  const [riskComments, setRiskComments] = useState(
    draft?.risk_comments ?? defaultRiskComments
  );
  const [clientName, setClientName] = useState(draft?.client_name ?? "");
  const [techSig, setTechSig] = useState(draft?.tech_sig ?? "");
  const [clientSig, setClientSig] = useState(draft?.client_sig ?? "");
  const [customerPresent, setCustomerPresent] = useState<"yes" | "no" | "">(
    draft?.customer_present ?? ""
  );
  const [photoDataUrls, setPhotoDataUrls] = useState<string[]>(
    draft?.photo_data_urls ?? []
  );
  const [scheduleFollowUp, setScheduleFollowUp] = useState(
    draft?.schedule_follow_up ?? false
  );
  const [followUpDate, setFollowUpDate] = useState(
    () => draft?.follow_up_date ?? dateUkOffset(14)
  );
  const prevErrorsRef = useRef<Record<string, string>>({});
  const router = useRouter();

  // Wrapped: local-first Dexie update + outbox enqueue. With
  // localSuccessState supplied (the 2c6d434 booking treatment) the
  // OPTIMISTIC path runs: applyLocal + ONE combined outbox entry, state
  // flips to success immediately, and the server is NEVER called at
  // submit — the engine's drainOutbox owns all server sync (a
  // gemcrm:request-sync event kicks it right away when online).
  const [state, formAction, isPending] = useLocalFirstAction(
    completeServiceSheetAction,
    { success: false, errors: {}, message: null },
    completeServiceSheetMeta,
    completeServiceSheetOpts
  );

  // ── Review step (replaces the old server-PDF approval modal) ──
  // Renders the sheet data the client already holds — uniform for
  // online and offline (no connectivity branch). The email/follow-up
  // choices live here; confirm enqueues the combined entry.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement | null>(null);
  const ensureReady = useEnsureCustomerDocReady();

  // Server-fallback errors can still arrive (edge: parseInput returned
  // null and the legacy online path ran) — merge both sources for
  // display; client validation is the primary one now.
  const errors = { ...state.errors, ...clientErrors };

  // Local success → the completion is committed (Dexie + outbox).
  // Clear the draft and leave; sync happens in the background.
  useEffect(() => {
    if (state.success && state.jobId) {
      const jobId = state.jobId;
      void (async () => {
        // Drop the draft now that the sheet is finalised. If this
        // throws (IDB closed, table missing on schema mismatch), the
        // draft would re-seed on next mount and the operator would see
        // their old in-progress values "haunting" the completed sheet —
        // log but don't block navigation; a stale draft beats blocking
        // the happy path.
        try {
          await clearDraft(jobId);
        } catch (err) {
          console.warn("[serviceSheet] clearDraft failed:", err);
        }
        router.push(ROUTES.jobDetail(jobId));
      })();
    }
    // Depend on the full state OBJECT, not state.success — the wrapper
    // returns a fresh state reference per dispatch.
  }, [state, router]);

  function handleReview() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const validationErrors = validateServiceSheetFormData(fd);
    if (validationErrors) {
      setClientErrors(validationErrors);
      const errorStep = getErrorStep(validationErrors);
      if (errorStep) setStep(errorStep);
      return;
    }
    setClientErrors({});
    setReviewOpen(true);
  }

  function handleConfirmComplete(opts: { sendEmail: boolean }) {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    if (amend) {
      // L2 amend: edits an already-completed sheet. NO finalize — the
      // server's finalize/side-effect sequence must not re-run; the
      // sheet fields update, the PDF regenerates, and the email goes
      // out only on this explicit choice (default off).
      fd.set("amend", "true");
    } else {
      fd.set("finalize", "true");
    }
    fd.set("send_email", opts.sendEmail ? "true" : "");
    // schedule_follow_up / follow_up_date ride along as hidden inputs.
    const dispatch = () => void formAction(fd);

    // Gate ONLY the send intent: if the operator opts to email but the
    // customer has no email, prompt for it (and capture it) first. The
    // customer is read from Dexie so this works OFFLINE in the field — the
    // gate captures the email optimistically + queues it for sync. Completion
    // ALWAYS proceeds — best-effort, so a read/gate hiccup never blocks it.
    // On cancel (or offline-deferred capture) the dispatch still runs with
    // send_email on, and the server skips the send and creates the no-email
    // follow-up task (its existing path, kept as the backstop); once the
    // email syncs, send-now goes through without re-prompting.
    if (opts.sendEmail && customerId) {
      void (async () => {
        try {
          const customer = await db.customers.get(customerId);
          if (customer) {
            // AWAIT the gate before dispatching: an offline capture enqueues
            // its email-save here, so it lands in the outbox BEFORE the
            // completion entry below (lower id). FIFO drain then replays the
            // email first, and the completion's replay finds it → auto-sends.
            await ensureReady(customer, { verb: "send", doc: "report" });
          }
        } catch {
          // Opportunistic — never block completion on a capture failure.
        }
        dispatch();
      })();
      return;
    }
    dispatch();
    // The modal stays open with a pending label; the success effect
    // above navigates away the moment the local write + enqueue land.
  }

  useEffect(() => {
    const prev = prevErrorsRef.current;
    const curr = errors;
    const changed = Object.keys(curr).some((k) => curr[k] !== prev[k]);
    if (changed) {
      const errorStep = getErrorStep(curr);
      if (errorStep) setStep(errorStep);
      prevErrorsRef.current = curr;
    }
  });

  // ── Draft auto-save ──
  //
  // Persist every form field to IndexedDB ~500ms after the operator stops
  // typing. Debounce: one timer, reset on every dep change. On the next
  // mount (reload, background-foreground, navigation back), the outer
  // wrapper's useLiveQuery pulls this row back and seeds the body's
  // useState.
  //
  // The deps list mirrors every state slice the draft persists. Adding a
  // new form field? Add it to ServiceSheetDraft, the input below, AND
  // the deps array. ESLint's exhaustive-deps lints both, so a forgotten
  // field is a compile-time signal.
  //
  // We don't save on initial mount when the form is empty — there's
  // nothing to lose yet, and we'd churn IDB on every fresh job open.
  // The ref-gate avoids that first save.
  const draftSavedOnceRef = useRef(false);
  useEffect(() => {
    // Skip the first effect run: it fires once with the initial state
    // (either draft-restored or all-defaults). A no-op save of the
    // restored draft is harmless but a save of empty defaults the
    // moment a fresh job loads creates a "ghost" draft row that
    // changes nothing visible — still skip it to keep IDB clean.
    if (!draftSavedOnceRef.current) {
      // Mark only if there's actually content worth saving; otherwise
      // wait until the operator types something.
      const hasContent =
        callType !== "" ||
        selectedPests.length > 0 ||
        selectedMethods.length > 0 ||
        findings !== "" ||
        recommendations !== "" ||
        pesticidesUsed !== "" ||
        reportNotes !== "" ||
        riskComments !== "" ||
        clientName !== "" ||
        techSig !== "" ||
        clientSig !== "" ||
        customerPresent !== "" ||
        photoDataUrls.length > 0;
      if (!hasContent) return;
      draftSavedOnceRef.current = true;
    }
    const t = setTimeout(() => {
      void saveDraft({
        job_id: jobId,
        step,
        call_type: callType,
        selected_pests: selectedPests,
        selected_methods: selectedMethods,
        findings,
        recommendations,
        pesticides_used: pesticidesUsed,
        report_notes: reportNotes,
        risk_level: riskLevel,
        risk_comments: riskComments,
        client_name: clientName,
        tech_sig: techSig,
        client_sig: clientSig,
        customer_present: customerPresent,
        photo_data_urls: photoDataUrls,
        schedule_follow_up: scheduleFollowUp,
        follow_up_date: followUpDate,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [
    jobId,
    step,
    callType,
    selectedPests,
    selectedMethods,
    findings,
    recommendations,
    pesticidesUsed,
    reportNotes,
    riskLevel,
    riskComments,
    clientName,
    techSig,
    clientSig,
    customerPresent,
    photoDataUrls,
    scheduleFollowUp,
    followUpDate,
  ]);

  function togglePest(pest: string) {
    setSelectedPests((prev) =>
      prev.includes(pest) ? prev.filter((p) => p !== pest) : [...prev, pest]
    );
  }
  function toggleMethod(method: string) {
    setSelectedMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  }
  const onPhotosChange = useCallback((urls: string[]) => {
    setPhotoDataUrls(urls);
  }, []);

  const totalSteps = STEP_LABELS.length;
  const inputClass =
    "mt-1 block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500";
  const labelClass = "block text-sm font-medium text-gray-700 mb-0.5";
  const clientPresent = customerPresent === "yes";

  return (
    <>
    {/* noValidate: required fields live across multiple steps (rendered
        with `hidden` rather than unmounted). The browser's HTML5 validator
        scans all of them on submit; when a hidden one is empty it tries
        to focus an invisible input and most browsers silently swallow the
        click. Client-side Zod (validateServiceSheetFormData) is the source
        of truth now — the errors effect navigates to the failing step and
        the field's inline error renders.

        No `action` prop: submission is two-phase (review → confirm) and
        the confirm handler calls formAction with a FormData it builds
        from this form + the finalize fields. onSubmit traps Enter-key
        submits and routes them through the same review gate. */}
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        handleReview();
      }}
      noValidate
    >
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="call_type" value={callType} />
      <input type="hidden" name="pest_species" value={JSON.stringify(selectedPests)} />
      <input type="hidden" name="method_used" value={JSON.stringify(selectedMethods)} />
      <input type="hidden" name="photo_data_urls" value={JSON.stringify(photoDataUrls)} />
      <input type="hidden" name="technician_signature" value={techSig} />
      <input type="hidden" name="client_signature" value={clientSig} />
      <input type="hidden" name="client_present" value={clientPresent ? "true" : ""} />
      <input
        type="hidden"
        name="schedule_follow_up"
        value={scheduleFollowUp ? "true" : ""}
      />
      <input
        type="hidden"
        name="follow_up_date"
        value={scheduleFollowUp ? followUpDate : ""}
      />

      {/* Customer header strip — pre-filled from the booking, read-only */}
      {customerName && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Customer
          </p>
          <div className="mt-1 flex flex-col gap-x-6 gap-y-1 sm:flex-row sm:flex-wrap sm:items-center">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {customerName}
                {customerCompany && (
                  <span className="ml-1 text-gray-500 font-normal">
                    · {customerCompany}
                  </span>
                )}
              </p>
              {siteAddress && (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <p className="text-xs text-gray-500">{siteAddress}</p>
                  {addressFromCustomer && (
                    <span className="rounded bg-gray-200 px-1.5 py-px text-[10px] font-medium text-gray-500">
                      from customer record
                    </span>
                  )}
                  {siteId && (
                    <Link
                      href={`${ROUTES.siteEdit(siteId)}?returnTo=${encodeURIComponent(
                        `${ROUTES.jobDetail(jobId)}/complete`
                      )}`}
                      className="text-[11px] font-medium text-brand-darker hover:underline"
                    >
                      Edit location
                    </Link>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 sm:ml-auto">
              {customerPhone && (
                <a
                  href={`tel:${customerPhone}`}
                  className="inline-flex items-center gap-1 hover:text-brand-darker"
                >
                  <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                  </svg>
                  {customerPhone}
                </a>
              )}
              {customerEmail && (
                <a
                  href={`mailto:${customerEmail}`}
                  className="inline-flex items-center gap-1 hover:text-brand-darker"
                >
                  <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                  {customerEmail}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step indicators */}
      <div className="mb-8 flex items-center gap-2">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => {
          const isActive = s === step;
          const isDone = s < step;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                isActive
                  ? "bg-gray-900 text-white shadow-sm"
                  : isDone
                    ? "bg-gray-200 text-gray-700"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {isDone ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              ) : (
                s
              )}
            </button>
          );
        })}
        <span className="ml-3 text-sm font-medium text-gray-500">
          {STEP_LABELS[step - 1]}
        </span>
      </div>

      {state.message && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-600">
          {state.message}
        </div>
      )}

      {/* ── Step 1: Visit ── */}
      <div className={step === 1 ? "space-y-5" : "hidden"}>
        <div>
          <label className={labelClass}>
            Call Type <span className="text-red-500">*</span>
          </label>
          <p className="mt-1 text-xs text-gray-400">
            Pre-filled from the booking — change if it&apos;s actually a
            different type of visit.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CALL_TYPES.map((type) => (
              <label
                key={type}
                className="flex cursor-pointer items-center justify-center rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-all has-[:checked]:border-gray-900 has-[:checked]:bg-gray-900 has-[:checked]:text-white"
              >
                <input
                  type="radio"
                  name="call_type_radio"
                  value={type}
                  checked={callType === type}
                  onChange={() => setCallType(type)}
                  className="sr-only"
                />
                {CALL_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
          {errors.call_type && (
            <p className="mt-1 text-sm text-red-500">{errors.call_type}</p>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="button"
            onClick={() => setStep(2)}
            className="rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
          >
            Next
          </button>
        </div>
      </div>

      {/* ── Step 2: Service Details ── */}
      <div className={step === 2 ? "space-y-5" : "hidden"}>
        <div>
          <label className={labelClass}>
            Pest Species <span className="text-red-500">*</span>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {COMMON_PESTS.map((pest) => (
              <button
                key={pest}
                type="button"
                onClick={() => togglePest(pest)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedPests.includes(pest)
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                {pest}
              </button>
            ))}
          </div>
          {errors.pest_species && (
            <p className="mt-1 text-sm text-red-500">{errors.pest_species}</p>
          )}
        </div>

        <div>
          <label htmlFor="findings" className={labelClass}>
            Findings <span className="text-red-500">*</span>
          </label>
          <textarea
            id="findings"
            name="findings"
            rows={4}
            required
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            placeholder="What did you find on site?"
            className={inputClass}
          />
          {errors.findings && <p className="mt-1 text-sm text-red-500">{errors.findings}</p>}
        </div>

        <div>
          <label htmlFor="recommendations" className={labelClass}>
            Recommendations <span className="text-red-500">*</span>
          </label>
          <textarea
            id="recommendations"
            name="recommendations"
            rows={3}
            required
            value={recommendations}
            onChange={(e) => setRecommendations(e.target.value)}
            placeholder="Recommendations for the customer"
            className={inputClass}
          />
          {errors.recommendations && <p className="mt-1 text-sm text-red-500">{errors.recommendations}</p>}
        </div>

        <div>
          <label className={labelClass}>
            Treatment <span className="text-red-500">*</span>
          </label>
          <p className="mt-1 text-xs text-gray-400">Select everything performed or used on this visit.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TREATMENT_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => toggleMethod(method)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedMethods.includes(method)
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                {method}
              </button>
            ))}
          </div>
          {errors.method_used && (
            <p className="mt-1 text-sm text-red-500">{errors.method_used}</p>
          )}
        </div>

        <div>
          <label htmlFor="pesticides_used" className={labelClass}>
            Pesticides Used <span className="text-red-500">*</span>
          </label>
          <textarea
            id="pesticides_used"
            name="pesticides_used"
            rows={2}
            required
            value={pesticidesUsed}
            onChange={(e) => setPesticidesUsed(e.target.value)}
            placeholder="Products and quantities used"
            className={inputClass}
          />
          {errors.pesticides_used && (
            <p className="mt-1 text-sm text-red-500">{errors.pesticides_used}</p>
          )}
        </div>

        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Internal Notes</span>
          </div>
          <p className="mb-3 text-xs text-gray-400">Not visible to the customer. Included in internal PDF report only.</p>
          <textarea
            id="report_notes"
            name="report_notes"
            rows={3}
            value={reportNotes}
            onChange={(e) => setReportNotes(e.target.value)}
            placeholder="e.g. access issues, staff observations, follow-up needed..."
            className="block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
        </div>

        <div className="flex justify-between pt-4">
          <button type="button" onClick={() => setStep(1)} className="rounded-xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">Back</button>
          <button type="button" onClick={() => setStep(3)} className="rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-gray-800">Next</button>
        </div>
      </div>

      {/* ── Step 3: Risk ── */}
      <div className={step === 3 ? "space-y-5" : "hidden"}>
        <div>
          <label className={labelClass}>
            Risk Assessment <span className="text-red-500">*</span>
          </label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {RISK_LEVELS.map((level) => (
              <label
                key={level}
                className={`flex cursor-pointer items-center justify-center rounded-xl border px-4 py-3 text-sm font-medium shadow-sm transition-all has-[:checked]:text-white ${
                  level === "low"
                    ? "border-brand text-brand-darker has-[:checked]:border-brand has-[:checked]:bg-brand"
                    : level === "medium"
                      ? "border-amber-200 text-amber-700 has-[:checked]:border-amber-500 has-[:checked]:bg-amber-500"
                      : "border-red-200 text-red-700 has-[:checked]:border-red-600 has-[:checked]:bg-red-600"
                }`}
              >
                <input
                  type="radio"
                  name="risk_level"
                  value={level}
                  checked={riskLevel === level}
                  onChange={() => setRiskLevel(level)}
                  required
                  className="sr-only"
                />
                {RISK_LEVEL_LABELS[level]}
              </label>
            ))}
          </div>
          {errors.risk_level && (
            <p className="mt-1 text-sm text-red-500">{errors.risk_level}</p>
          )}
        </div>

        <div>
          <label htmlFor="risk_comments" className={labelClass}>
            Risk Assessment Comments <span className="text-red-500">*</span>
          </label>
          <textarea
            id="risk_comments"
            name="risk_comments"
            rows={3}
            required
            value={riskComments}
            onChange={(e) => setRiskComments(e.target.value)}
            className={inputClass}
            placeholder="Describe the risks identified and any mitigations"
          />
          {errors.risk_comments && (
            <p className="mt-1 text-sm text-red-500">{errors.risk_comments}</p>
          )}
        </div>

        <div className="flex justify-between pt-4">
          <button type="button" onClick={() => setStep(2)} className="rounded-xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">Back</button>
          <button type="button" onClick={() => setStep(4)} className="rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-gray-800">Next</button>
        </div>
      </div>

      {/* ── Step 4: Photos ── */}
      <div className={step === 4 ? "space-y-5" : "hidden"}>
        <div>
          <label className={labelClass}>Additional Photos</label>
          <p className="mb-3 text-xs text-gray-400">Optional. Include photos of findings, treatment areas, or anything worth documenting.</p>
          <PhotoUpload
            parentType="job"
            parentId={jobId}
            onChange={onPhotosChange}
            defaultPhotoIds={draft?.photo_data_urls}
          />
        </div>

        <div className="flex justify-between pt-4">
          <button type="button" onClick={() => setStep(3)} className="rounded-xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">Back</button>
          <button type="button" onClick={() => setStep(5)} className="rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-gray-800">Next</button>
        </div>
      </div>

      {/* ── Step 5: Sign Off ── */}
      <div className={step === 5 ? "space-y-6" : "hidden"}>
        <div>
          <label className={labelClass}>
            Technician Signature <span className="text-red-500">*</span>
          </label>
          <SignaturePad
            label=""
            onSignature={setTechSig}
            onClear={() => setTechSig("")}
          />
        </div>
        {errors.technician_signature && (
          <p className="-mt-4 text-sm text-red-500">{errors.technician_signature}</p>
        )}

        <div>
          <p className={labelClass}>Customer Present</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["yes", "no"] as const).map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center justify-center rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-all has-[:checked]:border-gray-900 has-[:checked]:bg-gray-900 has-[:checked]:text-white"
              >
                <input
                  type="radio"
                  name="customer_present_radio"
                  value={opt}
                  checked={customerPresent === opt}
                  onChange={() => {
                    setCustomerPresent(opt);
                    if (opt === "no") setClientSig("");
                  }}
                  className="sr-only"
                />
                {opt === "yes" ? "Yes" : "No"}
              </label>
            ))}
          </div>
        </div>

        {clientPresent && (
          <div className="space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-5">
            <div>
              <label htmlFor="client_name" className={labelClass}>Client Name</label>
              <input
                id="client_name"
                type="text"
                name="client_name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Name of person signing"
                className={inputClass}
              />
            </div>
            <SignaturePad
              label="Client Signature"
              onSignature={setClientSig}
              onClear={() => setClientSig("")}
            />
          </div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={scheduleFollowUp}
              onChange={(e) => setScheduleFollowUp(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-gray-300 text-brand-darker focus:ring-brand"
            />
            <div className="flex-1">
              <span className="block text-sm font-medium text-gray-900">
                Schedule follow-up visit
              </span>
              <p className="mt-0.5 text-xs text-gray-500">
                Adds a new booking to the calendar for this site.
              </p>
            </div>
          </label>
          {scheduleFollowUp && (
            <div className="mt-4">
              <label htmlFor="follow_up_date_input" className={labelClass}>
                Follow-up date
              </label>
              <input
                id="follow_up_date_input"
                type="date"
                value={followUpDate}
                min={todayUk()}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className={inputClass}
              />
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4">
          <button type="button" onClick={() => setStep(4)} className="rounded-xl px-6 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50">Back</button>
          <button
            type="button"
            onClick={handleReview}
            disabled={isPending}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {amend ? "Review changes" : "Review & Complete"}
          </button>
        </div>
      </div>
    </form>

    {/* ── Review & complete modal (local — no server PDF preview) ──
        Renders the data the form already holds, identically online and
        offline. Confirm enqueues ONE combined entry (sheet + finalize +
        email/follow-up choices); the report PDF generates when the
        entry syncs. */}
    {reviewOpen && (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8">
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={() => !isPending && setReviewOpen(false)}
          aria-hidden="true"
        />
        <div className="relative mx-4 w-full max-w-3xl rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {amend ? "Review amendments" : "Review & Complete"}
              </h2>
              <p className="text-xs text-gray-500">
                {amend
                  ? "Check the changes, then save — the report PDF regenerates; nothing is emailed unless you choose to."
                  : "Check the sheet, then complete the job — with or without emailing the customer."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReviewOpen(false)}
              disabled={isPending}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="max-h-[55vh] space-y-3 overflow-y-auto p-5">
            <dl className="space-y-3 text-sm">
              <ReviewRow label="Call type">
                {CALL_TYPE_LABELS[callType as keyof typeof CALL_TYPE_LABELS] ??
                  callType}
              </ReviewRow>
              <ReviewRow label="Pests">
                {selectedPests.length > 0 ? selectedPests.join(", ") : "—"}
              </ReviewRow>
              <ReviewRow label="Findings">{findings}</ReviewRow>
              <ReviewRow label="Recommendations">{recommendations}</ReviewRow>
              <ReviewRow label="Methods">
                {selectedMethods.join(", ")}
              </ReviewRow>
              <ReviewRow label="Pesticides">{pesticidesUsed}</ReviewRow>
              <ReviewRow label="Risk">
                {`${RISK_LEVEL_LABELS[riskLevel as keyof typeof RISK_LEVEL_LABELS] ?? riskLevel} — ${riskComments}`}
              </ReviewRow>
              {reportNotes && (
                <ReviewRow label="Report notes">{reportNotes}</ReviewRow>
              )}
              <ReviewRow label="Photos">
                {photoDataUrls.length > 0
                  ? `${photoDataUrls.length} attached`
                  : "None"}
              </ReviewRow>
              <ReviewRow label="Signatures">
                {`Technician ✓${
                  clientPresent
                    ? clientSig
                      ? ` · ${clientName || "Client"} ✓`
                      : ` · ${clientName || "Client"} — not signed`
                    : ""
                }`}
              </ReviewRow>
              {scheduleFollowUp && (
                <ReviewRow label="Follow-up">
                  {`Booking on ${followUpDate}`}
                </ReviewRow>
              )}
            </dl>
            <p className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
              The report PDF is generated when the sheet syncs — completing
              works with no signal, and everything sends itself once
              you&apos;re back online.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-4">
            <button
              type="button"
              onClick={() => setReviewOpen(false)}
              disabled={isPending}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Back to edit
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleConfirmComplete({ sendEmail: false })}
                disabled={isPending}
                className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                  amend
                    ? "bg-brand px-5 font-semibold text-white shadow-sm hover:bg-brand-dark"
                    : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {isPending
                  ? amend ? "Saving…" : "Completing…"
                  : amend ? "Save changes" : "Complete"}
              </button>
              {/* Always offered now: if the customer has no email, the
                  document-completeness gate prompts for one (and saves it)
                  before sending. */}
              <button
                type="button"
                onClick={() => handleConfirmComplete({ sendEmail: true })}
                disabled={isPending}
                className={`rounded-lg px-5 py-2 text-sm font-semibold shadow-sm disabled:opacity-50 ${
                  amend
                    ? "border border-gray-200 bg-white font-medium text-gray-700 hover:bg-gray-50"
                    : "bg-brand text-white hover:bg-brand-dark"
                }`}
              >
                {isPending
                  ? amend ? "Saving…" : "Completing…"
                  : amend ? "Save & Email" : "Complete & Email"}
              </button>
            </div>
          </div>

          {!customerEmail && (
            <div className="px-6 pb-4 text-right">
              {/* Statement of fact, not a warning — neutral tone. */}
              <p className="text-xs text-gray-500">
                {amend ? "Save changes" : "Complete"} saves the report without
                emailing; {amend ? "Save & Email" : "Complete & Email"} will
                ask for an email first.
              </p>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}

function ReviewRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 border-b border-gray-50 pb-2 last:border-b-0">
      <dt className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap text-gray-800">
        {children}
      </dd>
    </div>
  );
}
