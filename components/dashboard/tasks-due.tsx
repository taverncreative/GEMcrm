import { WidgetCard } from "./widget-card";
import { CompleteTaskButton } from "@/components/dashboard/complete-task-button";
import { ReviewTaskActions } from "@/components/dashboard/review-task-actions";
import { BulkCompleteButton } from "@/components/dashboard/bulk-complete-button";
import type { Task, TaskPriority } from "@/types/database";

interface TasksDueProps {
  tasks: Task[];
}

const PRIORITY_DOT: Record<TaskPriority, string> = {
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-gray-300",
};

export function TasksDue({ tasks }: TasksDueProps) {
  return (
    <WidgetCard title="Tasks Due Today">
      {tasks.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          No tasks due today.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-3xl font-semibold text-gray-900">{tasks.length}</p>
            {tasks.length > 1 && (
              <BulkCompleteButton taskIds={tasks.map(t => t.id)} />
            )}
          </div>
          <ul className="mt-3 space-y-2">
            {tasks.slice(0, 8).map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.medium}`} />
                  <span className="truncate text-gray-700">{task.title}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {task.task_type === "review_request" &&
                    task.related_job_id &&
                    task.related_customer_id && (
                      <ReviewTaskActions
                        taskId={task.id}
                        jobId={task.related_job_id}
                        customerId={task.related_customer_id}
                      />
                    )}
                  <CompleteTaskButton taskId={task.id} />
                </div>
              </li>
            ))}
            {tasks.length > 8 && (
              <li className="text-xs text-gray-400">
                +{tasks.length - 8} more
              </li>
            )}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}
