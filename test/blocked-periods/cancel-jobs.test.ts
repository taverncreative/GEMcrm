/**
 * applyJobCancellations — the CANCEL action from the block-out resolve list.
 *
 * Pins:
 *   - a successful delete soft-deletes the job locally (deleted_at mirrored
 *     into Dexie) and is reported in `cancelled`;
 *   - a failed delete (e.g. offline — job soft-delete is online-only) is
 *     collected in `failures`, NEVER thrown, and the Dexie row is left intact
 *     — so the block-out (saved by the caller beforehand) is never gated by a
 *     job-action failure;
 *   - a mix processes every id independently.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { applyJobCancellations } from "@/lib/blocked-periods/cancel-jobs";
import type { Job } from "@/types/database";

function addJob(id: string) {
  return db.jobs.add({
    id,
    site_id: "site-A",
    job_date: "2026-07-29",
    job_status: "scheduled",
    call_type: "routine",
    is_archived: false,
    deleted_at: null,
    agreement_id: null,
  } as unknown as Job);
}

beforeEach(async () => {
  await db.jobs.clear();
});

describe("applyJobCancellations", () => {
  it("soft-deletes a job on success and mirrors deleted_at into Dexie", async () => {
    await addJob("j1");
    const del = vi.fn(async () => ({ success: true }));

    const res = await applyJobCancellations(["j1"], del);

    expect(del).toHaveBeenCalledWith("j1");
    expect(res.cancelled).toEqual(["j1"]);
    expect(res.failures).toEqual([]);
    expect((await db.jobs.get("j1"))?.deleted_at).toBeTruthy();
  });

  it("collects a failed delete without throwing and leaves the row intact", async () => {
    await addJob("j1");
    const del = vi.fn(async () => ({
      success: false,
      message: "Couldn't save — connection lost.",
    }));

    const res = await applyJobCancellations(["j1"], del);

    expect(res.cancelled).toEqual([]);
    expect(res.failures).toEqual([
      { id: "j1", message: "Couldn't save — connection lost." },
    ]);
    // Not soft-deleted locally — the job is untouched.
    expect((await db.jobs.get("j1"))?.deleted_at).toBeNull();
  });

  it("treats a thrown delete as a failure (never propagates)", async () => {
    await addJob("j1");
    const del = vi.fn(async () => {
      throw new Error("boom");
    });

    const res = await applyJobCancellations(["j1"], del);
    expect(res.failures.map((f) => f.id)).toEqual(["j1"]);
    expect((await db.jobs.get("j1"))?.deleted_at).toBeNull();
  });

  it("processes a mix — cancels the good ones, collects the bad ones", async () => {
    await addJob("ok1");
    await addJob("bad");
    await addJob("ok2");
    const del = vi.fn(async (id: string) =>
      id === "bad" ? { success: false, message: "nope" } : { success: true }
    );

    const res = await applyJobCancellations(["ok1", "bad", "ok2"], del);

    expect(res.cancelled.sort()).toEqual(["ok1", "ok2"]);
    expect(res.failures.map((f) => f.id)).toEqual(["bad"]);
    expect((await db.jobs.get("ok1"))?.deleted_at).toBeTruthy();
    expect((await db.jobs.get("ok2"))?.deleted_at).toBeTruthy();
    expect((await db.jobs.get("bad"))?.deleted_at).toBeNull();
  });

  it("empty list is a no-op", async () => {
    const del = vi.fn();
    const res = await applyJobCancellations([], del);
    expect(res).toEqual({ cancelled: [], failures: [] });
    expect(del).not.toHaveBeenCalled();
  });
});
