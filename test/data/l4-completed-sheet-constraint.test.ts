/**
 * L4 — DB CHECK "completed jobs require a filled sheet" (migration 035).
 *
 * The constraint is Postgres-side; vitest has no live DB, so this proves
 * the two things that can diverge from the SQL:
 *
 *   A. PREDICATE PARITY — the SQL CHECK encoding mirrors isServiceSheetFilled
 *      exactly (so DB and app agree), and draft/scheduled/in_progress pass
 *      vacuously. `sqlCheck` re-encodes the migration's boolean in JS and is
 *      asserted equal to `status<>'completed' OR isServiceSheetFilled` across
 *      a battery, including each single-field omission.
 *
 *   B. WRITE-ORDER SAFETY — the real saveServiceSheet → finalizeServiceSheet
 *      sequence run against an in-memory jobs stub that ENFORCES the CHECK
 *      (rejecting any update whose result row is completed+unfilled). Proves
 *      a proper completion succeeds, an amend stays safe, and a bare
 *      finalize on an empty row is rejected — never a transient violation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ServiceSheetSchema,
  isServiceSheetFilled,
} from "@/lib/validation/service-sheet";

// ─── The migration's CHECK, re-encoded in JS (btrim for the 4 text
//     fields, raw non-empty for risk_level, length>0 for the arrays). ──
type Row = Record<string, unknown>;
const nonEmptyTrim = (s: unknown) =>
  typeof s === "string" && s.trim() !== "";
const nonEmptyRaw = (s: unknown) => typeof s === "string" && s !== "";

// Migration 047 DROPPED the products/pesticides requirement — zero products
// is a valid completed sheet (survey visits). This encoding must stay in
// lockstep with the DB CHECK (jobs_completed_requires_filled_sheet) and
// isServiceSheetFilled: none of the three references products/pesticides.
function sqlCheck(r: Row): boolean {
  if (r.job_status !== "completed") return true; // vacuous for non-completed
  return (
    nonEmptyTrim(r.findings) &&
    nonEmptyTrim(r.recommendations) &&
    nonEmptyRaw(r.risk_level) &&
    nonEmptyTrim(r.risk_comments) &&
    Array.isArray(r.pest_species) &&
    r.pest_species.length > 0 &&
    Array.isArray(r.method_used) &&
    r.method_used.length > 0
  );
}

// ─── In-memory jobs stub that ENFORCES the CHECK (Part B) ──────────────
// Mirrors writeServiceSheet's / finalizeServiceSheet's exact chains:
//   update(p).eq(...).neq(...)            -> awaited thenable (guarded write)
//   update(p).eq(...).select().single()   -> { data, error }
// An update whose RESULT row would violate sqlCheck returns a 23514
// check_violation and does NOT persist — exactly like Postgres.
let row: Row;

function makeBuilder(payload: Row) {
  const filters: Array<(r: Row) => boolean> = [];
  const run = (): { violated: boolean } => {
    if (!filters.every((f) => f(row))) return { violated: false }; // no match, no-op
    const candidate = { ...row, ...payload };
    if (!sqlCheck(candidate)) return { violated: true };
    row = candidate;
    return { violated: false };
  };
  const CHECK_ERR = { code: "23514", message: "check_violation" };
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
          const { violated } = run();
          return violated
            ? { data: null, error: CHECK_ERR }
            : { data: { ...row }, error: null };
        },
      };
    },
    then(resolve: (v: { error: typeof CHECK_ERR | null }) => void) {
      const { violated } = run();
      resolve({ error: violated ? CHECK_ERR : null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ update: (payload: Row) => makeBuilder(payload) }),
  }),
}));

import { saveServiceSheet, finalizeServiceSheet } from "@/lib/data/jobs";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

const validInput = ServiceSheetSchema.parse({
  job_id: JOB_ID,
  call_type: "routine",
  pest_species: ["Rats"],
  findings: "Activity at bait point 3",
  recommendations: "Re-bait and proof the gap under the door",
  method_used: ["Rodenticide Used"],
  products_used: [
    {
      product_id: null,
      brand_name: "Brodikill",
      chemical_name: "brodifacoum 0.0029% grain",
      quantity: "2 blocks",
    },
  ],
  risk_level: "low",
  risk_comments: "No access risks identified",
  technician_signature: "sig-already-uploaded-url", // not data: -> no upload
  client_present: "false",
});

function filledRow(status: string): Row {
  return {
    id: JOB_ID,
    job_status: status,
    findings: "f",
    recommendations: "r",
    risk_level: "low",
    risk_comments: "rc",
    pest_species: ["Rats"],
    method_used: ["Rodenticide Used"],
  };
}
function emptyRow(status: string): Row {
  return {
    id: JOB_ID,
    job_status: status,
    findings: null,
    recommendations: null,
    risk_level: null,
    risk_comments: null,
    pest_species: [],
    method_used: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── A. Predicate parity ───────────────────────────────────────────────
describe("L4 CHECK predicate parity with isServiceSheetFilled", () => {
  const FIELDS: Array<keyof ReturnType<typeof filledRow>> = [
    "findings",
    "recommendations",
    "risk_level",
    "risk_comments",
    "pest_species",
    "method_used",
  ];

  it("completed + all fields → allowed", () => {
    expect(sqlCheck(filledRow("completed"))).toBe(true);
  });

  it("completed + any single field missing → rejected (all 6)", () => {
    for (const f of FIELDS) {
      const r = filledRow("completed");
      r[f] = f === "pest_species" || f === "method_used" ? [] : "";
      expect(sqlCheck(r), `missing ${String(f)}`).toBe(false);
    }
  });

  it("draft / scheduled / in_progress with an empty sheet → allowed (vacuous)", () => {
    expect(sqlCheck(emptyRow("draft"))).toBe(true);
    expect(sqlCheck(emptyRow("scheduled"))).toBe(true);
    expect(sqlCheck(emptyRow("in_progress"))).toBe(true);
  });

  it("the SQL encoding equals `status<>completed OR isServiceSheetFilled` for every case", () => {
    const cases: Row[] = [
      filledRow("completed"),
      emptyRow("completed"),
      emptyRow("draft"),
      emptyRow("scheduled"),
      emptyRow("in_progress"),
      filledRow("scheduled"),
      { ...filledRow("completed"), risk_comments: "   " }, // whitespace -> trims empty
      { ...filledRow("completed"), pest_species: [] },
    ];
    for (const r of cases) {
      const appMeaning =
        r.job_status !== "completed" ||
        isServiceSheetFilled(
          r as unknown as Parameters<typeof isServiceSheetFilled>[0]
        );
      expect(sqlCheck(r), JSON.stringify(r)).toBe(appMeaning);
    }
  });
});

// ─── B. Real completion-path write against the enforced CHECK ──────────
describe("completion write order satisfies the L4 CHECK", () => {
  it("proper completion (saveServiceSheet → finalizeServiceSheet) succeeds", async () => {
    row = emptyRow("scheduled");

    const afterSave = await saveServiceSheet(JOB_ID, validInput);
    expect(afterSave.job_status).toBe("in_progress"); // fields written, not yet completed

    const afterFinalize = await finalizeServiceSheet(JOB_ID);
    expect(afterFinalize.job_status).toBe("completed");
    // The constraint never tripped: the row is completed AND filled.
    expect(row.job_status).toBe("completed");
    expect(sqlCheck(row)).toBe(true);
  });

  it("bare finalize on an empty row is REJECTED by the constraint", async () => {
    row = emptyRow("scheduled");
    await expect(finalizeServiceSheet(JOB_ID)).rejects.toThrow();
    // Rejected write did not persist — row stays scheduled, not completed.
    expect(row.job_status).toBe("scheduled");
  });

  it("amend (save on an already-completed row) stays filled → allowed", async () => {
    row = filledRow("completed");
    // writeServiceSheet's in_progress guard no-ops on a completed row; the
    // field write rewrites validated (filled) values, status stays completed.
    const updated = await saveServiceSheet(JOB_ID, validInput);
    expect(updated.job_status).toBe("completed");
    expect(sqlCheck(row)).toBe(true);
  });
});
