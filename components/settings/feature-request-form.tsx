"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { submitFeatureRequestAction } from "@/app/(app)/settings/actions";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { ROUTES } from "@/lib/constants/routes";
import type { FeedbackActionState } from "@/types/actions";

const initialState: FeedbackActionState = {
  success: false,
  errors: {},
  message: null,
};

const TYPE_OPTIONS = [
  { value: "feature", label: "Feature request" },
  { value: "bug", label: "Bug report" },
  { value: "change", label: "Change request" },
] as const;

/** "14:03:22" — UK 24-hour clock, in the operator's own timezone (the
 *  server stamps UTC; formatting client-side keeps the hour honest). */
function formatSubmitTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

interface FeatureRequestFormProps {
  currentUserEmail?: string;
}

export function FeatureRequestForm({ currentUserEmail }: FeatureRequestFormProps) {
  const [state, action, isPending] = useActionState(
    submitFeatureRequestAction,
    initialState
  );
  const [type, setType] = useState<string>("feature");
  const pathname = usePathname();
  const router = useRouter();
  // Feedback is ONLINE-ONLY: feature_requests has no Dexie mirror and no
  // outbox entry, so a submit made offline would reach nothing. Block it
  // and say so plainly rather than let the form look like it sent. The
  // text the operator has typed is deliberately left intact — a blip
  // shouldn't cost them the message.
  const online = useIsOnline();

  // On success, refresh the past-requests list — but ONLY when this form is
  // rendered on the Settings page, where that list lives. The action itself
  // deliberately revalidates nothing (a broad revalidatePath purges the
  // whole client router cache and stampedes a re-prefetch of every link on
  // the current page — the cause of the slow repeat submits), so a submit
  // from the header sheet on any other page invalidates nothing at all.
  // The ref marks each submit consumed so navigating to Settings later
  // can't replay a stale refresh.
  const consumedSubmitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state.success || !state.submittedAt) return;
    if (consumedSubmitRef.current === state.submittedAt) return;
    consumedSubmitRef.current = state.submittedAt;
    if (pathname === ROUTES.SETTINGS) router.refresh();
  }, [state, pathname, router]);

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
          safe here; send it once you&apos;re back online.
        </p>
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={isPending || !online}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Sending…" : online ? "Send" : "Offline"}
        </button>
      </div>

      {/* Persistent live region so repeat confirmations are announced; the
          inner <p> is keyed on the submit timestamp so React remounts it and
          the highlight animation re-runs on EVERY submit — the unmistakable
          "yes, THIS one sent" signal a static line can't give. */}
      <div aria-live="polite">
        {state.success && state.submittedAt && (
          <p
            key={state.submittedAt}
            className="animate-feedback-flash -mx-2 rounded-md px-2 py-1 text-sm text-brand-darker"
          >
            Thanks, request logged at {formatSubmitTime(state.submittedAt)}
          </p>
        )}
      </div>
      {state.message && !state.success && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}
    </form>
  );
}
