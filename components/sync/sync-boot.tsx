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

  // ─── Boot sequence ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setBootState({ kind: "checking" });
      setError(null);
      setDisconnected(false);

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

      // Write user_id now so even if the user closes the tab mid-sync,
      // a re-mount won't re-wipe. (Initial sync may still need to run
      // — heuristic is cursor presence, not user_id presence.)
      await db.sync_meta.put({ key: USER_ID_KEY, value: userId });

      // 3. Auto-clear authExpired now that we're booted with a fresh
      //    session. This is the "post-login auto-retry" hook (edge
      //    case 12) — after re-login, the user lands back on /(app)/*,
      //    SyncBoot mounts, clears the flag, and triggers a sync.
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
            setDisconnected(true);
            return;
          }
          const result = await pullAll(onProgress);
          if (cancelled) return;
          if (result.halted) {
            setError(result.halt_reason ?? "Sync halted");
            return;
          }
          // Detect any per-entity errors — surface but allow proceed
          // because some data is better than no data. The next normal
          // sync tick will retry the failed entities.
          const firstErr = result.entities.find((e) => e.error);
          if (firstErr?.error) {
            console.warn(
              `[sync-boot] initial pull partial: ${firstErr.entity} errored`,
              firstErr.error
            );
          }
          setBootState({ kind: "ready" });
        } catch (err) {
          if (cancelled) return;
          if (!navigator.onLine) {
            setDisconnected(true);
            return;
          }
          setError(
            err instanceof Error ? err.message : "Unknown sync error"
          );
        }
      } else {
        // 4. Steady state: skip the screen entirely.
        setBootState({ kind: "ready" });
      }
    }

    boot();
    return () => {
      cancelled = true;
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
  if (bootState.kind === "ready") return null;
  if (bootState.kind === "checking" || bootState.kind === "wiping") {
    // Brief flash; keep the screen consistent with the initial-sync
    // overlay so there's no layout shift.
    return (
      <InitialSyncScreen
        progress={progress}
        disconnected={false}
        error={null}
        onRetry={() => setRetryToken((t) => t + 1)}
      />
    );
  }
  return (
    <InitialSyncScreen
      progress={progress}
      disconnected={disconnected}
      error={error}
      onRetry={() => setRetryToken((t) => t + 1)}
    />
  );
}
