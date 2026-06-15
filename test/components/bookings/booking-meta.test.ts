/**
 * Booking local-first meta (step 8 — offline New Booking).
 *
 * Tests the WrapMeta the modal hands to useLocalFirstAction:
 *   - parseInput generates client UUIDs (job always; new customer/site
 *     only in "new" mode) and resolves the ids the job hangs off.
 *   - parseInput returns null on an incomplete submit (no broken local
 *     booking).
 *   - applyLocal writes the job (+ any new customer/site) to Dexie.
 *   - entityIds returns ONLY newly-created ids (discard-revert safety).
 *   - replayArgs carries the ids so server replay matches local rows.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { bookingMeta } from "@/components/bookings/booking-modal";
import { db } from "@/lib/db";

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
});

describe("bookingMeta.parseInput", () => {
  it("existing customer + existing site: generates only a job id, reuses ids", () => {
    const input = bookingMeta.parseInput!(
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "cust-existing",
        site_id: "site-existing",
        job_date: "2026-07-01",
        call_type: "routine",
      })
    );
    expect(input).not.toBeNull();
    expect(input!.jobId).toMatch(UUID_RE);
    expect(input!.newCustomerId).toBeNull();
    expect(input!.newSiteId).toBeNull();
    expect(input!.customerId).toBe("cust-existing");
    expect(input!.siteId).toBe("site-existing");
  });

  it("new customer + new site: generates fresh ids and routes the job to them", () => {
    const input = bookingMeta.parseInput!(
      fd({
        mode_customer: "new",
        mode_site: "new",
        customer_name: "Acme",
        customer_type: "commercial",
        site_line1: "1 Way",
        site_town: "Town",
        site_postcode: "T1 1AA",
        job_date: "2026-07-01",
        call_type: "callout",
      })
    );
    expect(input!.newCustomerId).toMatch(UUID_RE);
    expect(input!.newSiteId).toMatch(UUID_RE);
    // The job hangs off the newly-created ids.
    expect(input!.customerId).toBe(input!.newCustomerId);
    expect(input!.siteId).toBe(input!.newSiteId);
  });

  it("ACCEPTS a sparse submit (missing call_type) into the optimistic path", () => {
    // call_type is optional now (quick add) — a missing one must NOT drop
    // the booking to the online-only path; it still writes locally + syncs.
    const input = bookingMeta.parseInput!(
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "c",
        site_id: "s",
        job_date: "2026-07-01",
        // call_type missing
      })
    );
    expect(input).not.toBeNull();
    expect(input!.fields.call_type).toBe("");
  });

  it("returns null on a genuinely incomplete submit (no date)", () => {
    const input = bookingMeta.parseInput!(
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "c",
        site_id: "s",
        // job_date missing — still the booking minimum
      })
    );
    expect(input).toBeNull();
  });
});

describe("bookingMeta.applyLocal", () => {
  it("writes a job for the existing-customer case", async () => {
    const input = bookingMeta.parseInput!(
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "cust-existing",
        site_id: "site-existing",
        job_date: "2026-07-01",
        call_type: "routine",
      })
    )!;
    await bookingMeta.applyLocal(input);

    const jobRow = await db.jobs.get(input.jobId);
    expect(jobRow).toBeDefined();
    expect(jobRow!.site_id).toBe("site-existing");
    expect(jobRow!.job_status).toBe("scheduled");
    // reference_number is null until the server computes it on sync.
    expect(jobRow!.reference_number).toBeNull();
    expect(jobRow!.is_archived).toBe(false);
  });

  it("writes customer + site + job for the all-new case", async () => {
    const input = bookingMeta.parseInput!(
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
      })
    )!;
    await bookingMeta.applyLocal(input);

    const c = await db.customers.get(input.newCustomerId!);
    const s = await db.sites.get(input.newSiteId!);
    const j = await db.jobs.get(input.jobId);
    expect(c?.name).toBe("Acme");
    expect(c?.company_name).toBe("Acme Ltd");
    expect(s?.customer_id).toBe(input.newCustomerId);
    expect(s?.postcode).toBe("T1 1AA"); // upper-cased
    expect(j?.site_id).toBe(input.newSiteId);
  });
});

describe("bookingMeta.entityIds — only newly-created ids", () => {
  it("existing customer+site: entityIds is just the job id", () => {
    const input = bookingMeta.parseInput!(
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "cust-existing",
        site_id: "site-existing",
        job_date: "2026-07-01",
        call_type: "routine",
      })
    )!;
    const ids = bookingMeta.entityIds!(input);
    expect(ids).toEqual([input.jobId]);
    // The existing customer/site ids are NOT present — discard-revert
    // can never delete them.
    expect(ids).not.toContain("cust-existing");
    expect(ids).not.toContain("site-existing");
  });

  it("all-new: entityIds is [newCustomer, newSite, job]", () => {
    const input = bookingMeta.parseInput!(
      fd({
        mode_customer: "new",
        mode_site: "new",
        customer_name: "Acme",
        customer_type: "commercial",
        site_line1: "1 Way",
        site_town: "Town",
        site_postcode: "T1 1AA",
        job_date: "2026-07-01",
        call_type: "callout",
      })
    )!;
    const ids = bookingMeta.entityIds!(input);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(input.newCustomerId);
    expect(ids).toContain(input.newSiteId);
    expect(ids).toContain(input.jobId);
  });
});

describe("bookingMeta.replayArgs — ids carried for deterministic replay", () => {
  it("injects job_id / customer_id_new / site_id_new alongside the form fields", () => {
    const formData = fd({
      mode_customer: "new",
      mode_site: "new",
      customer_name: "Acme",
      customer_type: "commercial",
      site_line1: "1 Way",
      site_town: "Town",
      site_postcode: "T1 1AA",
      job_date: "2026-07-01",
      call_type: "callout",
    });
    const input = bookingMeta.parseInput!(formData)!;
    const args = bookingMeta.replayArgs!(input, formData);
    expect(args.job_id).toBe(input.jobId);
    expect(args.customer_id_new).toBe(input.newCustomerId);
    expect(args.site_id_new).toBe(input.newSiteId);
    // Original form fields preserved.
    expect(args.call_type).toBe("callout");
    expect(args.customer_name).toBe("Acme");
  });

  it("op is 'create'", () => {
    expect(bookingMeta.op).toBe("create");
  });
});
