"use client";

import { useEffect, useState } from "react";

/**
 * Reactive `navigator.onLine` value.
 *
 * Subscribes to the browser's `online` / `offline` events so any
 * component reading this re-renders when the connection drops or
 * returns. SSR defaults to `true` (assume online) to avoid
 * hydration flicker — a brief "online → offline" flash post-mount
 * is fine; the reverse would be jarring.
 *
 * Note: `navigator.onLine` is only a *negative* signal you can trust.
 * `true` from it means "the OS thinks there's a network adapter
 * connected", not "we can actually reach the server" — captive portals,
 * carrier outages, and DNS issues all return `true` here. The sync
 * engine still has to handle fetch failures as if it might be offline
 * even when this hook says online.
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
