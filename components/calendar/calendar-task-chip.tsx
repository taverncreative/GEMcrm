"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { completeTaskAction } from "@/app/(app)/dashboard/actions";
import { deleteTaskAction } from "@/app/(app)/tasks/actions";
import {
  completeTaskMeta,
  completeTaskInitialState,
} from "@/components/dashboard/complete-task-button";
import { useLocalFirstAction } from "@/lib/actions/wrap";
import { wrapDirectCallGracefully } from "@/lib/actions/graceful";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { db } from "@/lib/db";
import type { Task, TaskType } from "@/types/database";

// Same safety net as the other deletes — a transport failure resolves to a
// `{success:false}` shape rather than throwing out of the transition.
const wrappedDeleteTask = wrapDirectCallGracefully(deleteTaskAction);

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  general: "Task",
  follow_up: "Follow up",
  review_request: "Review request",
  contract_renewal: "Contract renewal",
  todo: "To-do",
};

function formatDate(d: string | null): string | null {
  if (!d) return null;
  // due_date is a plain YYYY-MM-DD — parse as local to avoid a TZ shift.
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * A single task on the month calendar — a clickable chip that opens a
 * detail modal where the task can be marked complete or deleted.
 *
 * Complete vs delete: completing records that the thing was done, deleting
 * records that it should never have been there (a mistake, a duplicate, a
 * test row). Both leave the calendar; only the second is destructive, so it
 * sits apart from the primary button and asks first.
 *
 * Completion is the shared local-first action (completeTaskMeta). Deletion
 * is online-only, like every other delete in the app. On success we refresh
 * so the server-rendered calendar drops the task.
 */
export function CalendarTaskChip({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const online = useIsOnline();
  const [state, completeAction, isPending] = useLocalFirstAction(
    completeTaskAction,
    completeTaskInitialState,
    completeTaskMeta
  );
  const [doneOffline, setDoneOffline] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Online completion → row flipped on the server; refresh so the
  // server-rendered calendar re-renders without it (the chip then
  // unmounts). The modal itself hides via the `!state.success` render
  // guard below, so no setState is needed in this effect.
  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function handleComplete() {
    const fd = new FormData();
    fd.set("task_id", task.id);
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    await completeAction(fd);
    if (offline) {
      // Queued locally; the server-rendered calendar can't reflect it
      // until the next sync. Acknowledge in-place rather than leaving the
      // button looking inert.
      setDoneOffline(true);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    const res = await wrappedDeleteTask(task.id);
    if (!res.success) {
      setDeleteError(res.message ?? "Failed to delete task");
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }
    // Mirror into Dexie so the offline-first surfaces (the customer panel's
    // follow-ups list) drop it without waiting for the next sync pull.
    try {
      await db.tasks.update(task.id, { deleted_at: new Date().toISOString() });
    } catch {
      // Non-fatal — the next sync pull reconciles it.
    }
    setOpen(false);
    router.refresh();
  }

  const due = formatDate(task.due_date);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDoneOffline(false);
          setConfirmDelete(false);
          setDeleteError(null);
          setOpen(true);
        }}
        className="block w-full truncate rounded bg-purple-100 px-1.5 py-0.5 text-left text-[11px] font-medium text-purple-700 hover:bg-purple-200"
        title={task.title}
      >
        • {task.title}
      </button>

      {open && !state.success && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:py-16">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex h-full w-full flex-col bg-white shadow-xl sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-700">
                {TASK_TYPE_LABEL[task.task_type] ?? "Task"}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {task.title}
              </h2>
              {due && (
                <p className="text-sm text-gray-500">
                  <span className="font-medium text-gray-600">Due:</span> {due}
                </p>
              )}
              {task.notes && (
                <p className="whitespace-pre-wrap text-sm text-gray-700">
                  {task.notes}
                </p>
              )}
            </div>

            <div className="shrink-0 space-y-3 border-t px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                {doneOffline ? (
                  <span className="text-sm font-medium text-brand-darker">
                    Marked done — will sync
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">
                    {state.message && !state.success ? state.message : ""}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={isPending || doneOffline || deleting}
                  className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {isPending ? "Completing…" : "Mark complete"}
                </button>
              </div>

              {/* Delete is the "this shouldn't exist" escape hatch, kept
                  visually quiet and behind an inline confirm so it can't be
                  hit by reflex on the way to Mark complete. Online-only,
                  consistent with the other deletes; it is a soft delete, so
                  the copy stays "Delete" / "Removes". */}
              <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                {confirmDelete ? (
                  <>
                    <span className="text-xs text-gray-600">
                      Delete this task? It leaves the calendar for good.
                    </span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                      >
                        Keep it
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        {deleting ? "Deleting…" : "Yes, delete"}
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-red-500">
                      {deleteError ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      disabled={!online || isPending || doneOffline}
                      title={
                        online ? undefined : "Online required to delete a task"
                      }
                      className="text-xs font-medium text-gray-500 hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
                    >
                      Delete task
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
