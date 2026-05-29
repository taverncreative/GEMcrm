"use client";

/**
 * Local-first action wrappers.
 *
 * Two flavours, same idea:
 *
 *   - `useLocalFirstAction(serverAction, initialState, meta)` — a hook
 *      that drop-in replaces `useActionState`. The returned `action`
 *      can still be used as `<form action={action}>`. Local Dexie write
 *      happens BEFORE the server is asked.
 *
 *   - `wrapAction(serverAction, meta)` — a plain function wrapper for
 *      direct-call actions (i.e. ones called via `await someAction(args)`
 *      from a button onClick, not via useActionState). Same local-first
 *      contract, no React state.
 *
 * Both follow the same three-step recipe:
 *
 *   1. **applyLocal** — write the canonical change to Dexie. If this
 *      throws (constraint violation, schema mismatch), abort. The user's
 *      operation is conceptually rejected — we never reach the server
 *      and never enqueue.
 *
 *   2. **enqueue** — always queue an outbox entry, even when online.
 *      The entry is the recovery mechanism if the page reloads / the
 *      server call throws / the user's tab dies mid-flight. Step 6's
 *      sync engine handles "already applied" idempotently.
 *
 *   3. **server call (online only)** — if `navigator.onLine`, dispatch
 *      the server action. On success we *could* delete the outbox
 *      entry to keep it small (online fast-path), but we don't bother
 *      in step 5 — step 6's sync engine will clear successfully-replayed
 *      entries when it next drains. Keeps step-5 simple and step-6's
 *      dedup logic exercises every code path.
 *
 *      If offline, the server call is skipped. The change is local-only
 *      until next online sync drains the outbox.
 *
 * Divergence between local and server rows
 * ----------------------------------------
 * Local writes use client-supplied values. Server-computed fields
 * (normalisation, server timestamps, generated reference numbers etc)
 * will overwrite the local row on the next pull sync. If your action
 * depends on a server-computed value at the call site, that's a
 * sync-ordering concern — but no current wrapped action does. Wrapped
 * actions either flip a flag (review received, job status, agreement
 * status) or set a soft-delete timestamp — values the client can
 * compute authoritatively.
 */

import { useCallback, useState, useTransition } from "react";
import { enqueueAction, type EntityType } from "@/lib/db/outbox";

export interface WrapMeta<TInput> {
  /** Server-action export name. Must match exactly — step 6 uses this
   *  as the registry key when replaying. */
  actionName: string;
  /** Entity kind this action mutates — drives dedup + conflict logic
   *  in step 6's sync engine. */
  entityType: EntityType;
  /** Extract the canonical entity id from the parsed input. */
  entityId: (input: TInput) => string;
  /** Convert FormData (form-action wrappers) into a typed input the
   *  local layer understands. Return null to skip the local write — the
   *  server call still happens online, but no outbox entry is created.
   *  Useful for forms where we want server-side validation to drive the
   *  outcome (rare in practice). */
  parseInput?: (formData: FormData) => TInput | null;
  /** Write the local Dexie row. Throws on failure. */
  applyLocal: (input: TInput) => Promise<void>;
}

// ─── FormData ↔ JSON ────────────────────────────────────────────────

/**
 * Serialise FormData to a plain JSON-safe object. Repeated keys become
 * arrays.
 *
 * Throws if any value is a File — the outbox can't store file bytes
 * and replaying a marker string would silently corrupt the action.
 * Callers carrying photos must use `capturePhoto()` (lib/db/photos.ts)
 * to stash the blob in `photos_pending` and submit the resulting
 * client id as a plain string field instead.
 */
function formDataToObject(formData: FormData): Record<string, string | string[]> {
  const obj: Record<string, string | string[]> = {};
  formData.forEach((value, key) => {
    if (typeof value !== "string") {
      throw new Error(
        "FormData contains a File. Files cannot be queued in the outbox. " +
          "Use capturePhoto() to store the file in photos_pending and pass " +
          "the photo id as a string."
      );
    }
    const existing = obj[key];
    if (existing === undefined) {
      obj[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      obj[key] = [existing, value];
    }
  });
  return obj;
}

function isOnline(): boolean {
  // Server-render fallback: treat SSR as "online" — server execution
  // never runs through this wrapper (it's "use client"), but the
  // typeof guard keeps Node-side typechecking happy.
  return typeof navigator === "undefined" || navigator.onLine;
}

// ─── Form-action hook ────────────────────────────────────────────────

/**
 * Drop-in replacement for React 19's `useActionState` that adds
 * local-first Dexie write + outbox enqueue + offline tolerance.
 *
 * Usage shape is identical to useActionState:
 *
 *   const [state, action, isPending] = useLocalFirstAction(
 *     serverAction,
 *     initialState,
 *     meta,        // see WrapMeta above
 *   );
 *   return <form action={action}>...</form>;
 *
 * **Pass `meta` as a stable reference** (define outside the component
 * or wrap in useMemo). The returned `action` re-creates whenever `meta`
 * changes, which is fine but uses an extra render.
 */
export function useLocalFirstAction<TState, TInput>(
  serverAction: (prev: Awaited<TState>, formData: FormData) => Promise<TState>,
  initialState: Awaited<TState>,
  meta: WrapMeta<TInput>
): [Awaited<TState>, (formData: FormData) => Promise<void>, boolean] {
  // Manually own state + pending. We DELIBERATELY do NOT use
  // useActionState here, even though our return shape mimics it.
  //
  // Why: React 19's `<form action={fn}>` wraps `fn` in its own
  // transition. When fn is async (like our wrappedDispatch), React
  // treats the form-action transition as COMPLETE the moment fn's
  // Promise resolves. Our applyLocal + enqueueAction resolve quickly
  // (local Dexie work). If we then dispatch via useActionState's
  // baseDispatch, the late state update from baseDispatch's async
  // server action can be dropped on the floor because the outer
  // form-action transition has already settled.
  //
  // The symptom: action fires server-side (sync pill animates), but
  // state.success never flips → the modal-open effect never runs →
  // operator stares at the form thinking the button is dead. Caught
  // in surface-2 hands-on testing; not reproducible in jsdom because
  // React 19's test-environment transition lifecycle is more
  // permissive than the production build.
  //
  // Fix: own state via plain useState; manually call the server
  // action and setState the result. Pending tracked via useTransition
  // wrapping the dispatch. State updates are detached from React's
  // form-action lifecycle and always land.
  const [state, setState] = useState<Awaited<TState>>(initialState);
  const [isPending, startTransition] = useTransition();

  const wrappedDispatch = useCallback(
    async (formData: FormData) => {
      const input = meta.parseInput?.(formData) ?? null;

      if (input !== null) {
        // 1. Local-first Dexie write. If this throws (constraint
        //    violation, table missing, etc) we surface the error and
        //    abort — the user's intent is conceptually rejected.
        try {
          await meta.applyLocal(input);
        } catch (err) {
          console.error(
            `[useLocalFirstAction] applyLocal failed for ${meta.actionName}:`,
            err
          );
          // Don't proceed — the local write is the source of truth for
          // "did this happen". If it didn't, neither should the server
          // write nor the outbox entry.
          return;
        }

        // 2. Always enqueue, even online. Recovery for mid-flight crashes.
        try {
          await enqueueAction({
            action_name: meta.actionName,
            args: formDataToObject(formData),
            entity_type: meta.entityType,
            entity_id: meta.entityId(input),
          });
        } catch (err) {
          console.error(
            `[useLocalFirstAction] enqueue failed for ${meta.actionName}:`,
            err
          );
          // Outbox failure means we lose the ability to replay. Abort
          // so the user sees their action didn't fully land.
          return;
        }
      }

      // 3. Online → call the server action directly, await it, store
      //    the result via setState. The whole thing is wrapped in
      //    startTransition so isPending stays true until the server
      //    responds. Detached from the outer form-action lifecycle.
      if (isOnline()) {
        startTransition(async () => {
          try {
            const result = await serverAction(state, formData);
            setState(result);
          } catch (err) {
            console.error(
              `[useLocalFirstAction] server call failed for ${meta.actionName}:`,
              err
            );
            // Leave state unchanged — the outbox entry survives so the
            // sync engine will retry. The operator can also retry by
            // resubmitting; the (entity_type, entity_id) compaction in
            // the outbox folds duplicate attempts.
          }
        });
      }
    },
    // `state` is in deps because we pass it as `prev` to the server
    // action. The callback re-creates on each state change; the form
    // sees the latest reference via the action prop on next render.
    [serverAction, meta, state, startTransition]
  );

  return [state, wrappedDispatch, isPending];
}

// ─── Direct-call function wrapper ────────────────────────────────────

/**
 * Wrap a direct-call server action (e.g. `setCustomerTypeAction(id, type)`
 * called from a button's onClick) with the same local-first contract.
 *
 * Usage:
 *
 *   const wrappedSetType = wrapAction(setCustomerTypeAction, {
 *     actionName: "setCustomerTypeAction",
 *     entityType: "customer",
 *     entityId: ([customerId]) => customerId,
 *     applyLocal: async ([customerId, type]) => {
 *       await db.customers.update(customerId, { customer_type: type, ... });
 *     },
 *   });
 *
 *   // Then call exactly like the original:
 *   const res = await wrappedSetType(customerId, type);
 *   if (!res.success) { ... revert optimistic UI ... }
 *
 * The wrapper accepts the same argument tuple as the server action and
 * returns a normalised `LocalActionResult`. Local-first semantics: the
 * promise resolves once the local write + enqueue have completed; the
 * server call fires in the background and its failures are recorded on
 * the outbox entry for the sync engine to retry. `success: true` means
 * "the local write landed and the action is queued for the server" —
 * not "the server has confirmed". Original-action return values from
 * the server are discarded; if the call site needs them, this wrapper
 * isn't the right tool.
 */

/**
 * Return shape for `wrapAction` callers. Mirrors the
 * `{ success, message }` shape that most direct-call server actions
 * already return, so call sites' revert-on-failure paths work
 * unchanged. `error` populates only on local failure (applyLocal or
 * enqueue threw) — server-side failures are silent here and surface
 * via the outbox / sync engine later.
 */
export interface LocalActionResult {
  success: boolean;
  error?: string;
}

export function wrapAction<TArgs extends readonly unknown[], TResult>(
  serverAction: (...args: TArgs) => Promise<TResult>,
  meta: {
    actionName: string;
    entityType: EntityType;
    entityId: (args: TArgs) => string;
    applyLocal: (args: TArgs) => Promise<void>;
  }
): (...args: TArgs) => Promise<LocalActionResult> {
  return async (...args: TArgs): Promise<LocalActionResult> => {
    // 1. Local write.
    try {
      await meta.applyLocal(args);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Local write failed";
      console.error(
        `[wrapAction] applyLocal failed for ${meta.actionName}:`,
        err
      );
      return { success: false, error: message };
    }

    // 2. Outbox.
    try {
      await enqueueAction({
        action_name: meta.actionName,
        // For direct calls we store args as the tuple directly. Step 6
        // applies it via `serverAction(...entry.args as TArgs)`.
        args: args as unknown,
        entity_type: meta.entityType,
        entity_id: meta.entityId(args),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Outbox enqueue failed";
      console.error(
        `[wrapAction] enqueue failed for ${meta.actionName}:`,
        err
      );
      return { success: false, error: message };
    }

    // 3. Fire server call when online.
    if (isOnline()) {
      // Fire-and-forget — caller doesn't await the network round-trip.
      // The local + outbox writes are what the caller cares about.
      void serverAction(...args).catch((err) => {
        console.warn(
          `[wrapAction] server call failed for ${meta.actionName}:`,
          err
        );
        // Entry stays in outbox; sync engine will retry.
      });
    }

    return { success: true };
  };
}
