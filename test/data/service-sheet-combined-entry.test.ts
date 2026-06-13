/**
 * Combined service-sheet completion entry (offline-pwa pass B).
 *
 * Pins the pieces the optimistic submit is built from, against real
 * fake-indexeddb Dexie + the real outbox:
 *
 *   - parseServiceSheetFormData carries the finalize flag;
 *   - applyLocal completes the job locally when finalize is set and
 *     keeps the legacy in_progress shape when it isn't;
 *   - the enqueued entry shape: ONE update entry whose args hold the
 *     whole payload (finalize + email/follow-up choices + signatures
 *     inline as data URLs);
 *   - compaction folds a re-submitted sheet into ONE entry carrying
 *     the LATEST payload (update+update → keep new);
 *   - validateServiceSheetFormData supplies the client-side field
 *     errors the server's Zod bounce used to provide;
 *   - conflict surface: the action's "Job not found" failure result
 *     classifies as a client-error — drainOutbox retries then marks
 *     stuck → conflicts inbox (drain behaviour covered in test/sync).
 *
 * The optimistic wrapper path itself (no server call at submit,
 * localSuccessState flip) is pinned generically in
 * test/actions/wrap-additive.test.tsx.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { enqueueAction } from "@/lib/db/outbox";
import { formDataToObject } from "@/lib/actions/wrap";
import { classifyActionResult } from "@/lib/sync/http-classify";
import {
  completeServiceSheetMeta,
  parseServiceSheetFormData,
  validateServiceSheetFormData,
} from "@/components/jobs/service-sheet-form";
import type { Job } from "@/types/database";

const JOB_ID = "33333333-3333-4333-8333-333333333333";

const TINY_SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==";

function sheetFormData(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("job_id", JOB_ID);
  fd.set("call_type", "routine");
  fd.set("pest_species", JSON.stringify(["Rats"]));
  fd.set("findings", "Combined-entry findings");
  fd.set("recommendations", "Combined-entry recommendations");
  fd.set("report_notes", "");
  fd.set("method_used", JSON.stringify(["Bait"]));
  fd.set("pesticides_used", "Blocks");
  fd.set("risk_level", "low");
  fd.set("risk_comments", "None");
  fd.set("photo_data_urls", JSON.stringify([]));
  fd.set("technician_signature", TINY_SIG);
  fd.set("client_present", "");
  fd.set("client_signature", "");
  fd.set("client_name", "");
  fd.set("schedule_follow_up", "");
  fd.set("follow_up_date", "");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function seedJob(job_status: Job["job_status"]): Job {
  return {
    id: JOB_ID,
    site_id: "44444444-4444-4444-8444-444444444444",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    deleted_at: null,
    job_date: "2026-06-09",
    job_time: null,
    job_time_end: null,
    capture_note: null,
    call_type: "routine",
    pest_species: [],
    findings: null,
    recommendations: null,
    treatment: null,
    pesticides_used: null,
    risk_level: null,
    risk_comments: null,
    technician_signature_url: null,
    client_signature_url: null,
    job_status,
    agreement_id: null,
    environmental_risk: null,
    environmental_comments: null,
    protected_species_present: false,
    method_used: [],
    photo_urls: [],
    client_present: false,
    client_name: null,
    report_notes: null,
    value: null,
    is_invoiced: false,
    is_paid: false,
    report_emailed_to: null,
    report_emailed_at: null,
    reference_number: null,
    parent_job_id: null,
  };
}

beforeEach(async () => {
  await db.jobs.clear();
  await db.outbox.clear();
});

describe("parseServiceSheetFormData — finalize flag", () => {
  it("finalize='true' → finalize: true; absent → false", () => {
    expect(
      parseServiceSheetFormData(sheetFormData({ finalize: "true" }))?.finalize
    ).toBe(true);
    expect(parseServiceSheetFormData(sheetFormData())?.finalize).toBe(false);
  });

  it("invalid sheet (missing findings) → null", () => {
    expect(
      parseServiceSheetFormData(sheetFormData({ findings: "" }))
    ).toBeNull();
  });
});

describe("applyLocal — finalize-aware status", () => {
  it("finalize → job_status completed locally", async () => {
    await db.jobs.put(seedJob("in_progress"));
    const input = parseServiceSheetFormData(
      sheetFormData({ finalize: "true" })
    )!;
    await completeServiceSheetMeta.applyLocal(input);
    const row = await db.jobs.get(JOB_ID);
    expect(row?.job_status).toBe("completed");
    expect(row?.findings).toBe("Combined-entry findings");
  });

  it("without finalize → legacy in_progress shape", async () => {
    await db.jobs.put(seedJob("scheduled"));
    const input = parseServiceSheetFormData(sheetFormData())!;
    await completeServiceSheetMeta.applyLocal(input);
    expect((await db.jobs.get(JOB_ID))?.job_status).toBe("in_progress");
  });

  // L2 amend: editing a COMPLETED sheet must update fields locally but
  // NEVER touch job_status — the local row must not lie about a
  // downgrade the server will refuse.
  it("amend → fields update, job_status stays completed", async () => {
    await db.jobs.put(seedJob("completed"));
    const input = parseServiceSheetFormData(sheetFormData({ amend: "true" }))!;
    expect(input.amend).toBe(true);
    expect(input.finalize).toBe(false);
    await completeServiceSheetMeta.applyLocal(input);
    const row = await db.jobs.get(JOB_ID);
    expect(row?.job_status).toBe("completed");
    expect(row?.findings).toBe("Combined-entry findings");
  });
});

describe("combined outbox entry — shape + compaction", () => {
  function enqueueLikeTheWrapper(fd: FormData) {
    const input = parseServiceSheetFormData(fd)!;
    return enqueueAction({
      action_name: completeServiceSheetMeta.actionName,
      args: formDataToObject(fd),
      entity_type: completeServiceSheetMeta.entityType,
      entity_id: completeServiceSheetMeta.entityId(input),
    });
  }

  it("ONE update entry; args carry finalize, email choice, and inline signature", async () => {
    await enqueueLikeTheWrapper(
      sheetFormData({ finalize: "true", send_email: "true" })
    );

    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.action_name).toBe("completeServiceSheetAction");
    expect(entry.entity_type).toBe("job");
    expect(entry.entity_id).toBe(JOB_ID);
    const args = entry.args as Record<string, string>;
    expect(args.finalize).toBe("true");
    expect(args.send_email).toBe("true");
    expect(args.technician_signature).toBe(TINY_SIG); // inline data URL (fork B2)
  });

  it("re-submission compacts to ONE entry with the LATEST payload", async () => {
    await enqueueLikeTheWrapper(sheetFormData({ finalize: "true" }));
    await enqueueLikeTheWrapper(
      sheetFormData({ finalize: "true", findings: "Edited after review" })
    );

    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    expect((entries[0].args as Record<string, string>).findings).toBe(
      "Edited after review"
    );
  });
});

describe("client-side validation (replaces the server Zod bounce)", () => {
  it("maps missing fields to the same keys the form renders", () => {
    const errors = validateServiceSheetFormData(
      sheetFormData({ findings: "", technician_signature: "" })
    );
    expect(errors).not.toBeNull();
    expect(errors!.findings).toBeTruthy();
    expect(errors!.technician_signature).toBeTruthy();
  });

  it("valid sheet → null", () => {
    expect(validateServiceSheetFormData(sheetFormData())).toBeNull();
  });
});

describe("conflict surface — deleted-job replay classification", () => {
  it("'Job not found' result classifies as client-error (→ retries → stuck → inbox)", () => {
    const outcome = classifyActionResult({
      success: false,
      errors: {},
      message: "Job not found",
    });
    expect(outcome.kind).toBe("client-error");
    expect(
      outcome.kind === "client-error" ? outcome.message : null
    ).toContain("Job not found");
  });
});
