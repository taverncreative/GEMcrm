"use client";

import { useActionState, useState } from "react";
import { submitFeatureRequestAction } from "@/app/(app)/settings/actions";
import { BUSINESS } from "@/lib/constants/branding";
import { useIsOnline } from "@/lib/hooks/use-is-online";
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
  // Feedback is ONLINE-ONLY: feature_requests has no Dexie mirror and no
  // outbox entry, so a submit made offline would reach nothing. Block it
  // and say so plainly rather than let the form look like it sent. The
  // text the operator has typed is deliberately left intact — a blip
  // shouldn't cost them the message.
  const online = useIsOnline();

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

      {!online && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You&apos;re offline, feedback needs a connection. Your message is
          safe here — send it once you&apos;re back online.
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          Sends to <span className="font-mono">{BUSINESS.supportEmail}</span>
        </p>
        <button
          type="submit"
          disabled={isPending || !online}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Sending…" : online ? "Send" : "Offline"}
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
