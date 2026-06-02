"use client";

/**
 * Sync status pub-sub.
 *
 * Mirrors the Set<listener> pattern used by `components/dashboard/widget-frame.tsx`
 * (useWidgetStore). No external state-management dependency — the
 * project already proves this shape works for cross-component reactive
 * state at its complexity level.
 *
 * Consumers:
 *   - `<SyncStatusIndicator>` in the header chip
 *   - `<SessionExpiredBanner>` (mounted globally; visible when authExpired)
 *   - `<SyncTriggers>` (writes; also subscribes to read `syncing` to
 *     avoid concurrent runs)
 *   - `/sync/conflicts` page (reads stuckCount via a separate Dexie
 *     useLiveQuery — not surfaced here)
 *
 * Writes go through the exported setters. The push/pull/photo loops
 * call these as they progress.
 */

import { useEffect, useState } from "react";

export type SyncReason = "online" | "focus" | "interval" | "manual" | "mount";

export interface SyncStatus {
  /** A run is in progress. New triggers should bail rather than overlap. */
  syncing: boolean;
  /** ISO timestamp of the last successful sync completion. Null until
   *  the first successful run. Drives the "Synced X minutes ago" copy. */
  lastSyncAt: string | null;
  /** ISO timestamp the current run started. Null when idle. Used by
   *  the indicator to show progress and by the watchdog to detect a
   *  stalled run. */
  currentRunStartedAt: string | null;
  /** Last halting error message — auth expiry sets this and bails. The
   *  banner displays it; manual re-sync clears. */
  lastError: string | null;
  /** True if the most recent halt was a 401/403. Surfaces the
   *  "Session expired — sign in to continue syncing" banner. */
  authExpired: boolean;
  /**
   * Did the most recent sync attempt actually reach the server?
   *
   *   null   — no attempt has run yet (cold boot, pre-first-sync).
   *   true   — last attempt completed without a network/server error.
   *   false  — last attempt failed with a non-auth error (network
   *            timeout, fetch threw, 5xx, etc).
   *
   * Required because `navigator.onLine` is an unreliable POSITIVE
   * signal: on macOS with Wi-Fi off the loopback adapter keeps
   * `navigator.onLine === true`, and captive portals / "connected but
   * no internet" return true too. This field is the empirical
   * counterpart — the engine actually attempted a fetch and recorded
   * the outcome.
   *
   * Auth failures (401/403) leave this `true` because we DID reach
   * the server (it just rejected the session). The "session expired"
   * banner is the right surface for that case; the offline pill +
   * write guards must remain disengaged so the operator sees the
   * sign-in prompt.
   *
   * Effective-online consumers (`useIsOnline`, SyncStatePill, write
   * guards) combine this with `navigator.onLine`:
   *
   *     effective_online =
   *       navigator.onLine !== false &&
   *       status.serverReachable !== false
   *
   * A single transient failure flips this immediately to `false`.
   * The next successful attempt flips it back to `true`. We don't
   * hysteresis-guard the flip (per the operator's "don't
   * over-engineer this" note) — recovery on the next success is
   * sufficient and the simpler model is easier to reason about.
   */
  serverReachable: boolean | null;
  /** Most recent trigger reason. Surfaced in the status panel for
   *  diagnostic ("syncing — triggered by: online"). */
  lastReason: SyncReason | null;
}

const INITIAL: SyncStatus = {
  syncing: false,
  lastSyncAt: null,
  currentRunStartedAt: null,
  lastError: null,
  authExpired: false,
  serverReachable: null,
  lastReason: null,
};

let state: SyncStatus = INITIAL;
const LISTENERS = new Set<() => void>();

function notify() {
  for (const fn of LISTENERS) fn();
}

// ─── Writers ─────────────────────────────────────────────────────

export function syncStarted(reason: SyncReason): void {
  state = {
    ...state,
    syncing: true,
    currentRunStartedAt: new Date().toISOString(),
    lastReason: reason,
    // Clear stale error on a fresh attempt — a successful run will
    // leave it null; a new failure will overwrite it.
    lastError: null,
  };
  notify();
}

export function syncFinished(): void {
  state = {
    ...state,
    syncing: false,
    currentRunStartedAt: null,
    lastSyncAt: new Date().toISOString(),
    // We reached the server and got valid data back. Flip to true so
    // a previous "unreachable" state clears the moment connectivity
    // recovers. No hysteresis — the simplest model that works.
    serverReachable: true,
  };
  notify();
}

export function syncFailed(message: string, kind: "auth" | "other"): void {
  state = {
    ...state,
    syncing: false,
    currentRunStartedAt: null,
    lastError: message,
    authExpired: kind === "auth" ? true : state.authExpired,
    // Auth failures DID reach the server (it just rejected us). Don't
    // flip serverReachable in that case — the authExpired banner is
    // the right surface, and the offline pill / guards must stay
    // disengaged so the operator sees the sign-in prompt.
    serverReachable: kind === "auth" ? state.serverReachable : false,
  };
  notify();
}

/** Called after successful re-login or by a manual "dismiss" button. */
export function clearAuthExpired(): void {
  state = { ...state, authExpired: false, lastError: null };
  notify();
}

/** Read the current status without subscribing — for non-React code
 *  paths that need a peek (e.g. the engine's `isAlreadySyncing` guard). */
export function getSyncStatus(): SyncStatus {
  return state;
}

// ─── Hook ────────────────────────────────────────────────────────

/**
 * Subscribe a component to status updates. Returns the latest state on
 * every change. Same shape as `useWidgetStore` for consistency.
 */
export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState<SyncStatus>(state);
  useEffect(() => {
    const refresh = () => setS(state);
    LISTENERS.add(refresh);
    // In case state changed between render and effect mount.
    refresh();
    return () => {
      LISTENERS.delete(refresh);
    };
  }, []);
  return s;
}
