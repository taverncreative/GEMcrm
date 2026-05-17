import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import { formatAddress } from "@/lib/utils/format-address";
import { CompleteTaskButton } from "@/components/dashboard/complete-task-button";
import { JobQuickAction } from "@/components/jobs/job-status-actions";
import type { JobWithContext } from "@/lib/data/jobs";
import type { Task, JobStatus } from "@/types/database";

interface NextActionProps {
  overdueTasks: Task[];
  overdueJobs: JobWithContext[];
  todayJobs: JobWithContext[];
  todayTasks: Task[];
}

export function NextAction({
  overdueTasks,
  overdueJobs,
  todayJobs,
  todayTasks,
}: NextActionProps) {
  // Priority 1: Overdue task
  if (overdueTasks.length > 0) {
    const task = overdueTasks[0];
    return (
      <ActionCard
        priority="overdue"
        label="Overdue task"
        title={task.title}
        subtitle={task.due_date
          ? `Due ${new Date(task.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
          : undefined}
        action={<CompleteTaskButton taskId={task.id} />}
        remaining={overdueTasks.length - 1}
        remainingLabel="overdue tasks"
      />
    );
  }

  // Priority 2: Overdue job
  if (overdueJobs.length > 0) {
    const job = overdueJobs[0];
    return (
      <ActionCard
        priority="overdue"
        label="Overdue job"
        title={job.site.customer.name}
        subtitle={`${formatAddress(job.site)} — ${new Date(job.job_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
        href={ROUTES.jobDetail(job.id)}
        action={<JobQuickAction jobId={job.id} currentStatus={job.job_status as JobStatus} />}
        remaining={overdueJobs.length - 1}
        remainingLabel="overdue jobs"
      />
    );
  }

  // Priority 3: Today's job
  if (todayJobs.length > 0) {
    const job = todayJobs[0];
    return (
      <ActionCard
        priority="today"
        label="Next job today"
        title={job.site.customer.name}
        subtitle={formatAddress(job.site)}
        href={ROUTES.jobDetail(job.id)}
        action={<JobQuickAction jobId={job.id} currentStatus={job.job_status as JobStatus} />}
        remaining={todayJobs.length - 1}
        remainingLabel="more jobs today"
      />
    );
  }

  // Priority 4: Today's task
  if (todayTasks.length > 0) {
    const task = todayTasks[0];
    return (
      <ActionCard
        priority="today"
        label="Next task"
        title={task.title}
        action={<CompleteTaskButton taskId={task.id} />}
        remaining={todayTasks.length - 1}
        remainingLabel="more tasks"
      />
    );
  }

  // All done
  return (
    <div className="rounded-xl border border-brand bg-brand-soft p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft">
          <svg className="h-5 w-5 text-brand-darker" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-brand-darker">You&apos;re done for today</p>
          <p className="text-xs text-brand-darker">No outstanding jobs or tasks. Nice work.</p>
        </div>
      </div>
    </div>
  );
}

const PRIORITY_STYLES = {
  overdue: {
    border: "border-red-200",
    bg: "bg-red-50",
    dot: "bg-red-500",
    label: "text-red-600",
    title: "text-red-900",
    subtitle: "text-red-600",
    remaining: "text-red-500",
  },
  today: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    dot: "bg-amber-500",
    label: "text-amber-600",
    title: "text-gray-900",
    subtitle: "text-amber-600",
    remaining: "text-amber-500",
  },
} as const;

function ActionCard({
  priority,
  label,
  title,
  subtitle,
  href,
  action,
  remaining,
  remainingLabel,
}: {
  priority: "overdue" | "today";
  label: string;
  title: string;
  subtitle?: string;
  href?: string;
  action: React.ReactNode;
  remaining: number;
  remainingLabel: string;
}) {
  const s = PRIORITY_STYLES[priority];

  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} p-5`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`h-2 w-2 rounded-full ${s.dot}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${s.label}`}>
          {label}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} className={`text-base font-semibold ${s.title} hover:underline`}>
              {title}
            </Link>
          ) : (
            <p className={`text-base font-semibold ${s.title}`}>{title}</p>
          )}
          {subtitle && (
            <p className={`mt-0.5 text-sm ${s.subtitle}`}>{subtitle}</p>
          )}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {remaining > 0 && (
        <p className={`mt-3 text-xs ${s.remaining}`}>
          +{remaining} {remainingLabel}
        </p>
      )}
    </div>
  );
}
