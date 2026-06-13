/**
 * makeBookingMeta — UPGRADE mode (Q3, draftJobId set).
 *
 * The same modal meta, branched for attach-to-draft. Pins the
 * upgrade-specific divergences from the create path:
 *   - actionName + op switch to the upgrade action / "update";
 *   - jobId reuses the DRAFT id (no fresh mint) → entityId is the draft;
 *   - entityIds lists ONLY newly-created customer/site — NEVER the
 *     pre-existing draft job (Fork A: keeps revertLocalCreate off the
 *     draft, and op:"update" means it wouldn't fire anyway);
 *   - applyLocal UPDATEs the existing draft in place (status → scheduled,
 *     site attached) and PRESERVES capture_note + leaves reference_number
 *     null (server fills on replay) — it does NOT insert a second row;
 *   - replayArgs addresses the draft via draft_job_id, not job_id.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { makeBookingMeta } from "@/components/bookings/booking-modal";
import { db } from "@/lib/db";
import type { Job } from "@/types/database";

const DRAFT_ID = "33333333-3333-4333-8333-333333333333";

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

const meta = makeBookingMeta(DRAFT_ID);

const existingFd = () =>
  fd({
    mode_customer: "existing",
    mode_site: "existing",
    customer_id: "cust-1",
    site_id: "site-1",
    job_date: "2026-07-01",
    job_time: "09:00",
    job_time_end: "12:00",
    call_type: "routine",
  });

const allNewFd = () =>
  fd({
    mode_customer: "new",
    mode_site: "new",
    customer_name: "Acme",
    customer_company: "Acme Ltd",
    customer_type: "commercial",
    site_line1: "1 Way",
    site_town: "Town",
    site_postcode: "t1 1aa",
    job_date: "2026-07-01",
    call_type: "callout",
  });

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
});

describe("makeBookingMeta — upgrade mode", () => {
  it("actionName + op switch to upgrade; jobId/entityId is the draft id", () => {
    expect(meta.actionName).toBe("upgradeDraftToBookingAction");
    expect(meta.op).toBe("update");
    const input = meta.parseInput!(existingFd())!;
    expect(input.jobId).toBe(DRAFT_ID); // reuses the draft id, no fresh mint
    expect(meta.entityId(input)).toBe(DRAFT_ID);
  });

  it("entityIds lists ONLY new customer/site — never the draft job (Fork A)", () => {
    const existing = meta.parseInput!(existingFd())!;
    expect(meta.entityIds!(existing)).toEqual([]); // nothing new; draft NOT listed

    const allNew = meta.parseInput!(allNewFd())!;
    const ids = meta.entityIds!(allNew);
    expect(ids).toContain(allNew.newCustomerId);
    expect(ids).toContain(allNew.newSiteId);
    expect(ids).not.toContain(DRAFT_ID);
    expect(ids).toHaveLength(2);
  });

  it("applyLocal UPDATEs the draft in place: site set, scheduled, capture_note kept, ref null", async () => {
    await db.jobs.add({
      id: DRAFT_ID,
      site_id: null,
      job_status: "draft",
      capture_note: "Sarah, Wasps, Folkestone",
      job_date: "2026-06-01",
      call_type: null,
      pest_species: [],
      reference_number: null,
      is_archived: false,
      deleted_at: null,
    } as unknown as Job);

    const input = meta.parseInput!(existingFd())!;
    await meta.applyLocal(input);

    const row = await db.jobs.get(DRAFT_ID);
    expect(row!.job_status).toBe("scheduled");
    expect(row!.site_id).toBe("site-1");
    expect(row!.job_date).toBe("2026-07-01");
    expect(row!.call_type).toBe("routine");
    expect(row!.job_time).toBe("09:00");
    expect(row!.job_time_end).toBe("12:00");
    // capture_note persists (omitted from the update).
    expect(row!.capture_note).toBe("Sarah, Wasps, Folkestone");
    // reference_number stays null — the server computes it on replay.
    expect(row!.reference_number).toBeNull();
    // No second job row was inserted.
    expect(await db.jobs.count()).toBe(1);
  });

  it("applyLocal also writes a brand-new customer + site at upgrade time", async () => {
    await db.jobs.add({
      id: DRAFT_ID,
      site_id: null,
      job_status: "draft",
      capture_note: "note",
      reference_number: null,
    } as unknown as Job);

    const input = meta.parseInput!(allNewFd())!;
    await meta.applyLocal(input);

    const c = await db.customers.get(input.newCustomerId!);
    const s = await db.sites.get(input.newSiteId!);
    const j = await db.jobs.get(DRAFT_ID);
    expect(c?.name).toBe("Acme");
    expect(s?.customer_id).toBe(input.newCustomerId);
    expect(s?.postcode).toBe("T1 1AA"); // upper-cased
    expect(j?.site_id).toBe(input.newSiteId);
    expect(j?.job_status).toBe("scheduled");
  });

  it("replayArgs injects draft_job_id (not job_id) + the new ids", () => {
    const formData = allNewFd();
    const input = meta.parseInput!(formData)!;
    const args = meta.replayArgs!(input, formData);
    expect(args.draft_job_id).toBe(DRAFT_ID);
    expect(args.customer_id_new).toBe(input.newCustomerId);
    expect(args.site_id_new).toBe(input.newSiteId);
    expect(args.job_id).toBeUndefined(); // upgrade addresses via draft_job_id
  });
});
