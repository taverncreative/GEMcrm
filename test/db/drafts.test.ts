/**
 * Unit tests for lib/db/drafts.ts.
 *
 * Exercises the load/save/clear helpers against fake-indexeddb. These
 * are tiny and round-trippy on purpose — the value isn't catching
 * complex behaviour, it's catching schema typos and accidental
 * regressions when the ServiceSheetDraft shape changes.
 *
 * The Dexie schema bumped to v4 to add this table; opening the db here
 * forces that upgrade path to run in jsdom against fake-indexeddb. If
 * the schema is wrong (e.g. wrong primary-key name), put() throws and
 * the test fails loud.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadDraft,
  saveDraft,
  clearDraft,
  type ServiceSheetDraftInput,
} from "@/lib/db/drafts";
import { db } from "@/lib/db";

function makeInput(
  overrides: Partial<ServiceSheetDraftInput> = {}
): ServiceSheetDraftInput {
  return {
    job_id: "job-1",
    step: 1,
    call_type: "",
    selected_pests: [],
    selected_methods: [],
    findings: "",
    recommendations: "",
    pesticides_used: "",
    report_notes: "",
    risk_level: "low",
    risk_comments: "",
    client_name: "",
    tech_sig: "",
    client_sig: "",
    customer_present: "",
    photo_data_urls: [],
    schedule_follow_up: false,
    follow_up_date: "",
    ...overrides,
  };
}

beforeEach(async () => {
  // Clear the drafts table between tests so each one starts clean.
  // We touch the other tables too because some tests may indirectly
  // exercise jobs/customers via the form harness elsewhere.
  await db.service_sheet_drafts.clear();
});

describe("loadDraft / saveDraft / clearDraft", () => {
  it("loadDraft returns undefined when no draft exists", async () => {
    const result = await loadDraft("nonexistent-job");
    expect(result).toBeUndefined();
  });

  it("saveDraft + loadDraft round-trips every field", async () => {
    const input = makeInput({
      job_id: "job-round-trip",
      step: 3,
      call_type: "routine",
      selected_pests: ["Mice", "Rats"],
      selected_methods: ["Rodenticide Used", "Glueboards"],
      findings: "Droppings in kitchen.",
      recommendations: "Block entry points.",
      pesticides_used: "Bromadiolone 0.005%",
      report_notes: "Owner not on site.",
      risk_level: "medium",
      risk_comments: "Pets present in adjacent room.",
      client_name: "Jane Doe",
      tech_sig: "data:image/png;base64,TECH",
      client_sig: "data:image/png;base64,CLIENT",
      customer_present: "yes",
      photo_data_urls: ["photo-uuid-1", "photo-uuid-2"],
      schedule_follow_up: true,
      follow_up_date: "2026-06-12",
    });

    await saveDraft(input);
    const loaded = await loadDraft("job-round-trip");

    expect(loaded).toBeDefined();
    // updated_at is stamped by saveDraft — assert it's a string but
    // not its exact value (would require freezing Date which the
    // harness's no-Date-now rule precludes).
    expect(typeof loaded?.updated_at).toBe("string");
    expect(loaded?.updated_at.length).toBeGreaterThan(0);

    // Every other field round-trips verbatim.
    expect(loaded?.job_id).toBe(input.job_id);
    expect(loaded?.step).toBe(input.step);
    expect(loaded?.call_type).toBe(input.call_type);
    expect(loaded?.selected_pests).toEqual(input.selected_pests);
    expect(loaded?.selected_methods).toEqual(input.selected_methods);
    expect(loaded?.findings).toBe(input.findings);
    expect(loaded?.recommendations).toBe(input.recommendations);
    expect(loaded?.pesticides_used).toBe(input.pesticides_used);
    expect(loaded?.report_notes).toBe(input.report_notes);
    expect(loaded?.risk_level).toBe(input.risk_level);
    expect(loaded?.risk_comments).toBe(input.risk_comments);
    expect(loaded?.client_name).toBe(input.client_name);
    expect(loaded?.tech_sig).toBe(input.tech_sig);
    expect(loaded?.client_sig).toBe(input.client_sig);
    expect(loaded?.customer_present).toBe(input.customer_present);
    expect(loaded?.photo_data_urls).toEqual(input.photo_data_urls);
    expect(loaded?.schedule_follow_up).toBe(input.schedule_follow_up);
    expect(loaded?.follow_up_date).toBe(input.follow_up_date);
  });

  it("saveDraft overwrites an existing draft (last-write-wins)", async () => {
    await saveDraft(makeInput({ findings: "first save" }));
    await saveDraft(makeInput({ findings: "second save" }));
    const loaded = await loadDraft("job-1");
    expect(loaded?.findings).toBe("second save");
  });

  it("clearDraft deletes the row; loadDraft then returns undefined", async () => {
    await saveDraft(makeInput({ findings: "anything" }));
    expect(await loadDraft("job-1")).toBeDefined();

    await clearDraft("job-1");
    expect(await loadDraft("job-1")).toBeUndefined();
  });

  it("clearDraft on a non-existent job is a no-op (does not throw)", async () => {
    await expect(clearDraft("never-existed")).resolves.toBeUndefined();
  });

  it("saveDraft with empty job_id is a no-op (guard against bad calls)", async () => {
    // The form would only ever call this with a real jobId, but the
    // guard exists in case a future caller forgets — assert it.
    await saveDraft(makeInput({ job_id: "" }));
    const all = await db.service_sheet_drafts.toArray();
    expect(all).toHaveLength(0);
  });

  it("loadDraft with empty job_id returns undefined", async () => {
    expect(await loadDraft("")).toBeUndefined();
  });

  it("drafts for different jobs are independent", async () => {
    await saveDraft(makeInput({ job_id: "job-a", findings: "for a" }));
    await saveDraft(makeInput({ job_id: "job-b", findings: "for b" }));

    expect((await loadDraft("job-a"))?.findings).toBe("for a");
    expect((await loadDraft("job-b"))?.findings).toBe("for b");

    await clearDraft("job-a");
    expect(await loadDraft("job-a")).toBeUndefined();
    expect((await loadDraft("job-b"))?.findings).toBe("for b");
  });
});
