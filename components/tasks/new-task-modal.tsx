"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { INITIAL_ACTION_STATE } from "@/types/actions";
import {
  useLocalFirstAction,
  formDataToObject,
  type WrapMeta,
} from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import { newId } from "@/lib/utils/id";
import { TaskCreateSchema } from "@/lib/validation/task";
import type { Task } from "@/types/database";

/**
 * "New task" modal — manual personal to-do (Tasks module v1).
 *
 * Date-only: title + optional due date + optional notes. Saved with
 * task_type 'todo'. Local-first via useLocalFirstAction: applyLocal
 * writes the Dexie row + a `create` outbox entry carrying the
 * client-generated id; online the server action runs (the LEGACY wrap
 * path) and inserts to Supabase, so by the time `state.success` flips
 * the row is on the server and a router.refresh() shows it on the
 * (server-rendered) calendar. Offline the server isn't called — the
 * to-do is queued and we close optimistically; it surfaces on the
 * calendar after the next sync.
 */

interface CreateTaskParsedInput {
  id: string;
  title: string;
  due_date: string; // "" = no date
  notes: string; // "" = no notes
}

function field(fd: FormData, key: string): string {
  return ((fd.get(key) as string | null) ?? "").trim();
}

/** Parse + client-generate the id shared by the local write, the outbox
 *  replay, and the online server call. Returns null if invalid (the
 *  caller has already shown field errors). */
function parseCreateTaskFormData(fd: FormData): CreateTaskParsedInput | null {
  const result = TaskCreateSchema.safeParse({
    title: field(fd, "title"),
    due_date: field(fd, "due_date"),
    notes: field(fd, "notes"),
  });
  if (!result.success) return null;
  return {
    id: newId(),
    title: result.data.title,
    due_date: result.data.due_date,
    notes: result.data.notes,
  };
}

export const createTaskMeta: WrapMeta<CreateTaskParsedInput> = {
  actionName: "createTaskAction",
  entityType: "task",
  entityId: (input) => input.id,
  op: "create",
  entityIds: (input) => [input.id],
  parseInput: parseCreateTaskFormData,
  // Persisted replay args = the validated fields + the client id, so the
  // server upsert (createTask onConflict:id) writes the SAME row.
  replayArgs: (input, formData) => ({
    ...formDataToObject(formData),
    id: input.id,
    title: input.title,
    due_date: input.due_date,
    notes: input.notes,
  }),
  applyLocal: async (input) => {
    const now = new Date().toISOString();
    const row: Task = {
      id: input.id,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      title: input.title,
      due_date: input.due_date === "" ? null : input.due_date,
      notes: input.notes === "" ? null : input.notes,
      status: "pending",
      task_type: "todo",
      // Manual to-dos carry no urgency ranking — default medium, matching
      // createTask's server-side default (priority_order 2).
      priority: "medium",
      priority_order: 2,
      completed_at: null,
      related_job_id: null,
      related_customer_id: null,
      agreement_id: null,
      site_id: null,
    };
    await db.tasks.put(row);
  },
};

interface NewTaskModalProps {
  /** Parent mounts this only while open (`{open && <NewTaskModal …/>}`),
   *  so every open is a fresh mount — no in-effect state resets needed. */
  onClose: () => void;
}

export function NewTaskModal({ onClose }: NewTaskModalProps) {
  const [state, formAction, isPending] = useLocalFirstAction(
    createTaskAction,
    INITIAL_ACTION_STATE,
    createTaskMeta
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // Online success → the row is on the server; refresh so the calendar
  // (and dashboard) re-fetch and show it, then close. onClose/refresh are
  // not local setState, so this stays a pure synchronisation effect.
  useEffect(() => {
    if (state.success) {
      onClose();
      router.refresh();
    }
  }, [state.success, onClose, router]);

  // Escape-to-close. No state writes here.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const errors: Record<string, string> = { ...state.errors, ...clientErrors };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);

    const result = TaskCreateSchema.safeParse({
      title: field(fd, "title"),
      due_date: field(fd, "due_date"),
      notes: field(fd, "notes"),
    });
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !next[key]) next[key] = issue.message;
      }
      setClientErrors(next);
      return;
    }
    setClientErrors({});

    // Snapshot connectivity before dispatch: the LEGACY wrap path only
    // calls the server (and thus flips state.success) when online. Offline
    // the to-do is safely written to Dexie + the outbox, so close now;
    // it appears on the calendar after the next sync.
    const offline =
      typeof navigator !== "undefined" && !navigator.onLine;
    await formAction(fd);
    if (offline) {
      onClose();
      router.refresh();
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelClass = "block text-xs font-medium text-gray-600";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:py-12">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative flex h-full w-full flex-col bg-white shadow-xl sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">New task</h2>
          <button
            type="button"
            onClick={onClose}
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

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label htmlFor="task-title" className={labelClass}>
                Title
              </label>
              <input
                id="task-title"
                name="title"
                type="text"
                autoFocus
                placeholder="e.g. Order more bait stations"
                className={inputClass}
              />
              {errors.title && (
                <p className="mt-1 text-xs text-red-600">{errors.title}</p>
              )}
            </div>

            <div>
              <label htmlFor="task-due" className={labelClass}>
                Due date <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id="task-due"
                name="due_date"
                type="date"
                className={inputClass}
              />
              {errors.due_date && (
                <p className="mt-1 text-xs text-red-600">{errors.due_date}</p>
              )}
            </div>

            <div>
              <label htmlFor="task-notes" className={labelClass}>
                Notes <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                id="task-notes"
                name="notes"
                rows={3}
                placeholder="Any extra detail…"
                className={inputClass}
              />
              {errors.notes && (
                <p className="mt-1 text-xs text-red-600">{errors.notes}</p>
              )}
            </div>

            {state.message && !state.success && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {state.message}
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
