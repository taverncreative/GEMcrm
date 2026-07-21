/**
 * Block-out days — Dexie mirror via the sync pull (migration 046).
 *
 * The calendar is server-rendered, but Slice 2's offline booking warning
 * reads block-out periods from Dexie. That mirror is populated by the pull
 * engine's `mergeRows`. These tests pin, against the fake-indexeddb harness,
 * that:
 *
 *   1. server rows land in `db.blocked_periods` (the mirror is populated);
 *   2. a soft-deleted server row mirrors through with `deleted_at` set (so a
 *      local read can hide it, mirroring the SELECT RLS) — this is what makes
 *      "deleted on device A → gone on device B" work;
 *   3. the outbox guard protects an offline-created block from being
 *      clobbered by a mid-flight pull.
 *
 * Exercises `mergeRows` (exported for exactly this) with the real Dexie
 * `blocked_periods` table added in the v5 schema bump.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Table } from "dexie";
import { db } from "@/lib/db";
import { mergeRows } from "@/lib/sync/pull";
import type { BlockedPeriod } from "@/types/database";

const blocks = () =>
  db.blocked_periods as unknown as Table<
    { id: string; updated_at: string } & Partial<BlockedPeriod>,
    string
  >;

function serverRow(over: Partial<BlockedPeriod> & { id: string }): BlockedPeriod {
  return {
    id: over.id,
    created_at: over.created_at ?? "2026-07-01T00:00:00.000Z",
    updated_at: over.updated_at ?? "2026-07-01T00:00:00.000Z",
    deleted_at: over.deleted_at ?? null,
    start_date: over.start_date ?? "2026-07-21",
    end_date: over.end_date ?? "2026-07-21",
    title: over.title ?? "Day off",
    created_by: over.created_by ?? null,
  };
}

beforeEach(async () => {
  await db.blocked_periods.clear();
  await db.outbox.clear();
});

describe("blocked_periods — pull mirror into Dexie", () => {
  it("merges server rows into the local store (mirror populated)", async () => {
    const res = await mergeRows(
      [
        serverRow({ id: "b1", title: "Fishing at Bewl Water" }),
        serverRow({
          id: "b2",
          title: "Benidorm holiday",
          start_date: "2026-08-03",
          end_date: "2026-08-07",
        }),
      ],
      blocks()
    );

    expect(res.merged).toBe(2);
    const stored = await db.blocked_periods.toArray();
    expect(stored.map((r) => r.id).sort()).toEqual(["b1", "b2"]);
    const b2 = await db.blocked_periods.get("b2");
    expect(b2?.title).toBe("Benidorm holiday");
    expect(b2?.end_date).toBe("2026-08-07");
  });

  it("mirrors a soft-deleted server row (deleted_at flows through)", async () => {
    await blocks().put(serverRow({ id: "b1", title: "Was off" }));

    await mergeRows(
      [
        serverRow({
          id: "b1",
          title: "Was off",
          deleted_at: "2026-07-10T00:00:00.000Z",
          updated_at: "2026-07-10T00:00:00.000Z",
        }),
      ],
      blocks()
    );

    const row = await db.blocked_periods.get("b1");
    expect(row?.deleted_at).toBe("2026-07-10T00:00:00.000Z");
    // A local "hide soft-deleted" read (what the booking warning does) drops it.
    const live = (await db.blocked_periods.toArray()).filter(
      (r) => !r.deleted_at
    );
    expect(live).toHaveLength(0);
  });

  it("outbox guard: an offline-created block isn't clobbered by a mid-flight pull", async () => {
    // Local optimistic create, not yet synced.
    await blocks().put(
      serverRow({
        id: "local-1",
        title: "Local reason",
        updated_at: "2026-07-01T00:00:00.000Z",
      })
    );
    const now = new Date().toISOString();
    await db.outbox.add({
      action_name: "saveBlockedPeriodAction",
      args: {},
      entity_type: "blocked_period",
      entity_id: "local-1",
      created_at: now,
      attempts: 0,
      last_error: null,
      next_attempt_at: now,
      stuck: false,
      op: "create",
      entity_ids: ["local-1"],
    });

    const res = await mergeRows(
      [
        serverRow({
          id: "local-1",
          title: "Server would clobber",
          updated_at: "2026-09-01T00:00:00.000Z",
        }),
      ],
      blocks()
    );

    expect(res.skipped).toBe(1);
    expect(res.merged).toBe(0);
    expect((await db.blocked_periods.get("local-1"))?.title).toBe(
      "Local reason"
    );
  });
});
