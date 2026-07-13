"use client";

/**
 * Action registry — maps `action_name` strings stored in outbox entries
 * to the actual server action references.
 *
 * The push loop (`lib/sync/push.ts`) calls `invokeFromRegistry(entry)`
 * for each outbox row to replay it server-side. The registry knows two
 * dispatch shapes:
 *
 *   form    → the wrapper stored args as `Record<string, string|string[]>`
 *             from `formDataToObject`. Reconstruct FormData via
 *             `objectToFormData`, then invoke `action(initialState, fd)`.
 *
 *   direct  → the wrapper stored args as the raw tuple. Spread it into
 *             the action call: `action(...args)`.
 *
 * Adding a new wrapped action is a single import + a single entry here.
 * That ergonomic is deliberate — the registry is the only point where
 * the mapping from "name on disk" to "callable reference" lives, so
 * forgetting to register is a single failure point you find immediately
 * on first sync drain (the loop marks the entry stuck with a clear
 * "Unknown action" last_error).
 *
 * Currently registered: the 4 representative actions wrapped in step 5
 * (one per entity except site, which has no clean single-row action).
 * Adding the remaining 6 wrap-classified actions is part of the step-7
 * rollout — they get wrapped at their call sites AND added here.
 */

import { completeTaskAction } from "@/app/(app)/dashboard/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import {
  updateJobStatusAction,
  rescheduleJobAction,
} from "@/app/(app)/jobs/[id]/actions";
import { updateAgreementStatusAction } from "@/app/(app)/agreements/[id]/actions";
import {
  setReviewReceivedAction,
  setCustomerTypeAction,
  setCustomerEmailAction,
  setCustomerDocDetailsAction,
  createCustomerAction,
} from "@/app/(app)/customers/actions";
import { completeServiceSheetAction } from "@/app/(app)/jobs/[id]/complete/actions";
import { createQuickBookingAction } from "@/app/(app)/bookings/actions";
import type { ActionState } from "@/types/actions";

/** Fresh initial state to satisfy the React `useActionState` calling
 *  convention `(prevState, formData) => Promise<State>` when replaying
 *  outside of React. The action body doesn't read `prevState` — it's
 *  just for React's state-tracking. Pass a stock value each replay. */
const INITIAL_FORM_STATE: ActionState = {
  success: false,
  errors: {},
  message: null,
};

type FormEntry = {
  kind: "form";
  invoke: (fd: FormData) => Promise<unknown>;
};

type DirectEntry = {
  kind: "direct";
  invoke: (...args: unknown[]) => Promise<unknown>;
};

export type RegistryEntry = FormEntry | DirectEntry;

/**
 * The map. Keep entries sorted by entity for grep-ability.
 */
export const REGISTRY: Record<string, RegistryEntry> = {
  // ─── task ────────────────────────────────────────────────────
  completeTaskAction: {
    kind: "form",
    invoke: (fd) => completeTaskAction(INITIAL_FORM_STATE, fd),
  },
  // Manual to-do create (Tasks module v1). Replayed from the id-enriched
  // args the wrapper persisted (id + title/due_date/notes), so the
  // server row matches the locally-created one. Idempotent via
  // createTask's upsert-on-id.
  createTaskAction: {
    kind: "form",
    invoke: (fd) => createTaskAction(INITIAL_FORM_STATE, fd),
  },

  // ─── job ─────────────────────────────────────────────────────
  updateJobStatusAction: {
    kind: "form",
    invoke: (fd) => updateJobStatusAction(INITIAL_FORM_STATE, fd),
  },
  // Reschedule (date/time move). Optimistic + one outbox entry; the
  // update is idempotent (last-write-wins on id), so a replay after an
  // online submit is harmless. A true partial-unique clash on the new
  // slot surfaces as a stuck entry in the conflict inbox.
  rescheduleJobAction: {
    kind: "form",
    invoke: (fd) => rescheduleJobAction(INITIAL_FORM_STATE, fd),
  },
  // Multi-entity create (step 8). Replayed from the id-enriched args
  // the wrapper persisted (job_id / customer_id_new / site_id_new), so
  // the server rows match the locally-created ones. Idempotent on
  // re-run via upsert-on-id in the data layer; a real partial-unique
  // clash surfaces as a stuck entry in the conflict inbox.
  createQuickBookingAction: {
    kind: "form",
    invoke: (fd) => createQuickBookingAction(INITIAL_FORM_STATE, fd),
  },
  completeServiceSheetAction: {
    kind: "form",
    // The action returns a richer shape (SaveServiceSheetResult with
    // pdfUrl/jobId), but the dispatcher only cares about success/fail
    // — pdfUrl regenerates server-side on next viewing, jobId is
    // already known to the wrapper. ActionState is the shared base.
    invoke: (fd) =>
      completeServiceSheetAction(
        { success: false, errors: {}, message: null },
        fd
      ),
  },

  // ─── customer ────────────────────────────────────────────────
  // Multi-entity create (customer + auto-created sites). The enqueued
  // args carry the client-generated ids (id / primary_site_id /
  // additional_sites[].id), so the replay upserts the SAME rows the
  // optimistic applyLocal wrote — see add-customer-form's meta.
  createCustomerAction: {
    kind: "form",
    invoke: (fd) => createCustomerAction(INITIAL_FORM_STATE, fd),
  },
  setReviewReceivedAction: {
    kind: "direct",
    invoke: (...args) =>
      setReviewReceivedAction(args[0] as string, args[1] as boolean),
  },
  setCustomerTypeAction: {
    kind: "direct",
    invoke: (...args) =>
      setCustomerTypeAction(
        args[0] as string,
        args[1] as "commercial" | "domestic"
      ),
  },
  setCustomerEmailAction: {
    kind: "direct",
    invoke: (...args) =>
      setCustomerEmailAction(args[0] as string, args[1] as string),
  },
  // Document-completeness gate (Pass 2): an OFFLINE email/address capture
  // enqueues this so it syncs on reconnect, with the same (customerId,
  // details) args. Online captures write directly and never enqueue.
  setCustomerDocDetailsAction: {
    kind: "direct",
    invoke: (...args) =>
      setCustomerDocDetailsAction(
        args[0] as string,
        args[1] as Parameters<typeof setCustomerDocDetailsAction>[1]
      ),
  },

  // ─── agreement ──────────────────────────────────────────────
  updateAgreementStatusAction: {
    kind: "form",
    invoke: (fd) => updateAgreementStatusAction(INITIAL_FORM_STATE, fd),
  },
};

// ─── FormData ↔ Object round-trip ────────────────────────────────

/**
 * Inverse of `formDataToObject` from `lib/actions/wrap.ts`. Rebuilds a
 * FormData instance from the JSON-safe shape we stored in the outbox.
 *
 * Array values become multiple `append()` calls (FormData supports
 * repeated keys natively, which is how `formDataToObject` handled them
 * on the way out).
 *
 * Round-trip property the smoke page verifies:
 *
 *   const before = new FormData();           // arbitrary scalars + array
 *   const obj    = formDataToObject(before);
 *   const after  = objectToFormData(obj);
 *   // for every key in `before`: getAll(key) on after === getAll(key) on before
 */
export function objectToFormData(
  obj: Record<string, string | string[]>
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      v.forEach((item) => fd.append(k, item));
    } else {
      fd.set(k, v);
    }
  }
  return fd;
}

// ─── Replay dispatcher ───────────────────────────────────────────

export class UnknownActionError extends Error {
  constructor(actionName: string) {
    super(`No registry entry for action_name: ${actionName}`);
    this.name = "UnknownActionError";
  }
}

/**
 * Invoke the registered action for an outbox entry. Throws
 * `UnknownActionError` if the action_name has no registry entry — the
 * push loop catches that and marks the entry stuck (an unknown action
 * is never going to succeed; no point retrying with backoff).
 *
 * Returns the action's resolved value as `unknown` — the caller
 * classifies via `classifyActionResult` from `http-classify.ts`.
 */
export async function invokeFromRegistry(entry: {
  action_name: string;
  args: unknown;
}): Promise<unknown> {
  const reg = REGISTRY[entry.action_name];
  if (!reg) {
    throw new UnknownActionError(entry.action_name);
  }
  if (reg.kind === "form") {
    const obj = (entry.args ?? {}) as Record<string, string | string[]>;
    const fd = objectToFormData(obj);
    return reg.invoke(fd);
  }
  // direct
  const args = Array.isArray(entry.args) ? entry.args : [];
  return reg.invoke(...(args as unknown[]));
}
