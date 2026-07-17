import type { CallType, RiskLevel, JobStatus, AgreementStatus, TaskType } from "@/types/database";

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  routine: "Routine",
  callout: "Call Out",
  followup: "Follow Up",
  survey: "Survey Only",
  other: "Other",
};

/**
 * Human label for a job's call type, folding the "Other" free-text
 * description in as "Other: <desc>" — the scalar analogue of how the
 * pest/method "Other: <desc>" strings print inline (see
 * lib/utils/other-describe.ts). Used on the DETAIL surfaces (job detail,
 * service-sheet view, customer PDF, review-request message). Compact
 * chips deliberately call CALL_TYPE_LABELS directly and stay plain
 * "Other" to avoid layout blow-out from a long description.
 *
 * Falls back to the plain label when the type is not "other" or the
 * description is empty, and to the raw value for an unknown type.
 */
export function formatCallType(
  callType: string | null | undefined,
  otherDesc?: string | null
): string {
  if (!callType) return "";
  const label =
    CALL_TYPE_LABELS[callType as CallType] ?? callType;
  const desc = otherDesc?.trim();
  if (callType === "other" && desc) return `Other: ${desc}`;
  return label;
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: "Low Risk",
  medium: "Moderate Risk",
  high: "High Risk",
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "bg-brand-soft text-brand-darker",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  draft: "Draft",
};

export const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-brand-soft text-brand-darker",
  // Neutral grey — a draft is an unconfirmed jotting, visually quieter
  // than a scheduled job.
  draft: "bg-gray-100 text-gray-600",
};

// Confirmed/working statuses only. `draft` is deliberately excluded:
// this list drives active-work surfaces; drafts live behind their own
// tab/prompt until upgraded.
export const JOB_STATUSES: JobStatus[] = ["scheduled", "in_progress", "completed"];

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: "Draft, unsigned",
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

export const AGREEMENT_STATUS_COLORS: Record<AgreementStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-brand-soft text-brand-darker",
  paused: "bg-amber-100 text-amber-700",
  cancelled: "bg-red-100 text-red-700",
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  general: "General",
  follow_up: "Follow-up",
  review_request: "Review Request",
  contract_renewal: "Contract Renewal",
  todo: "To-do",
};

// Aligned with GEM Services Service Sheet JotForm.
export const COMMON_PESTS = [
  "Wasps",
  "Hornets",
  "Rats",
  "Mice",
  "Moles",
  "Bedbugs",
  "Moths",
  "Fleas",
  "Birds",
  "Squirrels",
  "Other",
] as const;

// PMA pest list — overlaps with service sheet but without Moths.
export const PMA_PESTS = [
  "Wasps",
  "Hornets",
  "Rats",
  "Mice",
  "Moles",
  "Bedbugs",
  "Fleas",
  "Birds",
  "Squirrels",
  "Other",
] as const;
