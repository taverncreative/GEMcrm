"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  completeServiceSheetAction,
  approveServiceSheetAction,
} from "@/app/(app)/jobs/[id]/complete/actions";
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

// Re-parse the form fields the action expects, mirroring the server-side
// completeServiceSheetAction shape. Returning null skips the local write
// (the wrapper still dispatches server-side when online); we use this
// when required fields are missing — the server-side Zod will produce
// the proper error response.
function parseServiceSheetFormData(
  formData: FormData
): ServiceSheetInput | null {
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
  const raw = {
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
  const result = ServiceSheetSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// WrapMeta for completeServiceSheetAction — wraps the field operator's
// most important offline action. applyLocal mirrors the server-side
// writeServiceSheet's UPDATE so the UI sees the change immediately.
// Signatures stay as base64 in the args (uploaded server-side on
// replay via the legacy `data:image/...` path in writeServiceSheet);
// photos go through `photos_pending` and arrive here as client-UUID
// strings (the new path in writeServiceSheet computes URLs from those).
const completeServiceSheetMeta: WrapMeta<ServiceSheetInput> = {
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
      job_status: "in_progress",
      updated_at: now,
    });
  },
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
  /** Pre-filled customer context shown in the header strip. */
  customerName?: string;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  siteAddress?: string;
}

export function ServiceSheetForm({
  jobId,
  defaultCallType = "",
  defaultPests = [],
  defaultMethods = [],
  defaultRiskLevel = "low",
  defaultFindings = "",
  defaultRecommendations = "",
  defaultPesticides = "",
  defaultReportNotes = "",
  customerName,
  customerCompany,
  customerEmail,
  customerPhone,
  siteAddress,
}: ServiceSheetFormProps) {
  const [step, setStep] = useState(1);
  const [callType, setCallType] = useState(defaultCallType);
  const [selectedPests, setSelectedPests] = useState<string[]>(defaultPests);
  const [selectedMethods, setSelectedMethods] = useState<string[]>(defaultMethods);
  // All text inputs below are CONTROLLED via state. React 19's
  // <form action={fn}> resets uncontrolled inputs to their defaults
  // whenever the action returns (regardless of success/error payload),
  // which would wipe operator-typed values on a validation bounce.
  // Controlled inputs survive — state holds the truth; React rebinds
  // value={state} on every render.
  const [findings, setFindings] = useState(defaultFindings);
  const [recommendations, setRecommendations] = useState(defaultRecommendations);
  const [pesticidesUsed, setPesticidesUsed] = useState(defaultPesticides);
  const [reportNotes, setReportNotes] = useState(defaultReportNotes);
  const [riskLevel, setRiskLevel] = useState(defaultRiskLevel);
  const [riskComments, setRiskComments] = useState("");
  const [clientName, setClientName] = useState("");
  const [techSig, setTechSig] = useState("");
  const [clientSig, setClientSig] = useState("");
  const [customerPresent, setCustomerPresent] = useState<"yes" | "no" | "">("");
  const [photoDataUrls, setPhotoDataUrls] = useState<string[]>([]);
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(() => dateUkOffset(14));
  const prevErrorsRef = useRef<Record<string, string>>({});
  const router = useRouter();

  // Wrapped: local-first Dexie update + outbox enqueue + offline-tolerant.
  // The field operator's most important offline action — service sheet
  // submission while in the van without signal must work end-to-end.
  const [state, formAction, isPending] = useLocalFirstAction(
    completeServiceSheetAction,
    { success: false, errors: {}, message: null },
    completeServiceSheetMeta
  );

  // Approval modal state (driven by a successful save).
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [isApproving, startApproveTransition] = useTransition();

  useEffect(() => {
    if (state.success) {
      setApprovalOpen(true);
    }
  }, [state.success]);

  function handleApprove(opts: { sendEmail: boolean }) {
    if (!state.jobId) return;
    setApprovalError(null);
    startApproveTransition(async () => {
      const res = await approveServiceSheetAction(state.jobId!, {
        sendEmail: opts.sendEmail,
        scheduleFollowUp,
        followUpDate: scheduleFollowUp ? followUpDate : null,
      });
      if (res.success) {
        // Mirror the server-side completion to Dexie immediately so
        // surface 1's "Fill Service Sheet" entry point hides via
        // useLiveQuery the moment the operator lands there — was
        // waiting up to 30s for the next pull tick to bring
        // job_status="completed" down. The server already has the
        // change (we just confirmed res.success); no outbox entry
        // needed.
        try {
          await db.jobs.update(state.jobId!, {
            job_status: "completed",
            updated_at: new Date().toISOString(),
          });
        } catch (err) {
          // Non-fatal — the pull will catch up at worst case 30s
          // later. Log and continue with the navigation.
          console.warn(
            "[approveServiceSheet] local mirror failed:",
            err
          );
        }
        router.push(ROUTES.jobDetail(state.jobId!));
      } else {
        setApprovalError(res.message ?? "Failed to finalise");
      }
    });
  }

  function handleCancelApproval() {
    // "Cancel" leaves the data saved (status stays in_progress). User can
    // come back to the job detail and complete later.
    setApprovalOpen(false);
    if (state.jobId) router.push(ROUTES.jobDetail(state.jobId));
  }

  function handleEditApproval() {
    // Re-open editor on the same page. Data is already saved as
    // in_progress; resubmitting overwrites.
    setApprovalOpen(false);
  }

  useEffect(() => {
    const prev = prevErrorsRef.current;
    const curr = state.errors;
    const changed = Object.keys(curr).some((k) => curr[k] !== prev[k]);
    if (changed) {
      const errorStep = getErrorStep(curr);
      if (errorStep) setStep(errorStep);
      prevErrorsRef.current = curr;
    }
  }, [state.errors]);

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
    <form action={formAction}>
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
                <p className="text-xs text-gray-500">{siteAddress}</p>
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
          {state.errors.call_type && (
            <p className="mt-1 text-sm text-red-500">{state.errors.call_type}</p>
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
          {state.errors.pest_species && (
            <p className="mt-1 text-sm text-red-500">{state.errors.pest_species}</p>
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
          {state.errors.findings && <p className="mt-1 text-sm text-red-500">{state.errors.findings}</p>}
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
          {state.errors.recommendations && <p className="mt-1 text-sm text-red-500">{state.errors.recommendations}</p>}
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
          {state.errors.method_used && (
            <p className="mt-1 text-sm text-red-500">{state.errors.method_used}</p>
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
          {state.errors.pesticides_used && (
            <p className="mt-1 text-sm text-red-500">{state.errors.pesticides_used}</p>
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
          {state.errors.risk_level && (
            <p className="mt-1 text-sm text-red-500">{state.errors.risk_level}</p>
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
          {state.errors.risk_comments && (
            <p className="mt-1 text-sm text-red-500">{state.errors.risk_comments}</p>
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
        {state.errors.technician_signature && (
          <p className="-mt-4 text-sm text-red-500">{state.errors.technician_signature}</p>
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
            type="submit"
            disabled={isPending}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Complete Service Sheet"}
          </button>
        </div>
      </div>
    </form>

    {/* ── Approval modal ── */}
    {approvalOpen && (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8">
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={handleCancelApproval}
          aria-hidden="true"
        />
        <div className="relative mx-4 w-full max-w-3xl rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Approve Service Sheet
              </h2>
              <p className="text-xs text-gray-500">
                Review the generated PDF then save, save &amp; email, or go back to edit.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancelApproval}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4 p-5">
            {state.pdfUrl ? (
              <iframe
                src={state.pdfUrl}
                title="Service sheet preview"
                className="h-96 w-full rounded-lg border border-gray-200 bg-gray-50"
              />
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-medium">PDF couldn&apos;t be generated.</p>
                <p className="mt-1 text-xs">
                  Most likely the <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">reports</code> storage
                  bucket isn&apos;t set up. Run <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">supabase/bucket-only.sql</code> in
                  the Supabase SQL editor, then re-open this job and re-submit. Your data is already saved.
                </p>
              </div>
            )}
            {state.message && !state.success === false && (
              <p className="text-xs text-gray-500">{state.message}</p>
            )}
            {approvalError && (
              <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
                {approvalError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancelApproval}
                disabled={isApproving}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditApproval}
                disabled={isApproving}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Edit
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleApprove({ sendEmail: false })}
                disabled={isApproving}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isApproving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => handleApprove({ sendEmail: true })}
                disabled={isApproving || !customerEmail}
                title={!customerEmail ? "Customer has no email on file" : ""}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
              >
                {isApproving ? "Sending…" : "Save & Email"}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
