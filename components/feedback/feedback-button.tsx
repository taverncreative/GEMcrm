"use client";

/**
 * Header feedback entry point.
 *
 * Nate's requests used to arrive as scattered WhatsApps because the
 * capture form, though fully built, sat at the BOTTOM of Settings —
 * More → Settings → scroll past three sections. Five taps. WhatsApp is
 * one. This puts it two taps from anywhere: header icon → sheet.
 *
 * Deliberately subtle: a small ghost speech-bubble in the dark header
 * strip, no label, no badge. It sits next to the sync chip in the
 * Topbar, which AppShell renders on EVERY screen at every breakpoint, so
 * this is a single placement that serves mobile and desktop both.
 *
 * The form itself is the existing FeatureRequestForm, unchanged and
 * unduplicated — this only supplies a way to reach it. The Settings
 * "Request a change" section stays exactly as it was: still the stable
 * home, still the desktop path, and it also renders the past-requests
 * list this sheet has no business duplicating.
 *
 * On success the sheet stays OPEN: React 19 resets the uncontrolled
 * textarea after the action round trip, so the form self-clears and the
 * "Thanks — request logged." confirmation is what remains on screen.
 * Auto-closing would swallow that confirmation.
 */

import { useEffect, useState } from "react";
import { FeatureRequestForm } from "@/components/settings/feature-request-form";

export function FeedbackButton({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);

  // Escape closes, matching the app's other modals.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Send feedback"
        aria-label="Send feedback"
        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-ink-soft hover:text-white"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 10.5h8M8 14h5M21 12a8.5 8.5 0 0 1-8.5 8.5H7l-3.2 2.4A.5.5 0 0 1 3 22.5V12a8.5 8.5 0 0 1 8.5-8.5h1A8.5 8.5 0 0 1 21 12Z"
          />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:py-12">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Send feedback"
            className="relative flex h-full w-full flex-col bg-white shadow-xl sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">
                Send feedback
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <p className="mb-3 text-xs text-gray-500">
                Spotted a bug, or want something changed? Send it here rather
                than WhatsApp and it goes straight onto the list.
              </p>
              <FeatureRequestForm currentUserEmail={userEmail} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
