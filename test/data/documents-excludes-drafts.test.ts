/**
 * getAllDocuments must NOT surface DRAFT agreements. A draft's
 * contract_pdf_url holds its unsigned review copy, so the agreements
 * sub-query filters `.neq("status", "draft")`. This records the query
 * chain and asserts that filter is applied to the agreements table.
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
  // Thenable: awaiting any point in the chain resolves to an empty result.
  b.then = (resolve: (v: { data: never[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));

import { getAllDocuments } from "@/lib/data/documents";

describe("getAllDocuments — drafts excluded", () => {
  it("filters the agreements query with .neq('status','draft')", async () => {
    await getAllDocuments();
    const agreementCalls = calls.filter((c) => c.table === "agreements");
    expect(agreementCalls.length).toBeGreaterThan(0);
    const neqDraft = agreementCalls.some(
      (c) =>
        c.method === "neq" &&
        c.args[0] === "status" &&
        c.args[1] === "draft"
    );
    expect(neqDraft).toBe(true);
  });
});
