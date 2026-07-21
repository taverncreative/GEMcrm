"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveBlockedPeriodAction } from "@/app/(app)/blocked-periods/actions";
import { INITIAL_ACTION_STATE } from "@/types/actions";
import {
  useLocalFirstAction,
  formDataToObject,
  type WrapMeta,
} from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import { newId } from "@/lib/utils/id";
import { todayUk } from "@/lib/utils/today-uk";
import { BlockedPeriodSchema } from "@/lib/validation/blocked-period";
import type { BlockedPeriod } from "@/types/database";

/**
 * "Block out days" modal — create or edit a personal unavailability period
 * (migration 046). Mobile-first sheet mirroring NewTaskModal.
 *
 * Date-only range: reason (title) + start date + optional end date (blank =
 * single day). Local-first via useLocalFirstAction: applyLocal upserts the
 * Dexie row + enqueues a create/update outbox entry carrying the client id;
 * online the server action upserts to Supabase and state.success flips, so a
 * scoped router.refresh() surfaces the band on the (server-rendered)
 * calendar. Offline the server isn't called — the block is queued and we
 * close optimistically; it appears on the calendar after the next sync.
 */

interface BlockOutParsedInput {
  id: string;
  title: string;
  start_date: string;
  end_date: string; // already normalised (>= start) by the schema
}

function field(fd: FormData, key: string): string {
  return ((fd.get(key) as string | null) ?? "").trim();
}

function parseBlockOutFormData(fd: FormData): BlockOutParsedInput | null {
  const result = BlockedPeriodSchema.safeParse({
    title: field(fd, "title"),
    start_date: field(fd, "start_date"),
    end_date: field(fd, "end_date"),
  });
  if (!result.success) return null;
  // The hidden `id` field carries the create/edit id chosen on open.
  const id = field(fd, "id") || newId();
  return {
    id,
    title: result.data.title,
    start_date: result.data.start_date,
    end_date: result.data.end_date,
  };
}

/** Build the local-first meta. `editing` decides op (create vs update) and,
 *  for a create, seeds the multi-entity guard / discard-revert with the new
 *  id. applyLocal preserves created_at/created_by on edit. */
function makeMeta(editing: BlockedPeriod | null): WrapMeta<BlockOutParsedInput> {
  return {
    actionName: "saveBlockedPeriodAction",
    entityType: "blocked_period",
    entityId: (input) => input.id,
    op: editing ? "update" : "create",
    ...(editing ? {} : { entityIds: (input) => [input.id] }),
    parseInput: parseBlockOutFormData,
    replayArgs: (input, formData) => ({
      ...formDataToObject(formData),
      id: input.id,
      title: input.title,
      start_date: input.start_date,
      end_date: input.end_date,
    }),
    applyLocal: async (input) => {
      const now = new Date().toISOString();
      const row: BlockedPeriod = {
        id: input.id,
        created_at: editing?.created_at ?? now,
        updated_at: now,
        deleted_at: null,
        start_date: input.start_date,
        end_date: input.end_date,
        title: input.title,
        created_by: editing?.created_by ?? null,
      };
      await db.blocked_periods.put(row);
    },
  };
}

interface BlockOutModalProps {
  /** Parent mounts this only while open, so every open is a fresh mount. */
  onClose: () => void;
  /** Present → edit that period; absent → create a new one. */
  editing?: BlockedPeriod | null;
}

export function BlockOutModal({ onClose, editing = null }: BlockOutModalProps) {
  // Stable id for the lifetime of this open: the edit row's id, or a fresh
  // one for a create. Shared by the local write, the outbox replay, and the
  // online server call.
  const [id] = useState(() => editing?.id ?? newId());
  const meta = useMemo(() => makeMeta(editing), [editing]);

  const [state, formAction, isPending] = useLocalFirstAction(
    saveBlockedPeriodAction,
    INITIAL_ACTION_STATE,
    meta
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // Online success → the row is on the server; refresh so the calendar
  // re-fetches and shows the band, then close.
  useEffect(() => {
    if (state.success) {
      onClose();
      router.refresh();
    }
  }, [state.success, onClose, router]);

  // Escape-to-close.
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

    const result = BlockedPeriodSchema.safeParse({
      title: field(fd, "title"),
      start_date: field(fd, "start_date"),
      end_date: field(fd, "end_date"),
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

    // Snapshot connectivity: the LEGACY wrap path only calls the server (and
    // flips state.success) when online. Offline the block is written to Dexie
    // + the outbox, so close now; it appears after the next sync.
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    await formAction(fd);
    if (offline) {
      onClose();
      router.refresh();
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelClass = "block text-xs font-medium text-gray-600";

  const today = todayUk();

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:py-12">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative flex h-full w-full flex-col bg-white shadow-xl sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {editing ? "Edit block-out" : "Block out days"}
          </h2>
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
          <input type="hidden" name="id" value={id} />
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label htmlFor="block-title" className={labelClass}>
                Reason
              </label>
              <input
                id="block-title"
                name="title"
                type="text"
                autoFocus
                defaultValue={editing?.title ?? ""}
                placeholder="e.g. Fishing at Bewl Water"
                className={inputClass}
              />
              {errors.title && (
                <p className="mt-1 text-xs text-red-600">{errors.title}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="block-start" className={labelClass}>
                  From
                </label>
                <input
                  id="block-start"
                  name="start_date"
                  type="date"
                  defaultValue={editing?.start_date ?? today}
                  className={inputClass}
                />
                {errors.start_date && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.start_date}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="block-end" className={labelClass}>
                  To <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  id="block-end"
                  name="end_date"
                  type="date"
                  defaultValue={editing?.end_date ?? ""}
                  className={inputClass}
                />
                {errors.end_date && (
                  <p className="mt-1 text-xs text-red-600">{errors.end_date}</p>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Leave <span className="font-medium">To</span> blank for a single
              day.
            </p>

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
              {isPending ? "Saving…" : editing ? "Save changes" : "Block out"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
