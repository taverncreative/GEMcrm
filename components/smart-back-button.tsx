"use client";

import { useRouter } from "next/navigation";

interface SmartBackButtonProps {
  /**
   * Where to go when there's no in-app history to return to (a cold load
   * or deep link). This is the screen's canonical parent — the same route
   * the back arrow used to be hardcoded to.
   */
  fallbackHref: string;
  className?: string;
  /** Accessible label for the arrow. */
  label?: string;
}

/**
 * Context-aware in-app back arrow (the ‹ at a screen's top-left).
 *
 * The same screen is reachable from several places — e.g. the Service
 * Sheet is reached from the job detail OR straight from a dashboard row,
 * and the job detail is reached from a site, the jobs list OR a dashboard
 * row. A hardcoded back arrow always returns to ONE of those parents,
 * stranding everyone who arrived from elsewhere.
 *
 * Instead: if there's real in-app history (we navigated here within the
 * session), go back to wherever the user actually came from via
 * `router.back()`. Only when there's no history — a fresh-tab deep link —
 * fall back to the canonical parent (`fallbackHref`).
 *
 *   job detail → sheet → ‹ → job detail   (history → back)   ✓ unchanged
 *   dashboard  → sheet → ‹ → dashboard     (history → back)   ✓ fixed
 *   open sheet URL cold → ‹ → job detail   (no history → fallback)
 *
 * Heuristic: `window.history.length > 1` means we arrived here from
 * somewhere in the session. For this auth-gated internal app the previous
 * entry is effectively always in-app (login → dashboard → …), so
 * `router.back()` is safe; the fallback covers the cold-load case. This
 * does NOT affect the browser's own Back button, which continues to walk
 * the real history (e.g. back to the dashboard) as before.
 */
export function SmartBackButton({
  fallbackHref,
  className,
  label = "Back",
}: SmartBackButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <button type="button" onClick={handleBack} aria-label={label} className={className}>
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
      </svg>
    </button>
  );
}
