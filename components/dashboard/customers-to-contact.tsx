import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import { CompleteTaskButton } from "@/components/dashboard/complete-task-button";
import type { TaskWithCustomer } from "@/lib/data/tasks";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import type { TaskType } from "@/types/database";

interface CustomersToContactProps {
  tasks: TaskWithCustomer[];
}

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  general: "Task",
  follow_up: "Follow up",
  review_request: "Review request",
  contract_renewal: "Contract renewal",
  // 'todo' never reaches this widget (getCustomerContactTasks allowlists
  // review_request/follow_up/contract_renewal) — present for exhaustiveness.
  todo: "To-do",
};

const TASK_TYPE_COLORS: Partial<Record<TaskType, string>> = {
  follow_up: "bg-blue-100 text-blue-700",
  review_request: "bg-purple-100 text-purple-700",
  contract_renewal: "bg-amber-100 text-amber-700",
};

export function CustomersToContact({ tasks }: CustomersToContactProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">Customers to contact</h3>
        <span className="text-xs text-gray-400">{tasks.length}</span>
      </div>
      <ul className="space-y-2">
        {tasks.slice(0, 5).map((task) => {
          const label = TASK_TYPE_LABELS[task.task_type] ?? "Task";
          const color = TASK_TYPE_COLORS[task.task_type] ?? "bg-gray-100 text-gray-700";
          return (
            <li
              key={task.id}
              className="rounded-lg border border-gray-100 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${color}`}
                    >
                      {label}
                    </span>
                    {task.customer && (
                      <Link
                        href={ROUTES.customerDetail(task.customer.id)}
                        className="truncate text-sm font-medium text-gray-900 hover:underline"
                      >
                        {customerDisplayName(task.customer)}
                      </Link>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {task.title}
                  </p>
                  {task.customer?.phone && (
                    <a
                      href={`tel:${task.customer.phone}`}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-darker hover:text-brand-darker"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
                        />
                      </svg>
                      {task.customer.phone}
                    </a>
                  )}
                </div>
                <CompleteTaskButton taskId={task.id} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
