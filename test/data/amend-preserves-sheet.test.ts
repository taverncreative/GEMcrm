/**
 * Amend must not delete what it wasn't given.
 *
 * `writeServiceSheet` builds ONE update covering every service-sheet
 * column, so anything the form didn't send used to be written back empty.
 * Correct for a fresh fill (the job is blank); catastrophic for an amend.
 * Proven against the database before this fix: an amend that changed
 * nothing but the forced technician re-sign nulled client_signature_url,
 * flipped client_present to false, nulled client_name, cleared
 * needs_invoice and DELETED BOTH PHOTOS. Photos are captured in the field
 * and cannot be recreated.
 *
 * The fix is a manifest (lib/data/sheet-fields.ts): a submission declares
 * which columns it speaks for, and on an amend every other column is left
 * OUT of the UPDATE statement entirely. These tests assert on the exact
 * shape of that statement, because "the column was absent" is the whole
 * guarantee — a column that isn't in the UPDATE cannot change.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Capture the UPDATE payload ────────────────────────────────────

let lastUpdate: Record<string, unknown> | null = null;
const uploadedPaths: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        // The guarded in_progress status write runs first and is a
        // separate statement; only the main sheet update carries the
        // columns under test.
        if (!("job_status" in payload) || Object.keys(payload).length > 1) {
          lastUpdate = payload;
        }
        return {
          eq: () => ({
            // Guarded status write: .eq().neq() terminates the chain.
            neq: async () => ({ error: null }),
            select: () => ({
              single: async () => ({
                data: { id: "job-1", site_id: "site-1" },
                error: null,
              }),
            }),
          }),
        };
      },
    }),
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://stub.supabase.co/storage/v1/object/public/reports/${path}`,
          },
        }),
      }),
    },
  }),
}));

vi.mock("@/lib/storage/upload", () => ({
  uploadBase64Image: async (_data: string, path: string) => {
    uploadedPaths.push(path);
    return `https://stub.supabase.co/storage/v1/object/public/reports/${path}`;
  },
  uploadPdf: async () => "https://stub/pdf",
}));

import { saveServiceSheet } from "@/lib/data/jobs";
import {
  SHEET_FIELDS,
  LEGACY_AMEND_FIELDS,
  encodeSheetFields,
  parseSheetFields,
  type SheetField,
} from "@/lib/data/sheet-fields";
import type { ServiceSheetInput } from "@/lib/validation/service-sheet";

/** A submission with nothing in it — the shape an amend form produced
 *  before it learned to load the sheet. */
function emptyInput(over: Partial<ServiceSheetInput> = {}): ServiceSheetInput {
  return {
    job_id: "job-1",
    call_type: "routine",
    call_type_other_desc: "",
    pest_species: ["Rats"],
    findings: "Droppings in the store room.",
    recommendations: "Bait stations installed.",
    report_notes: "",
    method_used: ["Rodenticide Used"],
    products_used: [],
    risk_level: "low",
    risk_comments: "No special hazards.",
    era_required: "",
    environmental_comments: "",
    photo_data_urls: [],
    technician_signature: "",
    client_present: false,
    client_signature: "",
    client_name: "",
    invoice_required: false,
    ...over,
  } as ServiceSheetInput;
}

const AT_RISK: SheetField[] = [
  "photo_urls",
  "client_present",
  "client_name",
  "needs_invoice",
  "technician_signature_url",
  "client_signature_url",
];

beforeEach(() => {
  lastUpdate = null;
  uploadedPaths.length = 0;
});

describe("amend with an empty submission", () => {
  it("omits every column it does not declare, so none can change", async () => {
    // The manifest a form produces when it loaded only the text fields —
    // exactly the pre-fix amend form.
    await saveServiceSheet("job-1", emptyInput(), {
      amend: true,
      fields: LEGACY_AMEND_FIELDS,
    });

    for (const col of AT_RISK) {
      expect(
        lastUpdate,
        `${col} must be ABSENT from the UPDATE, not written empty — this is ` +
          `the column that used to be destroyed`
      ).not.toHaveProperty(col);
    }
    // The declared text fields still save, so an amend still works.
    expect(lastUpdate).toHaveProperty("findings");
    expect(lastUpdate!.findings).toBe("Droppings in the store room.");
  });

  it("uploads nothing when it does not speak for the signatures", async () => {
    await saveServiceSheet(
      "job-1",
      emptyInput({ technician_signature: "data:image/png;base64,AAA" }),
      { amend: true, fields: LEGACY_AMEND_FIELDS }
    );
    expect(uploadedPaths).toEqual([]);
  });

  it("preserves at-risk columns for a legacy queued entry with no manifest", async () => {
    // An outbox entry queued by the previous build, replayed after this
    // one deploys. It carries no manifest; falling back to the columns the
    // old form genuinely owned is both correct for it and strictly safer
    // than the behaviour it was queued under.
    await saveServiceSheet("job-1", emptyInput(), { amend: true, fields: [] });
    for (const col of AT_RISK) {
      expect(lastUpdate).not.toHaveProperty(col);
    }
  });
});

describe("amend with a full submission", () => {
  it("writes every column it declares", async () => {
    await saveServiceSheet(
      "job-1",
      emptyInput({
        photo_data_urls: [
          "https://stub.supabase.co/storage/v1/object/public/reports/photos/abc.jpg",
        ],
        client_present: true,
        client_name: "John Lally",
        invoice_required: true,
        technician_signature: "data:image/png;base64,AAA",
        client_signature: "data:image/png;base64,BBB",
      }),
      { amend: true, fields: [...SHEET_FIELDS] }
    );

    expect(lastUpdate!.client_present).toBe(true);
    expect(lastUpdate!.client_name).toBe("John Lally");
    expect(lastUpdate!.needs_invoice).toBe(true);
    expect(lastUpdate!.photo_urls).toEqual([
      "https://stub.supabase.co/storage/v1/object/public/reports/photos/abc.jpg",
    ]);
    expect(lastUpdate!.technician_signature_url).toContain(
      "signatures/job-1/technician.png"
    );
    expect(lastUpdate!.client_signature_url).toContain(
      "signatures/job-1/client.png"
    );
  });

  it("an already-stored photo round-trips to the same URL", async () => {
    const stored =
      "https://stub.supabase.co/storage/v1/object/public/reports/photos/abc.jpg";
    await saveServiceSheet("job-1", emptyInput({ photo_data_urls: [stored] }), {
      amend: true,
      fields: [...SHEET_FIELDS],
    });
    // Re-derived from the object path, not echoed, so what lands in the
    // column is always our own bucket's canonical URL.
    expect(lastUpdate!.photo_urls).toEqual([stored]);
    expect(uploadedPaths).toEqual([]);
  });

  it("DELIBERATE clearing still clears", async () => {
    // Declared, and empty. That is the operator saying "remove this",
    // which must remain possible — the manifest is what separates it from
    // "the form never loaded it".
    await saveServiceSheet("job-1", emptyInput(), {
      amend: true,
      fields: [...SHEET_FIELDS],
    });
    expect(lastUpdate).toHaveProperty("client_signature_url");
    expect(lastUpdate!.client_signature_url).toBeNull();
    expect(lastUpdate!.photo_urls).toEqual([]);
    expect(lastUpdate!.client_present).toBe(false);
    expect(lastUpdate!.client_name).toBeNull();
    expect(lastUpdate!.needs_invoice).toBe(false);
  });

  it("removing ONE photo keeps the other", async () => {
    const a =
      "https://stub.supabase.co/storage/v1/object/public/reports/photos/a.jpg";
    await saveServiceSheet("job-1", emptyInput({ photo_data_urls: [a] }), {
      amend: true,
      fields: [...SHEET_FIELDS],
    });
    expect(lastUpdate!.photo_urls).toEqual([a]);
  });
});

describe("a fresh fill is unaffected", () => {
  it("still writes the whole sheet with no manifest", async () => {
    await saveServiceSheet("job-1", emptyInput());
    for (const col of AT_RISK) {
      expect(
        lastUpdate,
        `${col} must still be written on a fill — the job starts blank`
      ).toHaveProperty(col);
    }
    expect(lastUpdate).toHaveProperty("treatment");
  });
});

describe("the manifest itself", () => {
  it("round-trips", () => {
    const fields: SheetField[] = ["findings", "photo_urls"];
    expect(parseSheetFields(encodeSheetFields(fields))).toEqual(fields);
  });

  it("drops unknown names rather than trusting them", () => {
    // A malformed or hand-edited entry can only ever NARROW what may be
    // overwritten, never widen it.
    expect(parseSheetFields("findings,nonsense,../../etc,photo_urls")).toEqual([
      "findings",
      "photo_urls",
    ]);
    expect(parseSheetFields(null)).toEqual([]);
    expect(parseSheetFields("")).toEqual([]);
  });

  it("names every column the writer can touch", () => {
    // If someone adds a column to writeServiceSheet and forgets the
    // manifest, an amend silently stops being able to save it. Pin the
    // list against the writer's source so the omission is caught here.
    const src = readFileSync(join(process.cwd(), "lib/data/jobs.ts"), "utf8");
    const body = src.slice(
      src.indexOf("const patch: Record<string, unknown> = {}"),
      src.indexOf('.from("jobs")\n    .update(patch)')
    );
    const written = [...body.matchAll(/set\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(10);
    for (const col of written) {
      expect(
        SHEET_FIELDS as readonly string[],
        `writeServiceSheet writes "${col}" but it is not in SHEET_FIELDS, so ` +
          `an amend can never save it`
      ).toContain(col);
    }
  });
});
