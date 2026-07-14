/**
 * Service sheet from scratch — the meta layer.
 *
 * The from-scratch flow reuses the booking meta but starts the job
 * "in_progress" (being worked on, not a phantom scheduled booking) and
 * carries a component-minted job id so the modal can navigate to
 * /jobs/[id]/complete. Pins:
 *   - a provided job_id is used verbatim (so the id the modal routes to is
 *     the id written to Dexie), and job_status "in_progress" is written;
 *   - a real existing site is kept (so the job is immediately completable);
 *   - a PAST date is accepted (back-dating a visit that already happened);
 *   - the booking path (no job_status/job_id) still defaults to a minted id
 *     and "scheduled".
 */
import { describe, it, expect, beforeEach } from "vitest";
import { makeBookingMeta } from "@/components/bookings/booking-modal";
import { db } from "@/lib/db";

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

const meta = makeBookingMeta();

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
});

describe("makeBookingMeta — service-sheet intent", () => {
  it("uses the provided job_id + in_progress status, keeps the real site, allows a past date", async () => {
    const input = meta.parseInput!(
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "cust-1",
        site_id: "site-1",
        job_status: "in_progress",
        job_id: "job-xyz",
        job_date: "2026-07-01", // a few days in the past
      })
    )!;
    expect(input).not.toBeNull();
    expect(input.jobId).toBe("job-xyz");
    expect(input.siteId).toBe("site-1");
    expect(input.newSiteId).toBeNull(); // reused an existing site
    expect(input.fields.job_status).toBe("in_progress");
    expect(input.fields.job_date).toBe("2026-07-01");

    await meta.applyLocal(input);
    const job = await db.jobs.get("job-xyz");
    expect(job!.job_status).toBe("in_progress");
    expect(job!.site_id).toBe("site-1"); // real site → immediately completable
    expect(job!.job_date).toBe("2026-07-01");
  });

  it("booking path (no job_status / job_id) defaults to a minted id + scheduled", () => {
    const input = meta.parseInput!(
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "cust-1",
        site_id: "site-1",
        job_date: "2026-08-01",
      })
    )!;
    expect(input.jobId).toBeTruthy();
    expect(input.jobId).not.toBe("job-xyz");
    expect(input.fields.job_status).toBe("scheduled");
  });
});
