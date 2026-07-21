/**
 * Block-out days — data layer (migration 046).
 *
 * Three contracts pinned against an in-memory `blocked_periods` table:
 *
 *   1. getBlockedPeriodsInRange returns exactly the periods OVERLAPPING the
 *      grid window: start_date <= rangeEnd AND end_date >= rangeStart. A
 *      period wholly before or wholly after the window is excluded; one that
 *      merely straddles an edge is included.
 *
 *   2. saveBlockedPeriod upserts on `id` — a replayed save with the same id
 *      does not duplicate (offline-replay idempotency + doubles as the edit
 *      path); an omitted id mints a fresh one (plain insert).
 *
 *   3. deleteBlockedPeriod calls the soft_delete_blocked_period RPC (never a
 *      direct UPDATE, which would 42501 under the SELECT policy) and is
 *      idempotent.
 *
 * The supabase stub honours the exact chains the data layer uses:
 *   read:   select("*").lte().gte().order()          (builder is awaited)
 *   write:  upsert({...}, { onConflict:"id" }).select().single()
 *   delete: rpc("soft_delete_blocked_period", { p_id })
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

let rows: Row[] = [];
const rpcCalls: Array<{ name: string; args: unknown }> = [];

function makeQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  const orders: Array<{ col: string; ascending: boolean }> = [];
  let upserted: Row | null = null;

  const matched = () => {
    let out = rows.filter((r) => filters.every((f) => f(r)));
    for (const o of [...orders].reverse()) {
      out = [...out].sort((a, b) => {
        const av = a[o.col] as string;
        const bv = b[o.col] as string;
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return o.ascending ? cmp : -cmp;
      });
    }
    return out;
  };

  const builder = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    lte(col: string, val: unknown) {
      filters.push((r) => (r[col] as string) <= (val as string));
      return builder;
    },
    gte(col: string, val: unknown) {
      filters.push((r) => (r[col] as string) >= (val as string));
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orders.push({ col, ascending: opts?.ascending ?? true });
      return builder;
    },
    upsert(obj: Row) {
      const idx = rows.findIndex((r) => r.id === obj.id);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...obj };
        upserted = rows[idx];
      } else {
        rows.push({ ...obj });
        upserted = rows[rows.length - 1];
      }
      return builder;
    },
    async single() {
      return { data: upserted ? { ...upserted } : null, error: null };
    },
    // Read terminal: the data layer awaits the builder directly (no .limit()).
    then(resolve: (v: { data: Row[]; error: null }) => unknown) {
      return Promise.resolve({ data: matched(), error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => makeQuery(),
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "soft_delete_blocked_period") {
        const { p_id } = args as { p_id: string };
        const row = rows.find((r) => r.id === p_id && !r.deleted_at);
        if (row) row.deleted_at = "2026-07-21T00:00:00.000Z";
      }
      return { data: null, error: null };
    },
  }),
}));

import {
  getBlockedPeriodsInRange,
  saveBlockedPeriod,
  deleteBlockedPeriod,
} from "@/lib/data/blocked-periods";

beforeEach(() => {
  rows = [];
  rpcCalls.length = 0;
});

describe("getBlockedPeriodsInRange — overlap semantics", () => {
  beforeEach(() => {
    rows = [
      // wholly before the window
      { id: "before", start_date: "2026-06-01", end_date: "2026-06-03", title: "before" },
      // straddles the start edge
      { id: "straddle-start", start_date: "2026-06-28", end_date: "2026-07-02", title: "s1" },
      // fully inside
      { id: "inside", start_date: "2026-07-10", end_date: "2026-07-12", title: "in" },
      // straddles the end edge
      { id: "straddle-end", start_date: "2026-07-30", end_date: "2026-08-04", title: "s2" },
      // wholly after
      { id: "after", start_date: "2026-08-10", end_date: "2026-08-12", title: "after" },
    ];
  });

  it("includes only periods overlapping [2026-07-01, 2026-07-31]", async () => {
    const got = await getBlockedPeriodsInRange("2026-07-01", "2026-07-31");
    expect(got.map((r) => r.id).sort()).toEqual([
      "inside",
      "straddle-end",
      "straddle-start",
    ]);
  });

  it("returns them ordered by start_date ascending", async () => {
    const got = await getBlockedPeriodsInRange("2026-07-01", "2026-07-31");
    expect(got.map((r) => r.start_date)).toEqual([
      "2026-06-28",
      "2026-07-10",
      "2026-07-30",
    ]);
  });

  it("a single-day block on the window edge is included", async () => {
    rows = [{ id: "edge", start_date: "2026-07-31", end_date: "2026-07-31", title: "edge" }];
    const got = await getBlockedPeriodsInRange("2026-07-01", "2026-07-31");
    expect(got.map((r) => r.id)).toEqual(["edge"]);
  });
});

describe("saveBlockedPeriod — upsert-on-id", () => {
  it("a replayed save with the same id does NOT duplicate", async () => {
    const id = "client-id";
    await saveBlockedPeriod({ id, title: "Benidorm holiday", start_date: "2026-08-03", end_date: "2026-08-07" });
    expect(rows).toHaveLength(1);

    await saveBlockedPeriod({ id, title: "Benidorm holiday", start_date: "2026-08-03", end_date: "2026-08-07" });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].end_date).toBe("2026-08-07");
  });

  it("editing an existing id updates in place", async () => {
    const id = "edit-me";
    await saveBlockedPeriod({ id, title: "Fishing", start_date: "2026-07-21", end_date: "2026-07-21" });
    await saveBlockedPeriod({ id, title: "Fishing (moved)", start_date: "2026-07-22", end_date: "2026-07-23" });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Fishing (moved)");
    expect(rows[0].start_date).toBe("2026-07-22");
    expect(rows[0].end_date).toBe("2026-07-23");
  });

  it("an omitted id mints a fresh one (insert)", async () => {
    const a = await saveBlockedPeriod({ title: "A", start_date: "2026-07-21", end_date: "2026-07-21" });
    const b = await saveBlockedPeriod({ title: "B", start_date: "2026-07-22", end_date: "2026-07-22" });
    expect(rows).toHaveLength(2);
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });
});

describe("deleteBlockedPeriod — soft-delete via RPC", () => {
  it("calls the soft_delete_blocked_period RPC (not a direct update)", async () => {
    rows = [{ id: "d1", start_date: "2026-07-21", end_date: "2026-07-21", title: "off", deleted_at: null }];
    await deleteBlockedPeriod("d1");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("soft_delete_blocked_period");
    expect(rpcCalls[0].args).toEqual({ p_id: "d1" });
    expect(rows[0].deleted_at).toBeTruthy();
  });

  it("is idempotent — a second delete is a harmless no-op", async () => {
    rows = [{ id: "d1", start_date: "2026-07-21", end_date: "2026-07-21", title: "off", deleted_at: null }];
    await deleteBlockedPeriod("d1");
    const firstStamp = rows[0].deleted_at;
    await deleteBlockedPeriod("d1");
    expect(rows[0].deleted_at).toBe(firstStamp);
  });
});
