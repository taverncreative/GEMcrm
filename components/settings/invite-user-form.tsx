"use client";

import { useActionState, useEffect, useRef } from "react";
import { inviteUserAction } from "@/app/(app)/settings/actions";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const labelClass = "block text-xs font-medium text-gray-600";

export function InviteUserForm() {
  const [state, action, isPending] = useActionState(
    inviteUserAction,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <div>
        <label htmlFor="invite_email" className={labelClass}>
          Email <span className="text-red-500">*</span>
        </label>
        <input
          id="invite_email"
          name="email"
          type="email"
          autoComplete="off"
          required
          placeholder="teammate@example.com"
          className={inputClass}
        />
        {state.errors.email && (
          <p className="mt-1 text-xs text-red-500">{state.errors.email}</p>
        )}
      </div>

      <div>
        <label htmlFor="invite_full_name" className={labelClass}>
          Full name (optional)
        </label>
        <input
          id="invite_full_name"
          name="full_name"
          type="text"
          autoComplete="off"
          placeholder="e.g. Jane Smith"
          className={inputClass}
        />
        {state.errors.full_name && (
          <p className="mt-1 text-xs text-red-500">{state.errors.full_name}</p>
        )}
      </div>

      <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
        Heads up: anyone with an account has full access. There&apos;s no
        admin / read-only distinction yet. Only invite people you trust to
        edit customers, jobs, invoices and agreements.
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">
          They&apos;ll get an email link to sign in. No password needed up
          front.
        </p>
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Sending…" : "Send invite"}
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
