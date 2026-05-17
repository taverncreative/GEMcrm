"use client";

import { useActionState, useState } from "react";
import { submitFeatureRequestAction } from "@/app/(app)/settings/actions";
import { BUSINESS } from "@/lib/constants/branding";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

const TYPE_OPTIONS = [
  { value: "feature", label: "Feature request" },
  { value: "bug", label: "Bug report" },
  { value: "change", label: "Change request" },
] as const;

interface FeatureRequestFormProps {
  currentUserEmail?: string;
}

export function FeatureRequestForm({ currentUserEmail }: FeatureRequestFormProps) {
  const [state, action, isPending] = useActionState(
    submitFeatureRequestAction,
    initialState
  );
  const [type, setType] = useState<string>("feature");

  return (
    <form action={action} className="space-y-3">
      <input
        type="hidden"
        name="submitter_email"
        value={currentUserEmail ?? ""}
      />
      <input type="hidden" name="request_type" value={type} />

      <div>
        <p className="text-xs font-medium text-gray-600">Type</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setType(opt.value)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                type === opt.value
                  ? "border-brand bg-brand-soft text-brand-darker"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="fr-message" className="text-xs font-medium text-gray-600">
          What&apos;s on your mind?
        </label>
        <textarea
          id="fr-message"
          name="message"
          rows={4}
          placeholder="Describe the change, bug, or feature you'd like…"
          required
          className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        {state.errors.message && (
          <p className="mt-1 text-xs text-red-500">{state.errors.message}</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          Sends to <span className="font-mono">{BUSINESS.supportEmail}</span>
        </p>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Sending…" : "Send"}
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
