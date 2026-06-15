/**
 * makeBookingMeta — CREATE mode, sparse (quick-add) bookings (Pass 1b).
 *
 * A booking's minimum is a customer name + date; site address + call type
 * are optional. The fix here is OFFLINE PARITY: a sparse booking must still
 * take the optimistic local-first path (parseInput returns non-null →
 * applyLocal writes to Dexie + an outbox entry is enqueued), instead of
 * falling through to the online-only server path.
 *
 * Pins:
 *   - a name + date booking with NO call type and NO site still returns a
 *     non-null input AND mints a bare site id (so it syncs like any other);
 *   - applyLocal writes the bare site (null address, "—" county) + a
 *     scheduled job with null call_type.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { makeBookingMeta } from "@/components/bookings/booking-modal";
import { db } from "@/lib/db";

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

const meta = makeBookingMeta(); // create mode (no draft id)

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
});

describe("makeBookingMeta — sparse create (offline parity)", () => {
  it("new customer + date only (no call type, no site) → non-null input, bare site minted", () => {
    const input = meta.parseInput!(
      fd({
        mode_customer: "new",
        mode_site: "new",
        customer_name: "Quick Add",
        customer_type: "commercial",
        job_date: "2026-07-01",
        // no call_type, no site address
      })
    );
    expect(input).not.toBeNull();
    expect(input!.newCustomerId).toBeTruthy();
    expect(input!.newSiteId).toBeTruthy();
    expect(input!.siteId).toBe(input!.newSiteId);
    expect(input!.fields.call_type).toBe("");
  });

  it("existing customer with NO site selected → mints a bare site (create only)", () => {
    const input = meta.parseInput!(
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "cust-1",
        job_date: "2026-07-01",
        // no site_id, no call_type
      })
    );
    expect(input).not.toBeNull();
    expect(input!.customerId).toBe("cust-1");
    expect(input!.newSiteId).toBeTruthy();
    expect(input!.siteId).toBe(input!.newSiteId);
  });

  it("applyLocal writes the bare site (null address, '—' county) + scheduled job w/ null call_type", async () => {
    const input = meta.parseInput!(
      fd({
        mode_customer: "new",
        mode_site: "new",
        customer_name: "Quick Add",
        customer_type: "domestic",
        job_date: "2026-07-01",
      })
    )!;
    await meta.applyLocal(input);

    const site = await db.sites.get(input.newSiteId!);
    expect(site!.address_line_1).toBeNull();
    expect(site!.town).toBeNull();
    expect(site!.county).toBe("—");

    const job = await db.jobs.get(input.jobId);
    expect(job!.job_status).toBe("scheduled");
    expect(job!.call_type).toBeNull();
    expect(job!.site_id).toBe(input.newSiteId);
  });
});
