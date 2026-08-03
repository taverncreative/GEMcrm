/**
 * END-TO-END amend safety, against the REAL local Postgres.
 *
 * The sibling test (amend-preserves-sheet) asserts the shape of the UPDATE
 * with the database stubbed. This one runs the real `writeServiceSheet`
 * against the real local stack and reads the row back before and after,
 * because "the column is byte-identical afterwards" is the actual promise
 * being made and a stub cannot prove it.
 *
 * Only `@/lib/supabase/server`'s `createClient` is replaced, and only
 * because it reads Next's request cookies — the client handed back is a
 * genuine supabase-js service-role client pointed at the local stack. Every
 * line of the writer under test is the real one.
 *
 * SKIPPED automatically when the local stack isn't running, so this never
 * breaks CI or a machine without Docker up.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function env(key: string): string {
  const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  const line = raw.split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const admin =
  URL_ && KEY
    ? createSupabaseClient(URL_, KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const { createClient: mk } = await import("@supabase/supabase-js");
    return mk(
      readFileSync(join(process.cwd(), ".env.local"), "utf8")
        .split("\n")
        .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="))!
        .slice("NEXT_PUBLIC_SUPABASE_URL=".length)
        .trim(),
      readFileSync(join(process.cwd(), ".env.local"), "utf8")
        .split("\n")
        .find((l) => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))!
        .slice("SUPABASE_SERVICE_ROLE_KEY=".length)
        .trim(),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  },
}));

// Signature upload is the one thing we do NOT want hitting Storage on every
// run; the path it returns is deterministic and is what the column stores.
const uploadedPaths: string[] = [];
vi.mock("@/lib/storage/upload", () => ({
  uploadBase64Image: async (_d: string, path: string) => {
    uploadedPaths.push(path);
    return `${
      readFileSync(join(process.cwd(), ".env.local"), "utf8")
        .split("\n")
        .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="))!
        .slice("NEXT_PUBLIC_SUPABASE_URL=".length)
        .trim()
    }/storage/v1/object/public/reports/${path}`;
  },
  uploadPdf: async () => "https://stub/pdf",
}));

import { saveServiceSheet } from "@/lib/data/jobs";
import { SHEET_FIELDS, LEGACY_AMEND_FIELDS } from "@/lib/data/sheet-fields";
import type { ServiceSheetInput } from "@/lib/validation/service-sheet";

const JOB = "dddddddd-0000-4000-8000-000000000003";
const BASE = URL_;
const TECH = `${BASE}/storage/v1/object/public/reports/signatures/${JOB}/technician.png`;
const CLIENT = `${BASE}/storage/v1/object/public/reports/signatures/${JOB}/client.png`;
const P1 = `${BASE}/storage/v1/object/public/reports/photos/11111111-1111-4111-8111-111111111111.jpg`;
const P2 = `${BASE}/storage/v1/object/public/reports/photos/22222222-2222-4222-8222-222222222222.jpg`;

const COLUMNS =
  "technician_signature_url, client_signature_url, client_present, client_name, photo_urls, needs_invoice, findings, recommendations, risk_comments, call_type, pest_species";

let live = false;

async function readRow() {
  const { data } = await admin!.from("jobs").select(COLUMNS).eq("id", JOB).single();
  return data as Record<string, unknown>;
}

/** Put the fixture back to a fully-populated completed sheet. */
async function resetFixture() {
  await admin!
    .from("jobs")
    .update({
      job_status: "completed",
      findings: "Droppings found in the rear store room.",
      recommendations: "Bait stations installed; review in 7 days.",
      risk_comments: "Standard rodent treatment, no special hazards.",
      technician_signature_url: TECH,
      client_signature_url: CLIENT,
      photo_urls: [P1, P2],
      client_present: true,
      client_name: "John Lally",
      needs_invoice: true,
    })
    .eq("id", JOB);
}

/** The submission an amend form produces. */
function amendInput(over: Partial<ServiceSheetInput> = {}): ServiceSheetInput {
  return {
    job_id: JOB,
    call_type: "routine",
    call_type_other_desc: "",
    pest_species: ["Rats"],
    findings: "Droppings found in the rear store room.",
    recommendations: "Bait stations installed; review in 7 days.",
    report_notes: "",
    method_used: ["Rodenticide Used"],
    products_used: [],
    risk_level: "low",
    risk_comments: "Standard rodent treatment, no special hazards.",
    era_required: "",
    environmental_comments: "",
    // A fixed form now hands back what it loaded.
    photo_data_urls: [P1, P2],
    // A fixed form fetches the stored signatures and hands them back as
    // data URLs, so they re-upload to the same deterministic key.
    technician_signature: "data:image/png;base64,VEVDSA==",
    client_signature: "data:image/png;base64,Q0xJRU5U",
    client_present: true,
    client_name: "John Lally",
    invoice_required: true,
    ...over,
  } as ServiceSheetInput;
}

beforeAll(async () => {
  if (!admin) return;
  const { error } = await admin.from("jobs").select("id").eq("id", JOB).single();
  live = !error;
  if (!live) {
    console.warn("[amend-live-db] local stack unavailable — skipping");
  }
});

beforeEach(async () => {
  uploadedPaths.length = 0;
  if (live) await resetFixture();
});

describe("amend against the live local database", () => {
  it("an amend that changes NOTHING leaves every column byte-identical", async () => {
    if (!live) return;
    const before = await readRow();

    // The signatures were not re-fetched (offline, say), so the form does
    // not claim them. Everything else it loaded and hands back.
    await saveServiceSheet(JOB, amendInput(), {
      amend: true,
      fields: SHEET_FIELDS.filter(
        (f) =>
          f !== "technician_signature_url" && f !== "client_signature_url"
      ),
    });

    const after = await readRow();
    expect(after).toEqual(before);
  });

  it("the pre-fix submission can no longer destroy anything", async () => {
    if (!live) return;
    const before = await readRow();

    // Exactly what the OLD amend form sent: empty sign-off, no photos.
    // Before this fix that nulled the client signature, flipped
    // client_present, nulled client_name, cleared needs_invoice and
    // deleted both photos.
    await saveServiceSheet(
      JOB,
      amendInput({
        photo_data_urls: [],
        client_present: false,
        client_name: "",
        invoice_required: false,
        technician_signature: "data:image/png;base64,QUJD",
      }),
      { amend: true, fields: LEGACY_AMEND_FIELDS }
    );

    const after = await readRow();
    expect(after.client_signature_url).toBe(before.client_signature_url);
    expect(after.technician_signature_url).toBe(before.technician_signature_url);
    expect(after.photo_urls).toEqual(before.photo_urls);
    expect(after.client_present).toBe(before.client_present);
    expect(after.client_name).toBe(before.client_name);
    expect(after.needs_invoice).toBe(before.needs_invoice);
    expect(uploadedPaths).toEqual([]);
  });

  it("changing only findings changes only findings", async () => {
    if (!live) return;
    const before = await readRow();
    await saveServiceSheet(
      JOB,
      amendInput({ findings: "Amended: activity now in the bin store." }),
      { amend: true, fields: [...SHEET_FIELDS] }
    );
    const after = await readRow();

    expect(after.findings).toBe("Amended: activity now in the bin store.");
    for (const col of Object.keys(before)) {
      if (col === "findings") continue;
      expect(after[col], `${col} must not have changed`).toEqual(before[col]);
    }
  });

  it("deliberately clearing the client signature clears ONLY that column", async () => {
    if (!live) return;
    const before = await readRow();
    // Declared and empty = the operator cleared it.
    await saveServiceSheet(JOB, amendInput({ client_signature: "" }), {
      amend: true,
      fields: [...SHEET_FIELDS],
    });
    const after = await readRow();

    expect(after.client_signature_url).toBeNull();
    expect(after.technician_signature_url).toBe(before.technician_signature_url);
    expect(after.photo_urls).toEqual(before.photo_urls);
    expect(after.client_name).toBe(before.client_name);
  });

  it("removing ONE photo removes exactly that one", async () => {
    if (!live) return;
    const before = await readRow();
    await saveServiceSheet(JOB, amendInput({ photo_data_urls: [P1] }), {
      amend: true,
      fields: [...SHEET_FIELDS],
    });
    const after = await readRow();

    expect(after.photo_urls).toEqual([P1]);
    expect(before.photo_urls).toEqual([P1, P2]);
    expect(after.technician_signature_url).toBe(before.technician_signature_url);
    expect(after.client_signature_url).toBe(before.client_signature_url);
  });

  it("re-signing uploads to the same key, so the URL stays identical", async () => {
    if (!live) return;
    const before = await readRow();
    await saveServiceSheet(
      JOB,
      amendInput({ technician_signature: "data:image/png;base64,QUJD" }),
      { amend: true, fields: [...SHEET_FIELDS] }
    );
    const after = await readRow();

    expect(uploadedPaths).toContain(`signatures/${JOB}/technician.png`);
    // Deterministic key, no cache-buster: the column string does not move.
    expect(after.technician_signature_url).toBe(before.technician_signature_url);
    expect(after.client_signature_url).toBe(before.client_signature_url);
  });
});
