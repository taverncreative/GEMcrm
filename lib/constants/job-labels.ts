import type { CallType, RiskLevel, JobStatus, AgreementStatus, TaskType } from "@/types/database";

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  routine: "Routine",
  callout: "Call Out",
  followup: "Follow Up",
  survey: "Survey Only",
  other: "Other",
};

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
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

export const AGREEMENT_STATUS_COLORS: Record<AgreementStatus, string> = {
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
