"use client";

import { useEffect, useState } from "react";

/** Matches the Tailwind `md` breakpoint (`min-width: 768px`). Anything
 *  below = phone, anything at-or-above = desktop / tablet-landscape. */
const MOBILE_QUERY = "(max-width: 767px)";

/**
 * Returns `true` when the viewport is narrower than the Tailwind `md`
 * breakpoint. SSR defaults to `false` (assume desktop) and is corrected
 * post-mount — matches the hydration-safe pattern used elsewhere in
 * the dashboard.
 *
 * Subscribes to media-query changes so DevTools device-toggling and live
 * resizes are picked up without a refresh.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return isMobile;
}
