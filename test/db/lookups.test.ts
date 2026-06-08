/**
 * lib/db/lookups — local (Dexie) customer + site reads for the booking /
 * invoice pickers. These are the offline-safe mirror of the server
 * actions; the tests pin the predicate parity:
 *
 *   searchCustomersLocal:  empty → all (newest-first, limit 10);
 *                          case-insensitive substring on name+company;
 *                          soft-deleted excluded.
 *   getSitesForCustomerLocal: scoped to customer_id; newest-first;
 *                          soft-deleted excluded; "" → [].
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Table } from "dexie";
import { db } from "@/lib/db";
import {
  searchCustomersLocal,
  getSitesForCustomerLocal,
} from "@/lib/db/lookups";

// Minimal row shapes — only the fields the lookups actually read.
type CustRow = {
  id: string;
  name: string;
  company_name: string | null;
  created_at: string;
  deleted_at: string | null;
};
type SiteRow = {
  id: string;
  customer_id: string;
  created_at: string;
  deleted_at: string | null;
  address_line_1: string | null;
};

const customers = () => db.customers as unknown as Table<CustRow, string>;
const sites = () => db.sites as unknown as Table<SiteRow, string>;

function cust(over: Partial<CustRow> & { id: string }): CustRow {
  return {
    name: "Unnamed",
    company_name: null,
    created_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}
function site(over: Partial<SiteRow> & { id: string; customer_id: string }): SiteRow {
  return {
    created_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    address_line_1: "1 Test St",
    ...over,
  };
}

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
});

describe("searchCustomersLocal", () => {
  it("empty query → all, newest-first, capped at 10", async () => {
    // 12 customers, created_at ascending by index.
    for (let i = 1; i <= 12; i++) {
      const day = String(i).padStart(2, "0");
      await customers().add(
        cust({ id: `c${day}`, name: `Cust ${day}`, created_at: `2026-01-${day}T00:00:00Z` })
      );
    }
    const res = await searchCustomersLocal("");
    expect(res).toHaveLength(10); // limit
    // Newest first → c12 leads; the two oldest (c01, c02) are dropped.
    expect(res[0].id).toBe("c12");
    expect(res[9].id).toBe("c03");
    expect(res.some((c) => c.id === "c01")).toBe(false);
  });

  it("matches a case-insensitive substring on name OR company_name", async () => {
    await customers().add(cust({ id: "a", name: "Jane Householder" }));
    await customers().add(cust({ id: "b", name: "Bob Smith", company_name: "Acme Pest Ltd" }));
    await customers().add(cust({ id: "c", name: "Carol Jones" }));

    expect((await searchCustomersLocal("jane")).map((c) => c.id)).toEqual(["a"]);
    // Company-name hit, and case-insensitive.
    expect((await searchCustomersLocal("ACME")).map((c) => c.id)).toEqual(["b"]);
    // Substring, not prefix.
    expect((await searchCustomersLocal("jones")).map((c) => c.id)).toEqual(["c"]);
    expect(await searchCustomersLocal("nomatch")).toHaveLength(0);
  });

  it("excludes soft-deleted customers even when they match", async () => {
    await customers().add(cust({ id: "live", name: "Jane Live" }));
    await customers().add(
      cust({ id: "dead", name: "Jane Deleted", deleted_at: "2026-02-01T00:00:00Z" })
    );
    const res = await searchCustomersLocal("jane");
    expect(res.map((c) => c.id)).toEqual(["live"]);
  });
});

describe("getSitesForCustomerLocal", () => {
  it("scopes to the customer and returns newest-first", async () => {
    await sites().add(site({ id: "s1", customer_id: "cust-1", created_at: "2026-01-01T00:00:00Z" }));
    await sites().add(site({ id: "s2", customer_id: "cust-1", created_at: "2026-03-01T00:00:00Z" }));
    await sites().add(site({ id: "s3", customer_id: "cust-2", created_at: "2026-02-01T00:00:00Z" }));

    const res = await getSitesForCustomerLocal("cust-1");
    expect(res.map((s) => s.id)).toEqual(["s2", "s1"]); // newest first
  });

  it("excludes soft-deleted sites", async () => {
    await sites().add(site({ id: "s1", customer_id: "cust-1" }));
    await sites().add(
      site({ id: "s2", customer_id: "cust-1", deleted_at: "2026-02-01T00:00:00Z" })
    );
    const res = await getSitesForCustomerLocal("cust-1");
    expect(res.map((s) => s.id)).toEqual(["s1"]);
  });

  it("returns [] for an empty id and for a customer with no sites", async () => {
    await sites().add(site({ id: "s1", customer_id: "cust-1" }));
    expect(await getSitesForCustomerLocal("")).toEqual([]);
    expect(await getSitesForCustomerLocal("cust-missing")).toEqual([]);
  });
});
