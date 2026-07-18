/**
 * "Invoices required" data layer (migration 041):
 *   - getJobsNeedingInvoice: filters needs_invoice = true + non-archived,
 *     newest first (the homepage checklist source).
 *   - setJobNeedsInvoice: flips the flag on one job (+ stamps updated_at).
 *   - setJobNeedsInvoiceAction: auth-gated, returns success.
 *
 * Against an in-memory `jobs` table whose supabase stub honours the
 * select(...).eq().eq().order().limit() read chain AND the
 * update(payload).eq() write chain.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let jobsRows: Row[] = [];

// Read builder: select().eq().eq().order().limit() → { data, error }
function makeReadable() {
  const filters: Array<(r: Row) => boolean> = [];
  let orderCol: string | null = null;
  let ascending = true;
  let limitN = Infinity;
  const builder = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col;
      ascending = opts?.ascending ?? true;
      return builder;
    },
    then(resolve: (v: { data: Row[]; error: unknown }) => void) {
      let rows = jobsRows.filter((r) => filters.every((f) => f(r)));
      if (orderCol) {
        rows = [...rows].sort((a, b) => {
          const av = String(a[orderCol!] ?? "");
          const bv = String(b[orderCol!] ?? "");
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      resolve({ data: rows.slice(0, limitN).map((r) => ({ ...r })), error: null });
    },
    limit(n: number) {
      limitN = n;
      return builder;
    },
  };
  return builder;
}

// Write builder: update(payload).eq() → { error }
function makeWritable() {
  let payload: Row | null = null;
  const filters: Array<(r: Row) => boolean> = [];
  const builder = {
    update(p: Row) {
      payload = p;
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    then(resolve: (v: { error: unknown }) => void) {
      const matched = jobsRows.filter((r) => filters.every((f) => f(r)));
      for (const r of matched) Object.assign(r, payload);
      resolve({ error: null });
    },
  };
  return builder;
}

// One "jobs" handle whose method decides read-vs-write on first call.
function makeJobs() {
  return {
    select: () => makeReadable().select(),
    update: (p: Row) => makeWritable().update(p),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => makeJobs() }),
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: requireUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getJobsNeedingInvoice, setJobNeedsInvoice } from "@/lib/data/jobs";
import { setJobNeedsInvoiceAction } from "@/app/(app)/jobs/[id]/actions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "op" });
  vi.mocked(revalidatePath).mockClear();
  jobsRows = [
    { id: A, needs_invoice: true, is_archived: false, job_date: "2026-07-10" },
    { id: B, needs_invoice: false, is_archived: false, job_date: "2026-07-20" },
    { id: C, needs_invoice: true, is_archived: true, job_date: "2026-07-30" }, // archived
    { id: "d", needs_invoice: true, is_archived: false, job_date: "2026-08-01" },
  ];
});

describe("getJobsNeedingInvoice", () => {
  it("returns only flagged, non-archived jobs", async () => {
    const rows = await getJobsNeedingInvoice();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(A);
    expect(ids).toContain("d");
    expect(ids).not.toContain(B); // not flagged
    expect(ids).not.toContain(C); // archived
  });

  it("orders newest first", async () => {
    const rows = await getJobsNeedingInvoice();
    expect(rows.map((r) => r.id)).toEqual(["d", A]); // 2026-08-01 before 2026-07-10
  });
});

describe("setJobNeedsInvoice", () => {
  it("sets the flag true and stamps updated_at", async () => {
    await setJobNeedsInvoice(B, true);
    const row = jobsRows.find((r) => r.id === B)!;
    expect(row.needs_invoice).toBe(true);
    expect(typeof row.updated_at).toBe("string");
  });

  it("clears the flag (tick-off)", async () => {
    await setJobNeedsInvoice(A, false);
    expect(jobsRows.find((r) => r.id === A)!.needs_invoice).toBe(false);
  });

  it("touches only the targeted row", async () => {
    await setJobNeedsInvoice(B, true);
    expect(jobsRows.find((r) => r.id === A)!.needs_invoice).toBe(true); // unchanged
  });
});

describe("setJobNeedsInvoiceAction", () => {
  it("requires auth — writes nothing when unauthenticated", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(setJobNeedsInvoiceAction(B, true)).rejects.toThrow(
      "Unauthorized"
    );
    expect(jobsRows.find((r) => r.id === B)!.needs_invoice).toBe(false);
  });

  it("flags the job and returns success", async () => {
    const res = await setJobNeedsInvoiceAction(B, true);
    expect(res).toEqual({ success: true });
    expect(jobsRows.find((r) => r.id === B)!.needs_invoice).toBe(true);
  });

  it("rejects a missing job id", async () => {
    const res = await setJobNeedsInvoiceAction("", true);
    expect(res.success).toBe(false);
    expect(res.message).toBeTruthy();
  });

  // Perf (revalidatePath slice, canary): both surfaces that show this flag
  // read Dexie via useLiveQuery, so the action must NOT call revalidatePath —
  // that purges the whole client router cache and stampedes a re-prefetch of
  // every link in production. The Dexie write at the wrapAction call site is
  // what updates the UI.
  it("does NOT call revalidatePath (no client-cache purge / prefetch stampede)", async () => {
    await setJobNeedsInvoiceAction(B, true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
