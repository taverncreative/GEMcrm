/**
 * writeServiceSheet status guard (offline-pwa pass 0).
 *
 * drainOutbox clears outbox entries BY replaying them, and the
 * submit-time `completeServiceSheetAction` entry is deliberately left
 * queued after a successful online call (crash recovery). Before the
 * guard, the replay's unconditional `job_status: "in_progress"` write
 * regressed a job the approval step had already moved to completed.
 *
 * These tests pin the guard against an in-memory PostgREST stub that
 * honours eq/neq filters the way the real UPDATE does:
 *
 *   1. replay against a completed job → status STAYS completed (sheet
 *      fields still apply — same data, harmless);
 *   2. normal first save still advances scheduled → in_progress;
 *   3. the legacy completeServiceSheet alias still upgrades to
 *      completed unconditionally.
 *
 * The same sequence is verified against the real staging data layer in
 * the pass-0 staging run (see commit message).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServiceSheetSchema } from "@/lib/validation/service-sheet";

// ─── In-memory jobs-table stub ──────────────────────────────────────
// Supports the exact chains writeServiceSheet uses:
//   update(p).eq(...).neq(...)            → awaited thenable (guarded write)
//   update(p).eq(...).select().single()   → { data: row, error: null }
// Filters are applied to a single row; an UPDATE whose filters don't
// match is a no-op, like the real thing.

type Row = Record<string, unknown>;

let row: Row;

function makeBuilder(payload: Row) {
  const filters: Array<(r: Row) => boolean> = [];
  const apply = () => {
    if (filters.every((f) => f(row))) Object.assign(row, payload);
  };
  const chain = {
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return chain;
    },
    neq(col: string, val: unknown) {
      filters.push((r) => r[col] !== val);
      return chain;
    },
    select() {
      return {
        single: async () => {
          apply();
          return { data: { ...row }, error: null };
        },
      };
    },
    // Awaiting the builder directly (the guarded status write has no
    // .select()) lands here, mirroring PostgREST's thenable builders.
    then(resolve: (v: { error: null }) => void) {
      apply();
      resolve({ error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: (payload: Row) => makeBuilder(payload),
    }),
  }),
}));

import { saveServiceSheet, completeServiceSheet } from "@/lib/data/jobs";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

// Valid input via the real schema (defaults applied). No signatures as
// data URLs and no photos → the storage-upload branches are skipped.
const input = ServiceSheetSchema.parse({
  job_id: JOB_ID,
  call_type: "routine",
  pest_species: ["Rats"],
  findings: "Activity at bait point 3",
  recommendations: "Re-bait and proof gap under door",
  method_used: ["Bait"],
  pesticides_used: "Brodifacoum blocks",
  risk_level: "low",
  risk_comments: "No access risks identified",
  technician_signature: "sig-already-uploaded-url",
  client_present: "false",
});

function makeRow(job_status: string): Row {
  return {
    id: JOB_ID,
    job_status,
    findings: null,
    site_id: "22222222-2222-4222-8222-222222222222",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("writeServiceSheet status guard", () => {
  it("replay after approval does NOT downgrade completed → in_progress", async () => {
    row = makeRow("completed");

    const updated = await saveServiceSheet(JOB_ID, input);

    expect(row.job_status).toBe("completed");
    expect(updated.job_status).toBe("completed");
    // The stale replay's sheet data still applies — same payload the
    // approval already saved, so overwriting is harmless by design.
    expect(row.findings).toBe("Activity at bait point 3");
  });

  it("first save still advances scheduled → in_progress", async () => {
    row = makeRow("scheduled");

    const updated = await saveServiceSheet(JOB_ID, input);

    expect(row.job_status).toBe("in_progress");
    expect(updated.job_status).toBe("in_progress");
  });

  it("legacy completeServiceSheet alias still upgrades to completed", async () => {
    row = makeRow("in_progress");

    const updated = await completeServiceSheet(JOB_ID, input);

    expect(row.job_status).toBe("completed");
    expect(updated.job_status).toBe("completed");
  });
});
