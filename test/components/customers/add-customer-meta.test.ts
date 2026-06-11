/**
 * Add Customer — optimistic create meta (fix: new customer didn't
 * appear in the list until a manual refresh).
 *
 * The customers list reads Dexie via useLiveQuery; the old form wrote
 * only to the server, so the row appeared on the NEXT pull. These pin
 * the converted pipeline against real fake-indexeddb:
 *
 *   - parseInput generates the client ids the whole pipeline shares
 *     and filters extra sites to the server's usability rule;
 *   - applyLocal writes the customer + auto-created sites with those
 *     ids and the server's normalisation (trim, postcode uppercase);
 *   - entityIds lists ONLY newly-created ids (discard-revert contract);
 *   - replayArgs embeds the ids so the replay upserts the SAME rows;
 *   - the enqueued entry is op:'create' on the customer entity;
 *   - client validation supplies the field errors the server used to.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// The form module imports the server action (next/cache etc.) — stub it;
// these tests never invoke it (optimistic path never calls the server).
vi.mock("@/app/(app)/customers/actions", () => ({
  createCustomerAction: vi.fn(),
}));

import {
  createCustomerMeta,
  parseCreateCustomerFormData,
  validateCustomerFormData,
} from "@/components/customers/add-customer-form";
import { db } from "@/lib/db";
import { enqueueAction } from "@/lib/db/outbox";

function customerFormData(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("name", "Optimistic Test Customer");
  fd.set("customer_type", "commercial");
  fd.set("company_name", "Test Co");
  fd.set("email", "ops@test.example");
  fd.set("address_line_1", "1 Test Way");
  fd.set("town", "Testford");
  fd.set("postcode", "tf1 1aa"); // lowercase on purpose — normalisation pin
  fd.set(
    "additional_sites",
    JSON.stringify([
      { address_line_1: "2 Branch Rd", town: "Testford", postcode: "TF2 2BB" },
      { address_line_1: "", town: "", postcode: "" }, // unusable — skipped
    ])
  );
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.outbox.clear();
});

describe("parseCreateCustomerFormData", () => {
  it("generates shared client ids and keeps only usable extra sites", () => {
    const input = parseCreateCustomerFormData(customerFormData())!;
    expect(input.customerId).toMatch(/[0-9a-f-]{36}/);
    expect(input.primarySiteId).toMatch(/[0-9a-f-]{36}/);
    expect(input.extraSites).toHaveLength(1); // the sparse one was skipped
    expect(input.extraSites[0].id).toMatch(/[0-9a-f-]{36}/);
  });

  it("returns null on an invalid customer (name too short)", () => {
    expect(parseCreateCustomerFormData(customerFormData({ name: "x" }))).toBeNull();
  });
});

describe("applyLocal — list sees the row instantly", () => {
  it("writes customer + primary site + usable extras with shared ids and normalisation", async () => {
    const input = parseCreateCustomerFormData(customerFormData())!;
    await createCustomerMeta.applyLocal(input);

    const customer = await db.customers.get(input.customerId);
    expect(customer?.name).toBe("Optimistic Test Customer");
    expect(customer?.postcode).toBe("TF1 1AA"); // uppercased like the server
    expect(customer?.deleted_at).toBeNull();

    const sites = await db.sites.where("customer_id").equals(input.customerId).toArray();
    expect(sites).toHaveLength(2); // primary (from address block) + 1 usable extra
    expect(sites.map((s) => s.id).sort()).toEqual(
      [input.primarySiteId, input.extraSites[0].id].sort()
    );
  });

  it("writes no sites when no address is usable", async () => {
    const input = parseCreateCustomerFormData(
      customerFormData({
        address_line_1: "",
        town: "",
        postcode: "",
        additional_sites: "[]",
      })
    )!;
    await createCustomerMeta.applyLocal(input);
    expect(
      await db.sites.where("customer_id").equals(input.customerId).count()
    ).toBe(0);
  });
});

describe("entry shape + replay args", () => {
  it("entityIds lists exactly the newly-created ids", () => {
    const input = parseCreateCustomerFormData(customerFormData())!;
    expect(createCustomerMeta.entityIds!(input).sort()).toEqual(
      [input.customerId, input.primarySiteId, input.extraSites[0].id].sort()
    );
  });

  it("replayArgs embeds the client ids; enqueued entry is op:'create' on customer", async () => {
    const fd = customerFormData();
    const input = parseCreateCustomerFormData(fd)!;
    const args = createCustomerMeta.replayArgs!(input, fd);

    expect(args.id).toBe(input.customerId);
    expect(args.primary_site_id).toBe(input.primarySiteId);
    const sites = JSON.parse(args.additional_sites as string);
    expect(sites[0].id).toBe(input.extraSites[0].id);

    await enqueueAction({
      action_name: createCustomerMeta.actionName,
      args,
      entity_type: createCustomerMeta.entityType,
      entity_id: createCustomerMeta.entityId(input),
      op: "create",
      entity_ids: createCustomerMeta.entityIds!(input),
    });
    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].action_name).toBe("createCustomerAction");
    expect(entries[0].op).toBe("create");
    expect(entries[0].entity_id).toBe(input.customerId);
  });
});

describe("client-side validation", () => {
  it("maps the schema's errors to the keys the form renders", () => {
    const errors = validateCustomerFormData(customerFormData({ name: "x" }));
    expect(errors?.name).toMatch(/at least 2/i);
  });

  it("valid form → null", () => {
    expect(validateCustomerFormData(customerFormData())).toBeNull();
  });
});
