/**
 * upgradeDraftJob (Q3) — the guarded UPDATE that turns a draft into a real
 * scheduled booking.
 *
 * Pins, against an in-memory PostgREST stub that honours eq filters like
 * the real UPDATE:
 *   1. draft → scheduled: attaches the site, sets the reference, and
 *      LEAVES capture_note untouched (persists);
 *   2. guarded no-op: a job that has already advanced past 'draft' is NOT
 *      touched and returns null (the .eq("job_status","draft") guard
 *      matched zero rows) — and it must NOT throw (so .maybeSingle());
 *   3. idempotent replay: a second upgrade (lost-ack re-run) is a zero-row
 *      no-op that leaves the row exactly as the first run left it;
 *   4. a 23505 partial-unique violation maps to JobClashError — never a
 *      raw DB error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Reference generation is server-only and separately covered — stub it so
// these tests isolate upgradeDraftJob's guard / no-op / clash behaviour.
vi.mock("@/lib/data/job-references", () => ({
  generateJobReference: vi.fn(async () => "00042-TST"),
  customerCode: vi.fn(() => "TST"),
}));

type Row = Record<string, unknown>;

let jobRow: Row;
let forceClash = false;
const siteCustomer = {
  customer_type: "commercial" as const,
  company_name: "Test Ltd",
  name: "Tester",
};

function jobsUpdateBuilder(payload: Row) {
  const filters: Array<(r: Row) => boolean> = [];
  const apply = () => {
    if (filters.every((f) => f(jobRow))) {
      Object.assign(jobRow, payload);
      return true;
    }
    return false;
  };
  const chain = {
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return chain;
    },
    select() {
      return {
        maybeSingle: async () => {
          if (forceClash) {
            return { data: null, error: { code: "23505", message: "dup" } };
          }
          const matched = apply();
          return { data: matched ? { ...jobRow } : null, error: null };
        },
      };
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "sites") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { customer: siteCustomer },
                error: null,
              }),
            }),
          }),
        };
      }
      // jobs
      return { update: (payload: Row) => jobsUpdateBuilder(payload) };
    },
  }),
}));

import { upgradeDraftJob, JobClashError } from "@/lib/data/jobs";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";

const bookingInput = {
  site_id: SITE_ID,
  job_date: "2026-07-01",
  job_time: "09:00",
  job_time_end: "12:00",
  call_type: "routine" as const,
  pest_species: ["Rats"],
  value: 120,
  report_notes: "",
  parent_job_id: "",
};

beforeEach(() => {
  forceClash = false;
  vi.clearAllMocks();
});

describe("upgradeDraftJob", () => {
  it("draft → scheduled: attaches site, sets reference, keeps capture_note", async () => {
    jobRow = {
      id: DRAFT_ID,
      job_status: "draft",
      site_id: null,
      capture_note: "Sarah, Wasps, Folkestone",
      reference_number: null,
    };

    const res = await upgradeDraftJob(DRAFT_ID, bookingInput);

    expect(res).not.toBeNull();
    expect(jobRow.job_status).toBe("scheduled");
    expect(jobRow.site_id).toBe(SITE_ID);
    expect(jobRow.reference_number).toBe("00042-TST");
    // capture_note is omitted from the SET — the original jotting persists.
    expect(jobRow.capture_note).toBe("Sarah, Wasps, Folkestone");
  });

  it("guarded no-op: a non-draft (already advanced) job is untouched, returns null", async () => {
    jobRow = {
      id: DRAFT_ID,
      job_status: "in_progress",
      site_id: SITE_ID,
      capture_note: null,
      reference_number: "00001",
    };

    const res = await upgradeDraftJob(DRAFT_ID, bookingInput);

    // .eq("job_status","draft") matched zero rows → no-op, no throw.
    expect(res).toBeNull();
    expect(jobRow.job_status).toBe("in_progress");
    expect(jobRow.reference_number).toBe("00001");
  });

  it("idempotent replay: a second upgrade after the first is a zero-row no-op", async () => {
    jobRow = {
      id: DRAFT_ID,
      job_status: "draft",
      site_id: null,
      capture_note: "note",
      reference_number: null,
    };

    const first = await upgradeDraftJob(DRAFT_ID, bookingInput);
    expect(first).not.toBeNull();
    expect(jobRow.job_status).toBe("scheduled");
    const refAfterFirst = jobRow.reference_number;

    // Replays again (e.g. lost-ack). Row is 'scheduled' now → guard no-ops.
    const second = await upgradeDraftJob(DRAFT_ID, bookingInput);
    expect(second).toBeNull();
    expect(jobRow.job_status).toBe("scheduled");
    expect(jobRow.reference_number).toBe(refAfterFirst);
  });

  it("partial-unique clash (23505) → JobClashError, never a raw DB error", async () => {
    jobRow = {
      id: DRAFT_ID,
      job_status: "draft",
      site_id: null,
      capture_note: "note",
      reference_number: null,
    };
    forceClash = true;

    await expect(
      upgradeDraftJob(DRAFT_ID, bookingInput)
    ).rejects.toBeInstanceOf(JobClashError);
  });
});
