"use client";

/**
 * `useOnline` — reactive boolean for the browser's online/offline state.
 *
 * Returns `true` if the browser believes it has a usable network
 * connection, `false` otherwise. Subscribes to `online` + `offline`
 * window events so any component using the hook re-renders the instant
 * the connectivity flips — no polling, no per-tick check.
 *
 * Why a dedicated hook
 * --------------------
 * Three call-sites already read `navigator.onLine` privately:
 *
 *   - `lib/sync/engine.ts`        (sync trigger gate)
 *   - `lib/actions/wrap.ts`       (dispatch gate inside the wrapper)
 *   - `components/sync/sync-boot.tsx` (initial-sync disconnect path)
 *
 * Each is its own one-shot read — fine for those imperative contexts.
 * UI components need REACTIVE awareness: a button has to disable the
 * moment connectivity drops, not just at mount time. Hence this hook.
 *
 * The three existing call-sites stay imperative; this hook coexists.
 *
 * SSR-safety
 * ----------
 * `navigator` doesn't exist during server rendering. The initial value
 * defaults to `true` (the more permissive bias — buttons are enabled by
 * default on first paint, then quickly switch off if the device really
 * is offline). The wire-up runs only in a `useEffect`, so SSR can't
 * trip on the event listener calls.
 */

import { useEffect, useState } from "react";

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    // Initial render: in SSR there's no navigator → assume online.
    // First useEffect tick corrects this against the real value before
    // any meaningful user interaction.
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    // Re-sync once on mount in case `navigator.onLine` flipped
    // between SSR-rendered HTML and hydration. This is rare but real
    // on slow networks — e.g. the operator's wi-fi dropped during
    // the document download.
    setOnline(navigator.onLine);

    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
