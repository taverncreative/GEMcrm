import { CompleteTaskButton } from "@/components/dashboard/complete-task-button";
import type { Task, TaskType } from "@/types/database";

interface TasksDueProps {
  tasks: Task[];
}

// Every task_type due today belongs here — unlike the overdue / contact
// widgets, this card does NOT exclude 'todo'. A personal to-do due today
// is exactly the kind of thing this "what's on today" list should carry,
// alongside auto-created follow-ups and system tasks.
const TASK_TYPE_LABELS: Record<TaskType, string> = {
  general: "Task",
  follow_up: "Follow up",
  review_request: "Review request",
  contract_renewal: "Contract renewal",
  todo: "To-do",
};

// 'todo' takes the same purple identity it carries on the calendar chip.
const TASK_TYPE_COLORS: Record<TaskType, string> = {
  general: "bg-gray-100 text-gray-700",
  follow_up: "bg-blue-100 text-blue-700",
  review_request: "bg-purple-100 text-purple-700",
  contract_renewal: "bg-amber-100 text-amber-700",
  todo: "bg-purple-100 text-purple-700",
};

/**
 * "Tasks due today" — every pending task whose due_date is today, in one
 * place. Mirrors the modern dashboard card convention (To invoice /
 * Customers to contact): its own white card, a right-aligned count, and a
 * per-row inline Complete button (the shared local-first CompleteTaskButton,
 * so completion is Dexie-backed and offline-safe like the rest of the
 * dashboard). Renders the card with an empty state when nothing is due, so
 * the grid slot stays stable.
 */
export function TasksDue({ tasks }: TasksDueProps) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="text-sm font-medium text-gray-500">Tasks due today</h3>
        <p className="mt-3 text-sm text-gray-400">No tasks due today.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">Tasks due today</h3>
        <span className="text-xs text-gray-400">{tasks.length}</span>
      </div>
      <ul className="space-y-2">
        {tasks.slice(0, 8).map((task) => {
          const label = TASK_TYPE_LABELS[task.task_type] ?? "Task";
          const color =
            TASK_TYPE_COLORS[task.task_type] ?? "bg-gray-100 text-gray-700";
          return (
            <li
              key={task.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${color}`}
                >
                  {label}
                </span>
                <span className="truncate text-sm text-gray-900">
                  {task.title}
                </span>
              </div>
              <CompleteTaskButton taskId={task.id} />
            </li>
          );
        })}
        {tasks.length > 8 && (
          <li className="pt-1 text-xs text-gray-400">
            +{tasks.length - 8} more
          </li>
        )}
      </ul>
    </div>
  );
}
