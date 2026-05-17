import type { JobStatus } from "@/types/database";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "@/lib/constants/job-labels";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${JOB_STATUS_COLORS[status]}`}
    >
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}
