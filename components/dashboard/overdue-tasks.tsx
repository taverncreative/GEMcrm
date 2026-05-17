import { CompleteTaskButton } from "@/components/dashboard/complete-task-button";
import type { Task } from "@/types/database";

interface OverdueTasksProps {
  tasks: Task[];
}

export function OverdueTasks({ tasks }: OverdueTasksProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-2">
        <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <h3 className="text-sm font-semibold text-red-800">
          {tasks.length} overdue task{tasks.length !== 1 ? "s" : ""}
        </h3>
      </div>
      <ul className="mt-3 space-y-2">
        {tasks.slice(0, 5).map((task) => (
          <li
            key={task.id}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <span className="text-red-800">{task.title}</span>
              {task.due_date && (
                <span className="ml-2 text-red-500">
                  Due {new Date(task.due_date).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              )}
            </div>
            <CompleteTaskButton taskId={task.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
