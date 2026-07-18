/**
 * feature_requests hard deletes — data layer.
 *
 * Unlike the five syncable tables there is no deleted_at and no
 * per-operation SELECT policy, so these are PLAIN deletes through the
 * authenticated server client (no SECURITY DEFINER RPC). The stub below
 * keeps an in-memory table and honours the two filter shapes the code
 * uses, so the assertions are about actual row removal:
 *
 *   - deleteFeatureRequest(id)  → .delete().eq("id", id)      — one row
 *   - clearFeatureRequests()    → .delete().not("id","is",null) — all rows
 *     (PostgREST refuses an unfiltered DELETE; `id not is null` is the
 *     match-everything filter, and `count: "exact"` reports how many went)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  message: string;
}

const { table } = vi.hoisted(() => ({ table: { rows: [] as Row[] } }));

function deleteBuilder(opts?: { count?: string }) {
  let predicate: ((r: Row) => boolean) | null = null;
  const run = () => {
    const before = table.rows.length;
    table.rows = predicate ? table.rows.filter((r) => !predicate!(r)) : table.rows;
    const removed = before - table.rows.length;
    return {
      error: null,
      count: opts?.count === "exact" ? removed : null,
    };
  };
  return {
    eq(col: string, val: unknown) {
      predicate = (r) => (r as unknown as Record<string, unknown>)[col] === val;
      return this;
    },
    not(col: string, op: string, val: unknown) {
      if (col === "id" && op === "is" && val === null) {
        // "id not is null" — matches every row.
        predicate = () => true;
      } else {
        throw new Error(`unexpected not(${col}, ${op}, ${String(val)})`);
      }
      return this;
    },
    then(resolve: (v: { error: null; count: number | null }) => void) {
      resolve(run());
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => {
      if (t !== "feature_requests") throw new Error(`unexpected table ${t}`);
      return { delete: (opts?: { count?: string }) => deleteBuilder(opts) };
    },
  }),
}));

import {
  clearFeatureRequests,
  deleteFeatureRequest,
} from "@/lib/data/feature-requests";

beforeEach(() => {
  table.rows = [
    { id: "a", message: "first" },
    { id: "b", message: "second" },
    { id: "c", message: "third" },
  ];
});

describe("deleteFeatureRequest — removes exactly the given row", () => {
  it("deletes one row and leaves the rest", async () => {
    await deleteFeatureRequest("b");
    expect(table.rows.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("a second delete of the same id is a harmless no-op", async () => {
    await deleteFeatureRequest("b");
    await deleteFeatureRequest("b");
    expect(table.rows.map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("clearFeatureRequests — empties the list", () => {
  it("deletes every row and returns the count", async () => {
    const cleared = await clearFeatureRequests();
    expect(cleared).toBe(3);
    expect(table.rows).toEqual([]);
  });

  it("returns 0 on an already-empty list", async () => {
    table.rows = [];
    const cleared = await clearFeatureRequests();
    expect(cleared).toBe(0);
  });
});
