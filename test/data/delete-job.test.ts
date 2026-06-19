/**
 * Delete-a-job (soft delete) — data layer + action.
 *
 * A job delete is a soft delete: `deleteJob` sets `deleted_at = now()` with
 * a direct UPDATE (jobs RLS is permissive, no RPC needed — unlike the
 * customer one). The job stops surfacing because every server read now
 * filters `deleted_at IS NULL`; the row and its dependents stay put.
 *
 * These pin three things against an in-memory PostgREST stub that honours
 * the eq/is filters the real reads/writes use:
 *
 *   1. deleteJob stamps `deleted_at` on the matching row;
 *   2. a soft-deleted job is excluded by getJobById (PGRST116 → null) — the
 *      updated read filter actually hides it;
 *   3. deleteJobAction is gated by requireUser — an unauthenticated call
 *      rejects and writes nothing — and the happy path returns
 *      `{ success: true }` after the real soft-delete applies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

// Shared in-memory `jobs` table the supabase stub reads/writes. Reset per
// test in beforeEach.
let jobsRows: Row[] = [];

// A query builder that honours the exact chains the data layer uses:
//   select("*").eq().is().single()      → row or PGRST116
//   update(payload).eq()                → awaited thenable, applies payload
// Filters are AND-ed; `.is(col, null)` matches null/undefined.
function makeQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  let pendingUpdate: Row | null = null;

  const matched = () => jobsRows.filter((r) => filters.every((f) => f(r)));

  const builder = {
    select() {
      return builder;
    },
    update(payload: Row) {
      pendingUpdate = payload;
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    is(col: string, val: unknown) {
      filters.push((r) => (val === null ? r[col] == null : r[col] === val));
      return builder;
    },
    async single() {
      const rows = matched();
      if (rows.length === 0) {
        return { data: null, error: { code: "PGRST116", message: "0 rows" } };
      }
      return { data: { ...rows[0] }, error: null };
    },
    async maybeSingle() {
      const rows = matched();
      return { data: rows.length ? { ...rows[0] } : null, error: null };
    },
    // Awaiting the builder directly (an UPDATE with no .select()) lands
    // here, mirroring PostgREST's thenable builders.
    then(resolve: (v: { error: null }) => void) {
      if (pendingUpdate) {
        for (const r of matched()) Object.assign(r, pendingUpdate);
      }
      resolve({ error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => makeQuery() }),
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: requireUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteJob, getJobById } from "@/lib/data/jobs";
import { deleteJobAction } from "@/app/(app)/jobs/[id]/actions";

const LIVE = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "op" });
  jobsRows = [
    { id: LIVE, job_status: "scheduled", deleted_at: null },
    { id: GONE, job_status: "scheduled", deleted_at: "2026-01-01T00:00:00.000Z" },
  ];
});

describe("deleteJob — soft delete", () => {
  it("stamps deleted_at on the matching row", async () => {
    await deleteJob(LIVE);
    const row = jobsRows.find((r) => r.id === LIVE)!;
    expect(row.deleted_at).not.toBeNull();
    expect(typeof row.deleted_at).toBe("string");
  });

  it("touches only the targeted row", async () => {
    await deleteJob(LIVE);
    // The already-deleted GONE row keeps its original stamp; an unrelated
    // row is never widened by the eq("id") filter.
    expect(jobsRows.find((r) => r.id === GONE)!.deleted_at).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });
});

describe("getJobById — excludes soft-deleted", () => {
  it("returns a live job", async () => {
    const job = await getJobById(LIVE);
    expect(job?.id).toBe(LIVE);
  });

  it("returns null for an already soft-deleted job", async () => {
    expect(await getJobById(GONE)).toBeNull();
  });

  it("a job stops surfacing once deleteJob runs", async () => {
    expect(await getJobById(LIVE)).not.toBeNull();
    await deleteJob(LIVE);
    expect(await getJobById(LIVE)).toBeNull();
  });
});

describe("deleteJobAction — auth gate + happy path", () => {
  it("requires auth — rejects and writes nothing when unauthenticated", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(deleteJobAction(LIVE)).rejects.toThrow("Unauthorized");
    // The soft-delete never ran.
    expect(jobsRows.find((r) => r.id === LIVE)!.deleted_at).toBeNull();
  });

  it("soft-deletes and returns success", async () => {
    const res = await deleteJobAction(LIVE);
    expect(res).toEqual({ success: true });
    expect(jobsRows.find((r) => r.id === LIVE)!.deleted_at).not.toBeNull();
  });

  it("returns an error for a missing id, without touching the table", async () => {
    const res = await deleteJobAction("");
    expect(res.success).toBe(false);
    expect(res.message).toBeTruthy();
    expect(jobsRows.find((r) => r.id === LIVE)!.deleted_at).toBeNull();
  });
});
