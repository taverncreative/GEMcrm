"use client";

/**
 * Push loop — drains the local outbox by re-invoking server actions.
 *
 * Called by the engine's `runSync()` orchestrator. Returns when:
 *   - the outbox is empty (or has no eligible entries), or
 *   - a halting failure (auth-expired) interrupts the drain.
 *
 * Per-entry policy:
 *
 *   ok            → delete the entry (the server has the change)
 *   client-error  → record last_error, increment attempts. If attempts
 *                   ≥ 5, mark `stuck: true` — the entry stays in the
 *                   outbox and surfaces in the conflict inbox. The
 *                   automatic loop doesn't touch it again.
 *   auth-expired  → record last_error, do NOT increment attempts (this
 *                   wasn't the entry's fault), bubble up to the engine
 *                   which halts the whole run.
 *   server-error  → record last_error, increment attempts, schedule
 *                   next_attempt_at via exponential backoff. Stays in
 *                   the queue; loop picks it up next round.
 *   network       → same as server-error.
 *
 * UnknownActionError (no registry entry for action_name) is treated as
 * an immediate "stuck" — no point retrying something we have no
 * implementation for. last_error captures the missing name so the
 * inbox can show "Add to lib/sync/registry.ts and retry".
 *
 * Eligibility filter: `next_attempt_at <= now AND stuck === false`.
 * Dexie's compound index on (next_attempt_at) drives this; stuck is
 * checked in JS after the index range query because Dexie's index
 * combinators don't compose nicely for "indexed range + scalar match".
 * At GEM's scale the outbox will rarely hold more than a handful of
 * eligible entries at a time — the difference is academic.
 */

import { db } from "@/lib/db";
import { invokeFromRegistry, UnknownActionError } from "@/lib/sync/registry";
import {
  classifyError,
  classifyActionResult,
  isHaltingFailure,
  type SyncResultClass,
} from "@/lib/sync/http-classify";
import { nextAttemptAt } from "@/lib/sync/backoff";

/** Threshold of consecutive client-error attempts before an entry is
 *  marked stuck. Picked to be high enough to ride out transient bugs
 *  fixed by a deploy, low enough that a real bug surfaces within an
 *  hour of activity. */
const STUCK_THRESHOLD = 5;

export interface PushResult {
  attempted: number;
  succeeded: number;
  failed: number;
  marked_stuck: number;
  halted: boolean;
  halt_reason?: string;
}

/**
 * One full pass over eligible outbox entries. Returns aggregated stats
 * for the engine + status indicator.
 *
 * Single-pass — does not re-poll the outbox after success. New entries
 * enqueued during the drain wait for the next `runSync()` tick. This
 * keeps a single push call bounded in time; the trigger layer fires
 * runs every 30s + on online/focus, so there's no realistic backlog
 * scenario where a 30s gap matters.
 */
export async function drainOutbox(): Promise<PushResult> {
  const now = new Date().toISOString();
  const eligible = (
    await db.outbox
      .where("next_attempt_at")
      .belowOrEqual(now)
      .sortBy("created_at")
  ).filter((e) => !e.stuck);

  const result: PushResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    marked_stuck: 0,
    halted: false,
  };

  for (const entry of eligible) {
    result.attempted++;
    let outcome: SyncResultClass;

    try {
      const res = await invokeFromRegistry(entry);
      outcome = classifyActionResult(res);
    } catch (err) {
      if (err instanceof UnknownActionError) {
        // No registry entry — never going to succeed. Mark stuck
        // immediately rather than burning through 5 retries.
        await markStuck(entry.id!, err.message);
        result.marked_stuck++;
        continue;
      }
      outcome = classifyError(err);
    }

    if (outcome.kind === "ok") {
      await db.outbox.delete(entry.id!);
      result.succeeded++;
      continue;
    }

    if (isHaltingFailure(outcome)) {
      // Auth expiry: record the error on this entry (so the inbox
      // shows what happened) WITHOUT bumping attempts (it wasn't the
      // entry's fault), and bail out so the rest of the queue stays
      // intact for after re-login.
      await db.outbox.update(entry.id!, { last_error: outcome.message });
      result.halted = true;
      result.halt_reason = outcome.message;
      return result;
    }

    // client-error / server-error / network → bump + backoff
    result.failed++;
    const newAttempts = entry.attempts + 1;
    const shouldStick =
      outcome.kind === "client-error" && newAttempts >= STUCK_THRESHOLD;

    if (shouldStick) {
      await markStuck(entry.id!, outcome.message);
      result.marked_stuck++;
    } else {
      await db.outbox.update(entry.id!, {
        attempts: newAttempts,
        last_error: outcome.message,
        next_attempt_at: nextAttemptAt(newAttempts),
      });
    }
  }

  return result;
}

/** Flip the stuck flag on a specific entry. Exposed so the conflict-
 *  inbox "Retry" path can also use it (in reverse — see retryStuck). */
async function markStuck(entryId: number, lastError: string): Promise<void> {
  await db.outbox.update(entryId, {
    stuck: true,
    last_error: lastError,
  });
}

/**
 * Reset an entry to eligible state. Called by the conflict inbox
 * "Retry" button after the operator has fixed whatever was wrong.
 */
export async function unstickEntry(entryId: number): Promise<void> {
  await db.outbox.update(entryId, {
    stuck: false,
    attempts: 0,
    last_error: null,
    next_attempt_at: new Date().toISOString(),
  });
}
