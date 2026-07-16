/**
 * getAllAgreements must exclude soft-deleted rows (a discarded draft).
 * RLS also hides them for user-scoped reads; this pins the explicit
 * `.is("deleted_at", null)` filter so the list stays correct even if the
 * fn ever runs under the service role. (Pre-existing gap fixed in Slice 2.)
 */
import { describe, it, expect, vi } from "vitest";

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];

function builder(table: string) {
  const methods = [
    "select",
    "eq",
    "neq",
    "not",
    "gte",
    "lte",
    "in",
    "is",
    "or",
    "order",
    "limit",
  ] as const;
  const b: Record<string, unknown> = {};
  for (const m of methods) {
    b[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return b;
    };
  }
  b.then = (resolve: (v: { data: never[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { getAllAgreements } from "@/lib/data/agreements";

describe("getAllAgreements — soft-deleted excluded", () => {
  it("filters .is('deleted_at', null)", async () => {
    await getAllAgreements();
    const agreementCalls = calls.filter((c) => c.table === "agreements");
    expect(agreementCalls.length).toBeGreaterThan(0);
    const hasFilter = agreementCalls.some(
      (c) =>
        c.method === "is" &&
        c.args[0] === "deleted_at" &&
        c.args[1] === null
    );
    expect(hasFilter).toBe(true);
  });
});
