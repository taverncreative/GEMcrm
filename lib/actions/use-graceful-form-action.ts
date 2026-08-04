"use client";

/**
 * `useActionState` ergonomics, minus the two ways it loses the
 * operator's work.
 *
 * Returns `[state, formAction, isPending]` and is used exactly the same
 * way — `<form action={formAction}>` — but owns its state with
 * useState + useTransition and calls the server action itself inside a
 * try/catch. That is the shape already proven twice in production:
 * the agreement wizard (components/agreements/add-agreement-form.tsx)
 * and `useLocalFirstAction` (lib/actions/wrap.ts).
 *
 * ── What it fixes ──
 *
 *   1. A THROWN action. `useActionState` rethrows during render, the
 *      route error boundary catches it, and the whole form unmounts —
 *      taking whatever the operator had typed with it. A dropped
 *      connection mid-submit is enough. Here the throw is caught, the
 *      form never unmounts, and the message is still on screen to
 *      retry.
 *
 *   2. Pending state after an await. React's form-action transition is
 *      considered settled once the dispatched function's promise
 *      resolves, so a caller that awaits something BEFORE dispatching
 *      falls outside it and `isPending` never flips — a button that
 *      looks dead for the whole request. The transition is opened here,
 *      synchronously, so it does not matter when we are called.
 *
 * ── Why not just wrap the action and keep useActionState ──
 *
 * Because that silently does nothing. See the discriminator recorded
 * in lib/actions/graceful.ts: a client closure wrapping a server action
 * dispatches fine from `<form action={clientFn}>`, and NEVER dispatches
 * when handed to `useActionState`. This hook is the `<form action>`
 * side of that line, which is the side that works.
 *
 * ── Scope ──
 *
 * Unlike the deleted `wrapFormActionGracefully`, this catches NON-network
 * throws too. Re-throwing them would hand the error boundary the form it
 * is holding the operator's text in, which is the exact failure this
 * exists to prevent. A real bug still reaches the console; it just does
 * not cost the operator their typing.
 *
 * This is for ONLINE-ONLY forms that own their own state. Anything that
 * must survive offline belongs on `useLocalFirstAction` instead, which
 * adds the Dexie write and the outbox entry.
 */

import { useCallback, useRef, useState, useTransition } from "react";

const DEFAULT_ERROR_MESSAGE =
  "Couldn't send that — the connection dropped or the server didn't " +
  "answer. Nothing you typed is lost. Try again.";

export interface GracefulFormState {
  success: boolean;
  errors: Record<string, string>;
  message: string | null;
}

export interface GracefulFormOptions<TState> {
  /** Build the state shown when the action THREW. Defaults to a
   *  connection-flavoured message on the caller's initial state. */
  errorState?: (err: unknown) => TState;
}

export function useGracefulFormAction<TState extends GracefulFormState>(
  action: (prev: TState, formData: FormData) => Promise<TState>,
  initialState: TState,
  opts?: GracefulFormOptions<TState>
): [TState, (formData: FormData) => void, boolean] {
  const [state, setState] = useState<TState>(initialState);
  const [isPending, startTransition] = useTransition();
  // Synchronous re-entry guard. `isPending` disables the submit button,
  // but a double-tap inside one frame lands before React has re-rendered
  // with the disabled attribute — and a second send is a second row.
  const inFlightRef = useRef(false);
  // Kept in a ref so the returned formAction stays stable while still
  // passing the LATEST state as `prev`, the way useActionState does.
  const stateRef = useRef(state);
  stateRef.current = state;

  const formAction = useCallback(
    (formData: FormData) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      // Opened synchronously, so an awaiting caller still gets a real
      // isPending (reason 2 above).
      startTransition(async () => {
        try {
          setState(await action(stateRef.current, formData));
        } catch (err) {
          console.error("[useGracefulFormAction] action threw:", err);
          setState(
            opts?.errorState?.(err) ?? {
              ...initialState,
              success: false,
              errors: {},
              message: DEFAULT_ERROR_MESSAGE,
            }
          );
        } finally {
          inFlightRef.current = false;
        }
      });
    },
    // `initialState` and `opts` are read only inside the catch; callers
    // define them at module scope (as every caller in this app does), so
    // this stays stable in practice.
    [action, initialState, opts]
  );

  return [state, formAction, isPending];
}
