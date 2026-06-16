/**
 * Outbox drain order is DETERMINISTIC FIFO by insertion — `created_at`
 * primary, the auto-increment `id` as a tiebreaker. This is what guarantees
 * an offline email capture (queued first → lower id) always replays BEFORE
 * the completion it belongs to, even when both land in the same millisecond.
 *
 * The entries here share an identical `created_at` but carry `next_attempt_at`
 * values in the REVERSE of insertion order (as a retried entry would). The
 * `next_attempt_at` index therefore yields them id-descending; only the
 * `(created_at, id)` sort restores true insertion order — so this test fails
 * without the tiebreaker.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const drainOrder: number[] = [];
vi.mock("@/lib/sync/registry", () => ({
  invokeFromRegistry: vi.fn(async (entry: { id: number }) => {
    drainOrder.push(entry.id);
    return { success: true };
  }),
  UnknownActionError: class UnknownActionError extends Error {},
}));

import { drainOutbox } from "@/lib/sync/push";
import { db } from "@/lib/db";

const CREATED = "2026-06-15T12:00:00.000Z"; // identical for every entry

async function addEntry(
  action_name: string,
  nextAttemptAt: string
): Promise<number> {
  return (await db.outbox.add({
    action_name,
    args: {},
    entity_type: "customer",
    entity_id: action_name,
    created_at: CREATED,
    attempts: 0,
    last_error: null,
    next_attempt_at: nextAttemptAt,
    stuck: false,
  })) as number;
}

beforeEach(async () => {
  drainOrder.length = 0;
  await db.outbox.clear();
  vi.clearAllMocks();
});

describe("drainOutbox — deterministic FIFO order", () => {
  it("identical created_at → drains in insertion (id) order, not index order", async () => {
    // Inserted first..third, but next_attempt_at is descending so the
    // next_attempt_at index would surface them third..first.
    const id1 = await addEntry("first", "2026-06-15T12:00:00.030Z");
    const id2 = await addEntry("second", "2026-06-15T12:00:00.020Z");
    const id3 = await addEntry("third", "2026-06-15T12:00:00.010Z");

    const res = await drainOutbox();
    expect(res.succeeded).toBe(3);
    // The auto-increment id pins the order to insertion, overriding both the
    // equal created_at and the scrambled next_attempt_at index.
    expect(drainOrder).toEqual([id1, id2, id3]);
    expect(await db.outbox.count()).toBe(0);
  });
});
