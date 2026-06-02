"use client";

import { useEffect, useState } from "react";
import { useSyncStatus } from "@/lib/sync/status";

/**
 * Effective online state.
 *
 * Combines two signals so any consumer (write guards, the sync pill,
 * the report-actions button, the in-page invoice button) gets a
 * reliable "should I act as if we can talk to the server" boolean:
 *
 *   1. `navigator.onLine` — a useful NEGATIVE signal. If the OS
 *      reports no network adapter, definitely offline. `online` /
 *      `offline` events fire here so React stays subscribed.
 *
 *   2. `status.serverReachable` — the engine's empirical outcome of
 *      the most recent sync attempt. False after a non-auth failure,
 *      true after success, null if no attempt has run yet.
 *
 * Effective predicate:
 *
 *     online =
 *       navigator.onLine !== false &&
 *       status.serverReachable !== false
 *
 * Why combine: `navigator.onLine === true` does NOT mean we can
 * actually reach the server. On macOS with Wi-Fi off, the loopback
 * adapter keeps it true. Captive portals and "connected but no
 * internet" do the same. The engine catches these by trying and
 * failing — that outcome flows in here via the sync status.
 *
 * Why a single hook (rather than e.g. `useReachability()` separate
 * from this): every existing call-site treats "offline" as a single
 * binary concept. Two boolean inputs collapse to one boolean output
 * here so consumers don't have to repeat the AND logic + keep them
 * consistent.
 *
 * SSR: defaults to `true` because navigator doesn't exist on the
 * server. The first useEffect tick syncs against the real values.
 */
export function useIsOnline(): boolean {
  const [navOnline, setNavOnline] = useState<boolean>(true);
  const status = useSyncStatus();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setNavOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // navigator.onLine === false definitively means offline. Otherwise
  // defer to the engine's last-attempt outcome. `null` (no attempt
  // yet) is treated as "online" — the optimistic default; the first
  // sync will correct this within a tick.
  if (navOnline === false) return false;
  if (status.serverReachable === false) return false;
  return true;
}
