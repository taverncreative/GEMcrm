/**
 * Quick job capture (Q2) — optimistic applyLocal against real Dexie
 * (fake-indexeddb). The offline contract: a draft job lands locally
 * with job_status='draft', site_id=null, and the phrase in
 * capture_note — server never called at submit.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { quickCaptureMeta } from "@/components/jobs/quick-job-capture";

const baseInput = {
  jobId: "11111111-1111-4111-8111-111111111111",
  capture_note: "Sarah, Wasps, Folkestone",
  job_date: "2026-06-20",
  job_time: "09:00",
  job_time_end: "12:00",
};

beforeEach(async () => {
  await db.jobs.clear();
});

describe("quickCaptureMeta", () => {
  it("parseInput carries the phrase/date/window and mints a job id", () => {
    const fd = new FormData();
    fd.set("capture_note", "Sarah, Wasps, Folkestone");
    fd.set("job_date", "2026-06-20");
    fd.set("job_time", "09:00");
    fd.set("job_time_end", "12:00");
    const parsed = quickCaptureMeta.parseInput!(fd);
    expect(parsed).not.toBeNull();
    expect(parsed!.capture_note).toBe("Sarah, Wasps, Folkestone");
    expect(parsed!.job_date).toBe("2026-06-20");
    expect(parsed!.job_time).toBe("09:00");
    expect(parsed!.job_time_end).toBe("12:00");
    expect(parsed!.jobId).toMatch(/[0-9a-f-]{36}/);
  });

  it("parseInput → null when the phrase or date is blank (skips write+enqueue)", () => {
    const noPhrase = new FormData();
    noPhrase.set("capture_note", "");
    noPhrase.set("job_date", "2026-06-20");
    expect(quickCaptureMeta.parseInput!(noPhrase)).toBeNull();

    const noDate = new FormData();
    noDate.set("capture_note", "Wasps");
    noDate.set("job_date", "");
    expect(quickCaptureMeta.parseInput!(noDate)).toBeNull();
  });

  it("applyLocal writes a draft job: status=draft, site_id=null, phrase in capture_note", async () => {
    await quickCaptureMeta.applyLocal(baseInput);
    const row = await db.jobs.get(baseInput.jobId);
    expect(row).toBeTruthy();
    expect(row!.job_status).toBe("draft");
    expect(row!.site_id).toBeNull();
    expect(row!.capture_note).toBe("Sarah, Wasps, Folkestone");
    expect(row!.job_time).toBe("09:00");
    expect(row!.job_time_end).toBe("12:00");
    expect(row!.reference_number).toBeNull();
  });

  it("op is 'create' and entityIds lists only the new job id", () => {
    expect(quickCaptureMeta.op).toBe("create");
    expect(quickCaptureMeta.entityIds!(baseInput)).toEqual([baseInput.jobId]);
    expect(quickCaptureMeta.entityId(baseInput)).toBe(baseInput.jobId);
  });

  it("replayArgs injects the client job id so server == local", () => {
    const args = quickCaptureMeta.replayArgs!(baseInput, new FormData());
    expect(args.job_id).toBe(baseInput.jobId);
    expect(args.capture_note).toBe("Sarah, Wasps, Folkestone");
  });
});
