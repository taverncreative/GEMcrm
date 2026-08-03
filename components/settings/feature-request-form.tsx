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
  // CONTROLLED. React 19 resets uncontrolled inputs once a
  // <form action={fn}> action settles, so a server validation BOUNCE used to
  // wipe the message the operator had just written. Cleared explicitly on
  // success below — that clear used to come free with React's reset, and
  // losing it silently would leave a sent message sitting in the box
  // inviting a duplicate send.
  //
  // Not covered: a THROWN action. An unhandled rejection out of a form
  // action reaches the route error boundary, which replaces the page and
  // takes the form with it, controlled or not — so a connection dropping
  // mid-submit still costs the message. The obvious shim for that
  // (wrapFormActionGracefully) turns out to break the send entirely when
  // applied here: on this branch the row never reached the table, verified
  // against main on :3002. It has no live callers anywhere in the app,
  // which now looks deliberate. Left alone rather than shipped broken;
  // worth its own slice.
  const [message, setMessage] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  // Feedback is ONLINE-ONLY: feature_requests has no Dexie mirror and no
  // outbox entry, so a submit made offline would reach nothing. Block it
  // and say so plainly rather than let the form look like it sent. The
  // offline gate never dispatches, so the typed text is untouched there —
  // and now it survives a failed submit too, which is what the controlled
  // state above buys.
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
    // Sent — empty the box. Keyed on submittedAt via the ref above, so this
    // runs once per submit and can never wipe text typed after it.
    setMessage("");
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
          value={message}
          onChange={(e) => setMessage(e.target.value)}
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
