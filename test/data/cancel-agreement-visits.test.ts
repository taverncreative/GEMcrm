/**
 * Cancelling an agreement removes its FUTURE scheduled visits.
 *
 * Cancelling used to be a bare `update({status})` — nothing reacted, so a
 * cancelled contract left its generated visits on the calendar for months.
 * Migration 051 adds `cancel_agreement_visits(p_agreement_id, p_from_date)`,
 * a SECURITY DEFINER RPC doing ONE filtered bulk update:
 *
 *   where agreement_id = p_agreement_id
 *     and deleted_at is null
 *     and job_status = 'scheduled'
 *     and job_date  >= p_from_date
 *
 * The `job_status = 'scheduled'` predicate lives in the DATABASE, not in app
 * code, so a COMPLETED visit (the record of work performed) and an
 * IN_PROGRESS one (a sheet being filled on site) can never be removed by any
 * caller. These tests pin that against an in-memory `jobs` table whose RPC
 * stub mirrors the function body exactly.
 *
 * The cut-off is a PARAMETER rather than `current_date` because cancelling
 * is offline-capable: the operator's device captures the date when they
 * press Cancel and it rides the outbox entry, so a replay days later removes
 * the set they SAW. The "delayed replay" block below is the test that pins
 * that, and it is the reason this feature is not simply `job_date >=
 * current_date` in SQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

let jobRows: Row[] = [];
let agreementRows: Row[] = [];

// Query builder covering the three chains the cancel path uses:
//   jobs:       select("job_date, job_status").eq("agreement_id", id)  → rows
//   agreements: select("*").eq("id", id).single()                      → row
//   agreements: update({status}).eq("id", id).select().single()        → row
// The RLS SELECT policy is modelled at the top of matched() — a soft-deleted
// row is invisible to every read, which is what makes the impact preview read
// zeroes after a cancel.
function makeQuery(table: string) {
  const rows = () => (table === "jobs" ? jobRows : agreementRows);
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;

  const matched = () =>
    rows()
      .filter((r) => r.deleted_at == null)
      .filter((r) => filters.every((f) => f(r)));

  const applyPatch = () => {
    if (!patch) return;
    for (const r of matched()) Object.assign(r, patch);
    patch = null;
  };

  const builder = {
    select() {
      return builder;
    },
    update(values: Row) {
      patch = values;
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    async single() {
      applyPatch();
      const found = matched();
      if (found.length === 0) {
        return { data: null, error: { code: "PGRST116", message: "0 rows" } };
      }
      return { data: { ...found[0] }, error: null };
    },
    then(resolve: (v: { data: Row[]; error: null }) => void) {
      applyPatch();
      return resolve({ data: matched().map((r) => ({ ...r })), error: null });
    },
  };
  return builder;
}

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => makeQuery(table),
    rpc: rpcMock,
  }),
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: requireUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// todayUk is mocked so "the server's idea of today" can be moved forward
// independently of the captured cut-off — that is the whole delayed-replay
// scenario.
const { todayUkMock } = vi.hoisted(() => ({
  todayUkMock: vi.fn(() => "2026-07-31"),
}));
vi.mock("@/lib/utils/today-uk", async (orig) => {
  const actual = await orig<typeof import("@/lib/utils/today-uk")>();
  return { ...actual, todayUk: todayUkMock };
});

import { cancelAgreementVisits } from "@/lib/data/agreements";
import { agreementCancelImpact } from "@/lib/agreements/cancel-impact";
import { updateAgreementStatusAction } from "@/app/(app)/agreements/[id]/actions";

const AGR = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_AGR = "bbbbbbbb-0000-4000-8000-000000000002";
const TODAY = "2026-07-31";

const INITIAL = { success: false, errors: {}, message: null };

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

/** Mirrors the migration-051 function body, predicate for predicate. */
function runCancelVisits(agreementId: string, fromDate: string) {
  const now = new Date().toISOString();
  for (const j of jobRows) {
    if (
      j.agreement_id === agreementId &&
      j.deleted_at == null &&
      j.job_status === "scheduled" &&
      String(j.job_date) >= fromDate
    ) {
      j.deleted_at = now;
    }
  }
  return { error: null };
}

// The agreement being cancelled, with one visit of every shape that matters.
const PAST_SCHEDULED = "past-scheduled";
const TODAY_SCHEDULED = "today-scheduled";
const FUTURE_SCHEDULED = "future-scheduled";
const FAR_FUTURE_SCHEDULED = "far-future-scheduled";
const PAST_COMPLETED = "past-completed";
const FUTURE_COMPLETED = "future-completed";
const IN_PROGRESS = "in-progress";
const OTHER_AGR_FUTURE = "other-agreement-future";

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "op" });
  todayUkMock.mockReset();
  todayUkMock.mockReturnValue(TODAY);
  rpcMock.mockReset();
  rpcMock.mockImplementation(
    async (
      fn: string,
      params: { p_agreement_id?: string; p_from_date?: string }
    ) => {
      if (fn === "cancel_agreement_visits") {
        return runCancelVisits(params.p_agreement_id!, params.p_from_date!);
      }
      return { error: null };
    }
  );

  agreementRows = [
    { id: AGR, status: "active", deleted_at: null },
    { id: OTHER_AGR, status: "active", deleted_at: null },
  ];
  jobRows = [
    { id: PAST_SCHEDULED, agreement_id: AGR, job_date: "2026-06-15", job_status: "scheduled", deleted_at: null },
    { id: TODAY_SCHEDULED, agreement_id: AGR, job_date: TODAY, job_status: "scheduled", deleted_at: null },
    { id: FUTURE_SCHEDULED, agreement_id: AGR, job_date: "2026-08-01", job_status: "scheduled", deleted_at: null },
    { id: FAR_FUTURE_SCHEDULED, agreement_id: AGR, job_date: "2027-06-28", job_status: "scheduled", deleted_at: null },
    { id: PAST_COMPLETED, agreement_id: AGR, job_date: "2026-05-10", job_status: "completed", deleted_at: null },
    // A completed visit dated in the FUTURE is odd but possible (an early
    // write-up). It must survive on job_status alone, not on its date.
    { id: FUTURE_COMPLETED, agreement_id: AGR, job_date: "2026-09-09", job_status: "completed", deleted_at: null },
    { id: IN_PROGRESS, agreement_id: AGR, job_date: TODAY, job_status: "in_progress", deleted_at: null },
    { id: OTHER_AGR_FUTURE, agreement_id: OTHER_AGR, job_date: "2026-08-01", job_status: "scheduled", deleted_at: null },
  ];
});

const live = (id: string) => jobRows.find((r) => r.id === id)!.deleted_at == null;

describe("cancel_agreement_visits — which visits go", () => {
  it("removes FUTURE scheduled visits", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    expect(live(FUTURE_SCHEDULED)).toBe(false);
    expect(live(FAR_FUTURE_SCHEDULED)).toBe(false);
  });

  it("removes a visit scheduled for TODAY", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    expect(live(TODAY_SCHEDULED)).toBe(false);
  });

  it("LEAVES past-dated scheduled visits — they still need writing up", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    expect(live(PAST_SCHEDULED)).toBe(true);
  });

  it("NEVER touches a completed visit, whatever its date", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    expect(live(PAST_COMPLETED)).toBe(true);
    expect(live(FUTURE_COMPLETED)).toBe(true);
  });

  it("NEVER touches an in-progress visit", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    expect(live(IN_PROGRESS)).toBe(true);
  });

  it("does not reach another agreement's visits", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    expect(live(OTHER_AGR_FUTURE)).toBe(true);
  });

  it("calls the RPC with both parameters, not a direct update", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    expect(rpcMock).toHaveBeenCalledWith("cancel_agreement_visits", {
      p_agreement_id: AGR,
      p_from_date: TODAY,
    });
  });

  it("is a no-op on replay (deleted_at is null predicate)", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    const stamp = jobRows.find((r) => r.id === FUTURE_SCHEDULED)!.deleted_at;
    await cancelAgreementVisits(AGR, TODAY);
    expect(jobRows.find((r) => r.id === FUTURE_SCHEDULED)!.deleted_at).toBe(
      stamp
    );
  });

  it("surfaces an RPC error as a thrown failure", async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: "42501", message: "row-level security" },
    });
    await expect(cancelAgreementVisits(AGR, TODAY)).rejects.toThrow(
      "Failed to remove future visits"
    );
  });
});

describe("agreementCancelImpact — the numbers the dialog shows", () => {
  // Pure, and fed from Dexie in the dialog rather than a server action:
  // cancelling is offline-capable, so the preview must not need the network.
  const asJobs = () =>
    jobRows
      .filter((r) => r.agreement_id === AGR)
      .map((r) => ({
        job_date: String(r.job_date),
        job_status: String(r.job_status),
        deleted_at: r.deleted_at as string | null,
      }));

  it("counts removed / today / past / completed / in progress", () => {
    const impact = agreementCancelImpact(asJobs(), TODAY);
    // scheduled on-or-after today: today + 2026-08-01 + 2027-06-28
    expect(impact.removed).toBe(3);
    expect(impact.today).toBe(1);
    expect(impact.past).toBe(1);
    expect(impact.completed).toBe(2);
    expect(impact.inProgress).toBe(1);
  });

  it("mirrors the RPC exactly — everything it counts as removed is removed", async () => {
    const before = agreementCancelImpact(asJobs(), TODAY);
    const liveBefore = jobRows.filter((r) => r.deleted_at == null).length;
    await cancelAgreementVisits(AGR, TODAY);
    const liveAfter = jobRows.filter((r) => r.deleted_at == null).length;
    expect(liveBefore - liveAfter).toBe(before.removed);
  });

  it("reads zeroes once the cancel has run (removed rows are ignored)", async () => {
    await cancelAgreementVisits(AGR, TODAY);
    const after = agreementCancelImpact(asJobs(), TODAY);
    expect(after.removed).toBe(0);
    expect(after.past).toBe(1);
    expect(after.completed).toBe(2);
  });

  it("counts nothing for an agreement with no visits", () => {
    expect(agreementCancelImpact([], TODAY)).toEqual({
      removed: 0,
      today: 0,
      past: 0,
      completed: 0,
      inProgress: 0,
    });
  });
});

describe("updateAgreementStatusAction — cancel wires the removal in", () => {
  it("requires auth, and removes nothing when unauthenticated", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(
      updateAgreementStatusAction(
        INITIAL,
        fd({ agreement_id: AGR, status: "cancelled", cutoff_date: TODAY })
      )
    ).rejects.toThrow("Unauthorized");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(live(FUTURE_SCHEDULED)).toBe(true);
  });

  it("cancelling removes the future visits", async () => {
    const res = await updateAgreementStatusAction(
      INITIAL,
      fd({ agreement_id: AGR, status: "cancelled", cutoff_date: TODAY })
    );
    expect(res.success).toBe(true);
    expect(live(FUTURE_SCHEDULED)).toBe(false);
    expect(live(TODAY_SCHEDULED)).toBe(false);
    expect(live(PAST_SCHEDULED)).toBe(true);
    expect(live(PAST_COMPLETED)).toBe(true);
    expect(live(IN_PROGRESS)).toBe(true);
  });

  it("PAUSING removes nothing", async () => {
    const res = await updateAgreementStatusAction(
      INITIAL,
      fd({ agreement_id: AGR, status: "paused" })
    );
    expect(res.success).toBe(true);
    expect(
      rpcMock.mock.calls.some((c) => c[0] === "cancel_agreement_visits")
    ).toBe(false);
    expect(jobRows.every((r) => r.deleted_at == null)).toBe(true);
  });

  it("ACTIVATING removes nothing", async () => {
    await updateAgreementStatusAction(
      INITIAL,
      fd({ agreement_id: AGR, status: "active" })
    );
    expect(jobRows.every((r) => r.deleted_at == null)).toBe(true);
  });

  it("reports a visit-removal failure without claiming the cancel failed", async () => {
    // The status write has already landed; the operator needs to know the
    // visits are still there, not to be told to cancel again.
    rpcMock.mockImplementation(async (fn: string) =>
      fn === "cancel_agreement_visits"
        ? { error: { code: "XX000", message: "boom" } }
        : { error: null }
    );
    const res = await updateAgreementStatusAction(
      INITIAL,
      fd({ agreement_id: AGR, status: "cancelled", cutoff_date: TODAY })
    );
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/still on the calendar/i);
  });
});

describe("the captured cut-off is honoured on a DELAYED replay", () => {
  it("uses the date the operator saw, not the date of the replay", async () => {
    // Cancelled offline on 31 Jul; the outbox drains on 3 Aug. By then the
    // 1 Aug visit is in the PAST, so a recomputed cut-off would spare it —
    // but the operator was shown "it will be removed", so it must go.
    todayUkMock.mockReturnValue("2026-08-03");

    await updateAgreementStatusAction(
      INITIAL,
      fd({ agreement_id: AGR, status: "cancelled", cutoff_date: TODAY })
    );

    expect(rpcMock).toHaveBeenCalledWith("cancel_agreement_visits", {
      p_agreement_id: AGR,
      p_from_date: TODAY,
    });
    expect(live(FUTURE_SCHEDULED)).toBe(false);
    // And the 31 Jul visit, already past by replay time, still goes.
    expect(live(TODAY_SCHEDULED)).toBe(false);
  });

  it("falls back to today only when no cut-off rode the entry", async () => {
    // A pre-existing outbox entry queued before cutoff_date existed.
    todayUkMock.mockReturnValue("2026-08-03");
    await updateAgreementStatusAction(
      INITIAL,
      fd({ agreement_id: AGR, status: "cancelled" })
    );
    expect(rpcMock).toHaveBeenCalledWith("cancel_agreement_visits", {
      p_agreement_id: AGR,
      p_from_date: "2026-08-03",
    });
    // The 1 Aug visit is spared by the later cut-off, which is the honest
    // outcome when nobody recorded what the operator was shown.
    expect(live(FUTURE_SCHEDULED)).toBe(true);
    expect(live(FAR_FUTURE_SCHEDULED)).toBe(false);
  });

  it("ignores a malformed cut-off rather than trusting it", async () => {
    todayUkMock.mockReturnValue("2026-08-03");
    await updateAgreementStatusAction(
      INITIAL,
      fd({ agreement_id: AGR, status: "cancelled", cutoff_date: "not-a-date" })
    );
    expect(rpcMock).toHaveBeenCalledWith("cancel_agreement_visits", {
      p_agreement_id: AGR,
      p_from_date: "2026-08-03",
    });
  });
});
