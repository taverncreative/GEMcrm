"use client";

/**
 * Sync engine — top-level orchestrator.
 *
 * `runSync(reason)` is the single entry point. Wired to four triggers
 * by `<SyncTriggers>` (commit 8): online, focus, interval, manual.
 * Also called from the post-login hook to drain anything queued
 * during a previous offline session.
 *
 * Pipeline:
 *
 *   1. Guard: if `navigator.onLine === false` → no-op, return.
 *   2. Guard: if a previous run is still in progress → no-op.
 *      (`getSyncStatus().syncing` is the single source of truth.)
 *   3. status: syncStarted(reason).
 *   4. drainOutbox() — push first so the upcoming pull doesn't
 *      overwrite anything we're about to push.
 *   5. If push halted (auth-expired) → status: syncFailed("auth"),
 *      do NOT continue. Pull / photos would re-encounter the same
 *      401 anyway.
 *   6. pullAll() — fetch server changes since per-entity cursors.
 *   7. If pull halted (auth-expired) → status: syncFailed("auth"),
 *      stop. Photos won't have any chance against the same auth.
 *   8. Fire-and-forget the photo loop (`drainPhotos`, commit 4b).
 *      Photos sync in parallel with whatever the user does next.
 *   9. status: syncFinished().
 *
 * The pipeline is "best-effort" — a non-auth failure in any loop
 * surfaces via the loop's own error reporting (entries stay in the
 * queue with bumped attempts, photos same). The status indicator
 * shows "Synced X minutes ago" once the run completes, even if some
 * individual entries didn't make it through (they'll retry next round).
 */

import { drainOutbox, type PushResult } from "@/lib/sync/push";
import { pullAll, type PullResult } from "@/lib/sync/pull";
import { drainPhotos } from "@/lib/sync/photos";
import {
  syncStarted,
  syncFinished,
  syncFailed,
  getSyncStatus,
  type SyncReason,
} from "@/lib/sync/status";

export interface SyncRunResult {
  ran: boolean;
  reason: SyncReason;
  skipped_reason?: "offline" | "already-syncing";
  push?: PushResult;
  pull?: PullResult;
  duration_ms?: number;
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/**
 * One-shot clock-skew sanity check. Fires on the first successful
 * sync of a session — logs a console warning if the client and server
 * are >5 minutes apart. We don't auto-correct because Date.now() can't
 * be safely shifted; and >5min skew is unusual enough that surfacing
 * to logs is the right level of escalation.
 *
 * The skew matters because `updated_at` comparisons in pull merge use
 * server-provided timestamps but the outbox uses client-side ones. A
 * large skew can produce confusing LWW outcomes.
 */
let clockSkewChecked = false;
async function checkClockSkewOnce(): Promise<void> {
  if (clockSkewChecked) return;
  clockSkewChecked = true;
  try {
    // Hit our own origin's root with HEAD — fast, no auth dependency,
    // and the Date header is always present.
    const res = await fetch("/", { method: "HEAD", cache: "no-store" });
    const serverDate = res.headers.get("Date");
    if (!serverDate) return;
    const serverMs = new Date(serverDate).getTime();
    if (!Number.isFinite(serverMs)) return;
    const skewMs = Math.abs(Date.now() - serverMs);
    if (skewMs > 5 * 60 * 1000) {
      console.warn(
        `[sync] clock skew ${(skewMs / 1000).toFixed(0)}s detected ` +
          `between client (${new Date().toISOString()}) and server ` +
          `(${new Date(serverMs).toISOString()}). Sync ordering may ` +
          `produce confusing LWW outcomes. Check the device's clock.`
      );
    }
  } catch {
    // Network failure — not worth retrying or surfacing; clock skew
    // check is best-effort diagnostics.
  }
}

/**
 * Run one sync pass. Safe to call from any trigger — guards prevent
 * concurrent runs and offline no-ops.
 */
export async function runSync(reason: SyncReason): Promise<SyncRunResult> {
  if (!isOnline()) {
    return { ran: false, reason, skipped_reason: "offline" };
  }
  if (getSyncStatus().syncing) {
    return { ran: false, reason, skipped_reason: "already-syncing" };
  }

  const startMs = Date.now();
  syncStarted(reason);

  // 1. Push. Halt if auth-expired.
  let push: PushResult;
  try {
    push = await drainOutbox();
  } catch (err) {
    // The drain shouldn't really throw — push wraps each entry in its
    // own try/catch. Defensive: any thrown error halts as 'other'.
    const message =
      err instanceof Error ? err.message : "Unknown push error";
    syncFailed(message, "other");
    return {
      ran: true,
      reason,
      duration_ms: Date.now() - startMs,
    };
  }
  if (push.halted) {
    syncFailed(push.halt_reason ?? "Auth expired during push", "auth");
    return { ran: true, reason, push, duration_ms: Date.now() - startMs };
  }

  // 2. Pull. Halt if auth-expired.
  let pull: PullResult;
  try {
    pull = await pullAll();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown pull error";
    syncFailed(message, "other");
    return {
      ran: true,
      reason,
      push,
      duration_ms: Date.now() - startMs,
    };
  }
  if (pull.halted) {
    syncFailed(pull.halt_reason ?? "Auth expired during pull", "auth");
    return {
      ran: true,
      reason,
      push,
      pull,
      duration_ms: Date.now() - startMs,
    };
  }

  // 3. Photos — fire-and-forget. Photos may take a while on slow
  //    connections; we don't block the engine on them. They run in
  //    parallel with the next user action. Static import of the
  //    photos module (currently a no-op stub; real implementation
  //    lands in commit 4b).
  void drainPhotos().catch((err) => {
    // Photo failures are non-halting and self-recording — log only.
    console.warn("[runSync] photo drain failed:", err);
  });

  syncFinished();
  // Fire-and-forget skew check once per session. Doesn't affect the
  // sync outcome; just diagnostic logging.
  void checkClockSkewOnce();
  return {
    ran: true,
    reason,
    push,
    pull,
    duration_ms: Date.now() - startMs,
  };
}
