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
 * Without this wrapper, both manifest as an unhandled rejection
 * out of the server-action call: the modal hangs, no error message
 * appears, the operator thinks the click did nothing. With them, the
 * action gracefully returns a `{success: false, message: "Couldn't
 * save — connection lost…"}` shape the existing UI already knows how
 * to render.
 *
 * `wrapDirectCallGracefully` — for actions used via
 * `await action(args)` from a button onClick. Eight live callers: the
 * delete confirms (customer, job, site, agreement, report), the
 * block-out modal, the calendar task chip, and the past-request
 * actions.
 *
 * It intercepts ONLY transport-layer failures (TypeError: fetch failed
 * and friends). Server-side `{success:false, message:"..."}` results
 * pass through untouched — they already carry the right message for
 * the operator.
 *
 * ── There used to be a second flavour. Do not bring it back. ──
 *
 * `wrapFormActionGracefully` wrapped a `(prev, formData)` action for
 * `useActionState`. It was deleted because it does not work, and the
 * way it fails is silent, so it costs a day to diagnose:
 *
 *   `<form action={clientFn}>`  WORKS. React calls your client
 *   function with the FormData and you call the server action yourself
 *   from inside it. This is what useGracefulFormAction and
 *   useLocalFirstAction both do.
 *
 *   `useActionState(clientFnWrappingServerAction)`  DOES NOT. The
 *   submit event fires, React marks the form as its own
 *   (action="javascript:throw new Error('React form unexpectedly
 *   submitted.')"), and then nothing happens at all: the wrapper body
 *   is never entered, no POST for the action reaches the server, no
 *   error appears anywhere. The form just quietly does not send.
 *
 * Proven by A/B/A against the real database on :3002, submitting the
 * feedback form four times: action passed directly → row inserted;
 * wrapped in this shim → no row; wrapped in a TRIVIAL pass-through
 * closure with no try/catch and no logic at all → no row; passed
 * directly again → row inserted. The pass-through leg is the one that
 * matters — it proves the fault is the composition, not anything in
 * the wrapper's body, so there is no version of this helper that
 * works.
 *
 * lib/actions/wrap.ts (see the long note above `useLocalFirstAction`'s
 * state) documents the same root cause, found independently in
 * hands-on testing. Note that NEITHER case reproduces in jsdom —
 * React's test-environment transition lifecycle is more permissive
 * than the production build — so a green unit test proves nothing
 * here. Only a live submit with the database as the oracle catches it.
 *
 * If you need graceful failure for a form action, use
 * `useGracefulFormAction` (lib/actions/use-graceful-form-action.ts).
 *
 * Out of scope: this wrapper does NOT enqueue the action for retry.
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
