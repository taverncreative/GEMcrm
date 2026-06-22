"use client";

/**
 * Sync orchestrator — mounted globally inside the (app) shell.
 *
 * Responsibilities:
 *
 *   1. **User-change detection.** Reads sync_meta.current_user_id and
 *      compares to the currently signed-in user. On mismatch, wipes
 *      the local DB before initial sync (prevents data leaking between
 *      users on a shared device).
 *
 *   2. **Initial sync gate.** If no cursors exist yet (fresh install
 *      or post-wipe), runs a full pull while showing
 *      `<InitialSyncScreen>` as a blocking overlay. Per-entity
 *      progress is surfaced through the screen. Mid-pull disconnect
 *      is detected via `navigator.onLine` event and surfaces a
 *      "Connection lost — resume when online" state with manual retry.
 *
 *   3. **Trigger wireups.** Once ready, attaches:
 *      - `online` event → runSync('online')
 *      - `visibilitychange` (visible) → runSync('focus')
 *      - 30s `setInterval` while visible → runSync('interval')
 *      - mount → runSync('mount')
 *
 *   4. **Auth-expired auto-clear.** If the boot sequence proceeds
 *      with a valid user_id but `status.authExpired` is true, that
 *      means the operator just signed back in — clear the flag.
 *
 * Mounted from `AppShell` with `userId` passed down from the server
 * layout (which already does `requireUser()`).
 */

import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import { wipeLocalDb } from "@/lib/db/dev";
import { pullAll, type PullProgress } from "@/lib/sync/pull";
import { runSync } from "@/lib/sync/engine";
import { clearAuthExpired, getSyncStatus } from "@/lib/sync/status";
import {
  InitialSyncScreen,
  type InitialProgressState,
  type EntityName,
} from "@/components/sync/initial-sync-screen";

const USER_ID_KEY = "current_user_id";

/**
 * Maximum time the boot effect is allowed to remain in a non-terminal
 * state (checking / wiping / initial) before the watchdog forces a
 * visible error so the operator can retry. 15s is a deliberately
 * generous ceiling — a real initial sync on a slow line typically
 * lands well inside this. A hung Dexie open (e.g. blocked-upgrade
 * the singleton's `blocked` event missed) or a wedged server-action
 * call will trip the timer; any normal flow completes long before.
 *
 * Tighten if operators report needing slow-network leeway during the
 * INITIAL pull — but only after auditing pullAll's own timeouts.
 */
const BOOT_TIMEOUT_MS = 15_000;

/**
 * Grace window before the boot overlay is allowed to paint. On a warm
 * launch the app reaches `appReady` (boot done + hydrated + core tables
 * warm) in well under this, so the overlay never shows — the app just
 * appears. Only a genuinely-cold/slow launch blows past it, and only then
 * does the overlay paint and hold until ready. Keeps fast launches flash-
 * free without re-opening the dead window (the residual exposure is at most
 * this long, vs the multi-second window it replaces). 150–200ms is below a
 * deliberate post-launch tap.
 */
const GRACE_MS = 180;

/**
 * Hard ceiling on the post-ready "warm the core tables" read so the gate can
 * never hang on it. The DB is already open by this point (boot read
 * sync_meta), so the reads resolve in a tick on any real device; this only
 * exists so a pathological Dexie stall reveals the app (lists fall back to
 * their own loading/empty state) instead of wedging behind the overlay.
 */
const CORE_WARM_TIMEOUT_MS = 5_000;

function initialProgress(): InitialProgressState {
  return {
    customers: { state: "pending", count: 0 },
    sites: { state: "pending", count: 0 },
    jobs: { state: "pending", count: 0 },
    agreements: { state: "pending", count: 0 },
    tasks: { state: "pending", count: 0 },
  };
}

type BootState =
  | { kind: "checking" }
  | { kind: "wiping" }
  | { kind: "initial" }
  | { kind: "ready" };

export function SyncBoot({ userId }: { userId: string }) {
  const [bootState, setBootState] = useState<BootState>({ kind: "checking" });
  const [progress, setProgress] = useState<InitialProgressState>(
    initialProgress
  );
  const [disconnected, setDisconnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Retry token forces the boot effect to re-run.
  const [retryToken, setRetryToken] = useState(0);

  // ─── appReady: don't reveal the app until it GENUINELY works ──────
  //
  // The old gate lifted the overlay the moment boot reached "ready"
  // (a fast sync_meta cursor check) — but that was BEFORE the client
  // had finished hydrating the heavy shell/page and BEFORE the
  // Dexie-backed lists had read their data. So the just-revealed app
  // had a dead window: taps on the jobs list hit an empty/loading list,
  // and the not-yet-wired "+" did nothing. `appReady` closes it: the
  // overlay lifts only when ALL three hold.
  //
  //   1. bootState === "ready"  (boot done: user checked, cursors /
  //      initial pull complete)
  //   2. `mounted`              (post-hydration beacon: effects run
  //      after the first commit, so this proves the client runtime is
  //      live)
  //   3. `coreTablesRead`       (the Dexie tables the landing lists
  //      join on — customers/sites/jobs — have been read, so the
  //      lists' useLiveQuery resolves with rows the instant the app
  //      is revealed, not a beat later)
  const [mounted, setMounted] = useState(false);
  const [coreTablesRead, setCoreTablesRead] = useState(false);
  // Grace gate: only paint the overlay once this is true (after GRACE_MS).
  const [graceElapsed, setGraceElapsed] = useState(false);

  const appReady =
    bootState.kind === "ready" && mounted && coreTablesRead;

  // Post-hydration beacon (#2). A bare mount effect — it can only run
  // once React has hydrated this tree, so it's our "client is live" signal.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Grace window. After GRACE_MS, allow the overlay to paint if we're
  // still not ready. Warm launches reach appReady first → overlay never
  // shows; cold/slow launches trip this → overlay shows and holds.
  useEffect(() => {
    const t = setTimeout(() => setGraceElapsed(true), GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  // Warm the core tables once boot is ready (#3). Reads the same tables
  // the landing lists join on so they resolve with rows on reveal. Capped
  // by CORE_WARM_TIMEOUT_MS and try/catch'd so it can NEVER wedge the gate:
  // a read failure or stall still flips coreTablesRead → the app reveals
  // and the lists surface their own loading/empty/error state.
  useEffect(() => {
    if (bootState.kind !== "ready") return;
    let cancelled = false;
    const warm = Promise.all([
      db.customers.toArray(),
      db.sites.toArray(),
      db.jobs.toArray(),
    ]).then(() => undefined);
    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, CORE_WARM_TIMEOUT_MS)
    );
    Promise.race([warm, timeout])
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCoreTablesRead(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bootState.kind, retryToken]);

  // ─── Boot sequence ──────────────────────────────────────────────
  //
  // Robustness invariant (post step-7 bugfix): boot MUST terminate
  // in finite time to one of {ready, visible error, disconnected}.
  // It must NEVER be possible to hang silently at "checking" — the
  // operator should always see either the app or an actionable
  // failure state with a retry button.
  //
  // Three guards that together enforce that invariant:
  //
  //   (a) Outer try/catch wraps the entire boot() body. Any throw
  //       before the inner pullAll try/catch (e.g. Dexie open
  //       blocked by another tab, sync_meta query throws,
  //       wipeLocalDb fails) now routes to setError(...) instead
  //       of leaving bootState at "checking" forever.
  //
  //   (b) A watchdog timer (BOOT_TIMEOUT_MS) flips bootState to
  //       an error state if boot hasn't reached ready/error within
  //       the limit. Catches "the await never resolves" cases that
  //       no try/catch can — IndexedDB upgrade blocked, a hung
  //       server-action call, network event that never fires.
  //
  //   (c) The Dexie singleton dispatches `gemcrm:db-blocked` when
  //       a schema upgrade is blocked by another tab at the old
  //       version. We listen and route to setError so the operator
  //       sees a "close other tabs and retry" message rather than
  //       waiting indefinitely.
  //
  // Each guard alone leaves a hole; together they close them all.
  useEffect(() => {
    let cancelled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    // Clear the watchdog once boot has reached a terminal state
    // (ready / error / disconnected). Without this the timer would
    // fire BOOT_TIMEOUT_MS later and overwrite the working app with
    // a misleading timeout error.
    function clearWatchdog() {
      if (watchdog !== null) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    }

    // (c) Dexie upgrade-blocked → visible error. Also a terminal
    // state for boot — clear the watchdog so we don't double-up
    // with a timeout message.
    function onBlocked() {
      if (cancelled) return;
      clearWatchdog();
      setError(
        "Schema upgrade blocked — another tab or window is still on the old version. Close other GEM CRM tabs and tap Retry."
      );
    }
    window.addEventListener("gemcrm:db-blocked", onBlocked);

    async function boot() {
      setBootState({ kind: "checking" });
      setError(null);
      setDisconnected(false);
      // A retry re-runs boot — re-warm the core tables before revealing.
      setCoreTablesRead(false);

      try {
        // 1. User-change detection
        const storedRow = await db.sync_meta.get(USER_ID_KEY);
        const previousUserId =
          typeof storedRow?.value === "string" ? storedRow.value : null;

        if (previousUserId && previousUserId !== userId) {
          setBootState({ kind: "wiping" });
          await wipeLocalDb();
        }

        // 2. Determine whether initial sync is needed.
        // Heuristic: any cursor present → initial sync done before.
        // After a wipe, no cursors exist.
        const anyCursor = await db.sync_meta
          .where("key")
          .startsWith("cursor.")
          .count();

        const needsInitial = anyCursor === 0;

        // Write user_id now so even if the user closes the tab
        // mid-sync, a re-mount won't re-wipe.
        await db.sync_meta.put({ key: USER_ID_KEY, value: userId });

        // 3. Auto-clear authExpired now that we're booted with a
        // fresh session.
        if (getSyncStatus().authExpired) {
          clearAuthExpired();
        }

        if (cancelled) return;

        if (needsInitial) {
          setBootState({ kind: "initial" });
          setProgress(initialProgress());

          const onProgress: PullProgress = (entity, state, count) => {
            if (cancelled) return;
            setProgress((p) => ({
              ...p,
              [entity as EntityName]: { state, count },
            }));
          };

          try {
            if (!navigator.onLine) {
              clearWatchdog();
              setDisconnected(true);
              return;
            }
            const result = await pullAll(onProgress);
            if (cancelled) return;
            if (result.halted) {
              clearWatchdog();
              setError(result.halt_reason ?? "Sync halted");
              return;
            }
            const firstErr = result.entities.find((e) => e.error);
            if (firstErr?.error) {
              console.warn(
                `[sync-boot] initial pull partial: ${firstErr.entity} errored`,
                firstErr.error
              );
            }
            clearWatchdog();
            setBootState({ kind: "ready" });
          } catch (err) {
            if (cancelled) return;
            if (!navigator.onLine) {
              clearWatchdog();
              setDisconnected(true);
              return;
            }
            clearWatchdog();
            setError(
              err instanceof Error ? err.message : "Unknown sync error"
            );
          }
        } else {
          // 4. Steady state: skip the screen entirely.
          clearWatchdog();
          setBootState({ kind: "ready" });
        }
      } catch (err) {
        // (a) Anything that escaped from the user-detection / cursor
        // probe / put / wipe path. Most likely: Dexie blocked, IDB
        // corruption, or storage quota. Route to visible error.
        if (cancelled) return;
        console.error("[sync-boot] boot failed before pullAll:", err);
        clearWatchdog();
        setError(
          err instanceof Error
            ? `Local store unavailable: ${err.message}`
            : "Local store unavailable"
        );
      }
    }

    // (b) Watchdog. If boot() hasn't pushed us out of "checking" within
    // BOOT_TIMEOUT_MS, force a visible error. The operator can tap
    // Retry; if the underlying cause cleared (other tab closed, hung
    // network recovered), the retry will succeed. If it didn't, we're
    // no worse off than the silent hang we replaced.
    //
    // The cancelled flag prevents the timer from firing after cleanup
    // or after boot has resolved (the cleanup function clears it
    // explicitly, but the cancelled check is defence-in-depth in
    // case React batches the clearTimeout against a fired timer).
    //
    // We use the functional form of setError so a previously-set
    // error (e.g. a more specific pullAll error that ran in parallel)
    // isn't overwritten with our generic timeout message.
    watchdog = setTimeout(() => {
      if (cancelled) return;
      setError(
        (prev) =>
          prev ??
          "Sync took too long. Close other GEM CRM tabs/windows and tap Retry."
      );
    }, BOOT_TIMEOUT_MS);

    boot();

    return () => {
      cancelled = true;
      clearWatchdog();
      window.removeEventListener("gemcrm:db-blocked", onBlocked);
    };
  }, [userId, retryToken]);

  // ─── Trigger wireups — only after ready ─────────────────────────
  const triggersMounted = useRef(false);
  useEffect(() => {
    if (bootState.kind !== "ready") return;
    if (triggersMounted.current) return;
    triggersMounted.current = true;

    // Fire one sync immediately on mount-to-ready.
    void runSync("mount");

    // `online` event
    const onOnline = () => void runSync("online");
    window.addEventListener("online", onOnline);

    // App-requested sync — fired by the local-first wrapper right after an
    // optimistic write (window.dispatchEvent("gemcrm:request-sync")) so the
    // booking reaches the server immediately when online, without the wrapper
    // importing runSync (which would create a wrap→engine→push→registry
    // cycle). Offline it no-ops / backs off like any other trigger.
    const onRequestSync = () => void runSync("manual");
    window.addEventListener("gemcrm:request-sync", onRequestSync);

    // `visibilitychange` — fire on becoming visible AND control the
    // background interval.
    let interval: ReturnType<typeof setInterval> | null = null;
    function startInterval() {
      if (interval !== null) return;
      interval = setInterval(() => void runSync("interval"), 30_000);
    }
    function stopInterval() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void runSync("focus");
        startInterval();
      } else {
        stopInterval();
      }
    };
    if (document.visibilityState === "visible") startInterval();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("gemcrm:request-sync", onRequestSync);
      document.removeEventListener("visibilitychange", onVisibility);
      stopInterval();
      triggersMounted.current = false;
    };
  }, [bootState.kind]);

  // ─── Watch for disconnect during initial sync ────────────────────
  useEffect(() => {
    if (bootState.kind !== "initial") return;
    const onOffline = () => setDisconnected(true);
    window.addEventListener("offline", onOffline);
    return () => window.removeEventListener("offline", onOffline);
  }, [bootState.kind]);

  // ─── Render gating ───────────────────────────────────────────────
  //
  // If boot completed, render nothing — the app shell is the only
  // thing on screen.
  //
  // Otherwise show the overlay with the live error/disconnected
  // signals. CRITICAL: `error` is passed through regardless of which
  // boot phase we're in. The old code hardcoded `error={null}` while
  // bootState was "checking"/"wiping", which meant the watchdog
  // timer's setError(...) couldn't surface anything to the operator
  // until boot had at least advanced to "initial" — exactly the
  // wrong contract when a hang happens BEFORE that phase. Now any
  // error (Dexie blocked, watchdog trip, sync_meta probe throw)
  // shows immediately in the InitialSyncScreen with its retry
  // button.
  // Reveal the app only when it genuinely works (boot done + hydrated +
  // core tables warm).
  if (appReady) return null;
  // Grace window: for the first GRACE_MS, don't paint the overlay — a warm
  // launch reaches appReady inside this and reveals the app with no flash.
  // An error/disconnect is surfaced immediately (it shouldn't wait out the
  // grace), as is an in-progress initial/wiping sync (those are genuine
  // not-ready states we want to show progress for).
  const inProgress =
    bootState.kind === "initial" || bootState.kind === "wiping";
  if (!graceElapsed && !error && !disconnected && !inProgress) return null;
  return (
    <InitialSyncScreen
      progress={progress}
      disconnected={disconnected}
      error={error}
      onRetry={() => setRetryToken((t) => t + 1)}
    />
  );
}
