/**
 * revertLocalCreate — discard-revert safety (step 8).
 *
 * When a stuck offline CREATE is discarded from the conflict inbox, the
 * local rows it created must be removed too (else orphans linger). The
 * SAFETY constraint: only for op==="create", and only the newly-created
 * ids (entity_id + entity_ids) — never a referenced/existing row.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { revertLocalCreate } from "@/lib/db/outbox";
import type { Customer, Site, Job } from "@/types/database";

const NOW = "2026-06-01T00:00:00Z";
const cust = (id: string): Customer =>
  ({
    id,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    name: "X",
    company_name: null,
    email: null,
    phone: null,
    customer_type: "domestic",
    google_review_received: false,
    review_request_snoozed_until: null,
    review_email_sent_at: null,
    mobile: null,
    position: null,
    address: null,
    address_line_1: null,
    address_line_2: null,
    town: null,
    county: null,
    postcode: null,
    website: null,
    notes: null,
    annual_contract_value: null,
  }) as Customer;
const site = (id: string, customer_id: string): Site =>
  ({ id, customer_id, created_at: NOW, updated_at: NOW, deleted_at: null,
     address_line_1: "1 St", address_line_2: null, town: "T", county: null,
     postcode: "T1" }) as Site;
const job = (id: string, site_id: string): Job =>
  ({ id, site_id, created_at: NOW, updated_at: NOW } as Job);

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
});

describe("revertLocalCreate", () => {
  it("deletes ONLY the newly-created rows of a create entry", async () => {
    // Existing (referenced) customer that must survive.
    await db.customers.put(cust("existing-cust"));
    // Newly-created rows of an offline booking against that customer.
    await db.sites.put(site("new-site", "existing-cust"));
    await db.jobs.put(job("new-job", "new-site"));

    await revertLocalCreate({
      op: "create",
      entity_id: "new-job",
      entity_ids: ["new-site", "new-job"], // only newly-created ids
    });

    // The new site + job are gone.
    expect(await db.sites.get("new-site")).toBeUndefined();
    expect(await db.jobs.get("new-job")).toBeUndefined();
    // The existing customer is untouched (never listed in entity_ids).
    expect(await db.customers.get("existing-cust")).toBeDefined();
  });

  it("deletes a newly-created customer when the booking created one", async () => {
    await db.customers.put(cust("new-cust"));
    await db.sites.put(site("new-site", "new-cust"));
    await db.jobs.put(job("new-job", "new-site"));

    await revertLocalCreate({
      op: "create",
      entity_id: "new-job",
      entity_ids: ["new-cust", "new-site", "new-job"],
    });

    expect(await db.customers.get("new-cust")).toBeUndefined();
    expect(await db.sites.get("new-site")).toBeUndefined();
    expect(await db.jobs.get("new-job")).toBeUndefined();
  });

  it("is a NO-OP for op==='update' (never deletes rows)", async () => {
    await db.jobs.put(job("j1", "s1"));
    await revertLocalCreate({ op: "update", entity_id: "j1" });
    expect(await db.jobs.get("j1")).toBeDefined();
  });

  it("is a NO-OP for op==='delete'", async () => {
    await db.jobs.put(job("j1", "s1"));
    await revertLocalCreate({ op: "delete", entity_id: "j1" });
    expect(await db.jobs.get("j1")).toBeDefined();
  });

  it("is a NO-OP when op is undefined (legacy entries)", async () => {
    await db.jobs.put(job("j1", "s1"));
    await revertLocalCreate({ entity_id: "j1" });
    expect(await db.jobs.get("j1")).toBeDefined();
  });
});
