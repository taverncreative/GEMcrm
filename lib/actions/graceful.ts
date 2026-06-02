"use client";

/**
 * Client-side graceful-failure shims for server actions.
 *
 * Background — Surface-3 operator feedback. With the offline guards
 * now reliable (post-serverReachable commit), the three multi-entity
 * write paths (Booking, Invoice, Delete) are disabled when offline.
 * But two race windows remain:
 *
 *   (a) connection drops AFTER the modal opens but BEFORE the
 *       operator submits — the disable guard had no chance to flip;
 *   (b) connection drops MID-submit — fetch was in flight when the
 *       transport failed.
 *
 * Without these wrappers, both manifest as an unhandled rejection
 * out of the server-action call: the modal hangs, no error message
 * appears, the operator thinks the click did nothing. With them, the
 * action gracefully returns a `{success: false, message: "Couldn't
 * save — connection lost…"}` shape the existing UI already knows how
 * to render.
 *
 * Two flavours, matching how the three modals dispatch:
 *
 *   - `wrapFormActionGracefully` — for actions used with
 *     `useActionState` (`(prev, formData) => Promise<state>`). Used
 *     by Booking + Invoice modals.
 *
 *   - `wrapDirectCallGracefully` — for actions used via
 *     `await action(args)` from a button onClick. Used by the
 *     Delete confirm.
 *
 * Both intercept ONLY transport-layer failures (TypeError: fetch
 * failed and friends). Server-side `{success:false, message:"..."}`
 * results pass through untouched — they already carry the right
 * message for the operator.
 *
 * Out of scope: these wrappers do NOT enqueue the action for retry.
 * The three controls remain online-only — the multi-entity
 * entity_ids[] guard is the prerequisite for queueing them. Today's
 * goal is just "don't hang silently."
 */

import { isNetworkError } from "@/lib/sync/is-network-error";

const OFFLINE_MESSAGE =
  "Couldn't save — connection lost. Try again when you're back online.";

export interface GracefulFailureResult {
  success: false;
  errors: Record<string, string>;
  message: string;
}

/**
 * Wrap a form-action `(prev, formData) => Promise<TState>` so any
 * thrown network failure resolves to a `{success:false}` shape
 * compatible with the caller's existing state type. Server-thrown
 * non-network errors pass through (the action's own try/catch is
 * trusted to produce a proper state).
 *
 * Caller must guarantee `TState` includes the standard
 * `{success, errors, message}` shape. The two production callers
 * (Booking + Invoice modals) both use `ActionState`, which does.
 */
export function wrapFormActionGracefully<
  TState extends { success: boolean; errors: Record<string, string>; message: string | null },
>(
  action: (prev: TState, formData: FormData) => Promise<TState>
): (prev: TState, formData: FormData) => Promise<TState> {
  return async (prev, formData) => {
    try {
      return await action(prev, formData);
    } catch (err) {
      if (isNetworkError(err)) {
        return {
          ...prev,
          success: false,
          errors: {},
          message: OFFLINE_MESSAGE,
        };
      }
      // Re-throw non-network errors so the action's own state
      // discipline or React's error boundary handle them as before.
      // We don't want to silently re-shape a real bug into a
      // connectivity message.
      throw err;
    }
  };
}

/**
 * Wrap a direct-call action `(...args) => Promise<TResult>` so any
 * thrown network failure resolves to a `{success:false, message}`
 * shape. The caller decides how to surface the message (see
 * DeleteCustomerConfirm for the canonical use).
 *
 * `TResult` must include `{success: boolean, message?: string}` —
 * the three direct-call callers in the codebase (deleteCustomerAction
 * + the two new wrapped customer toggles) all do.
 */
export function wrapDirectCallGracefully<
  TArgs extends readonly unknown[],
  TResult extends { success: boolean; message?: string },
>(
  action: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult | GracefulFailureResult> {
  return async (...args: TArgs) => {
    try {
      return await action(...args);
    } catch (err) {
      if (isNetworkError(err)) {
        return {
          success: false,
          errors: {},
          message: OFFLINE_MESSAGE,
        };
      }
      throw err;
    }
  };
}
