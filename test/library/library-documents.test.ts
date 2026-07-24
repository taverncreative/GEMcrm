/**
 * library_documents data layer:
 *   - reads exclude soft-deleted rows via an explicit `.is('deleted_at',
 *     null)` filter (there is NO self-hiding SELECT policy on this table);
 *   - soft-delete is a PLAIN `update({ deleted_at })` (no SECURITY DEFINER
 *     RPC) — safe precisely because of the point above.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { table: string; method: string; args: unknown[] };
let calls: Call[];

function builder(table: string) {
  const methods = ["select", "eq", "is", "order", "insert", "update", "single"] as const;
  const b: Record<string, unknown> = {};
  for (const m of methods) {
    b[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args });
      return b;
    };
  }
  b.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  getLibraryDocuments,
  softDeleteLibraryDocument,
} from "@/lib/data/library-documents";

beforeEach(() => {
  calls = [];
});

describe("getLibraryDocuments", () => {
  it("filters out soft-deleted rows", async () => {
    await getLibraryDocuments();
    const hasFilter = calls.some(
      (c) =>
        c.table === "library_documents" &&
        c.method === "is" &&
        c.args[0] === "deleted_at" &&
        c.args[1] === null
    );
    expect(hasFilter).toBe(true);
  });
});

describe("softDeleteLibraryDocument", () => {
  it("is a plain update setting deleted_at (no RPC)", async () => {
    await softDeleteLibraryDocument("doc-1");
    const update = calls.find(
      (c) => c.table === "library_documents" && c.method === "update"
    );
    expect(update).toBeTruthy();
    expect((update!.args[0] as { deleted_at?: unknown }).deleted_at).toBeTruthy();
    // targeted by id, and never routed through an rpc() call
    expect(
      calls.some((c) => c.method === "eq" && c.args[0] === "id" && c.args[1] === "doc-1")
    ).toBe(true);
    expect(calls.some((c) => c.method === "rpc")).toBe(false);
  });
});
