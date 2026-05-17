"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePasswordAction } from "@/app/(app)/settings/actions";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const labelClass = "block text-xs font-medium text-gray-600";

export function ChangePasswordForm() {
  const [state, action, isPending] = useActionState(
    changePasswordAction,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Wipe the inputs after a successful change — we never want passwords
  // sitting in the DOM longer than necessary, and the form should feel
  // "reset" rather than leaving stale values.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <div>
        <label htmlFor="current_password" className={labelClass}>
          Current password
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
        {state.errors.current_password && (
          <p className="mt-1 text-xs text-red-500">
            {state.errors.current_password}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="new_password" className={labelClass}>
          New password
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={inputClass}
        />
        {state.errors.new_password && (
          <p className="mt-1 text-xs text-red-500">
            {state.errors.new_password}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="confirm_password" className={labelClass}>
          Confirm new password
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className={inputClass}
        />
        {state.errors.confirm_password && (
          <p className="mt-1 text-xs text-red-500">
            {state.errors.confirm_password}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">
          Minimum 8 characters. Use something you don&apos;t use elsewhere.
        </p>
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Updating…" : "Update"}
        </button>
      </div>

      {state.message && (
        <p
          className={`text-sm ${
            state.success ? "text-brand-darker" : "text-red-600"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
