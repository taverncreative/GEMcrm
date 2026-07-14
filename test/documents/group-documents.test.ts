/**
 * Documents Phase 2 — client-side grouping + customer search transforms.
 *
 * Pins:
 *   - group by customer.id with correct counts; no-customer docs form a
 *     single trailing group;
 *   - groups ordered by most-recent activity (no-customer always last);
 *   - each group keeps its incoming (newest-first) order;
 *   - customer search matches name OR company, case-insensitively, and
 *     composes with a kind filter.
 */
import { describe, it, expect } from "vitest";
import type { DocumentItem } from "@/lib/data/documents";
import {
  groupDocumentsByCustomer,
  filterDocumentsByCustomer,
  NO_CUSTOMER_KEY,
} from "@/lib/documents/group-documents";

function doc(overrides: Partial<DocumentItem>): DocumentItem {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "service_sheet",
    title: "Doc",
    reference: null,
    customer: { id: "a", name: "Contact A", company_name: "Acme Ltd" },
    url: "",
    date: "2026-07-01",
    ...overrides,
  };
}

const CUST_A = { id: "a", name: "Contact A", company_name: "Acme Ltd" };
const CUST_B = { id: "b", name: "Bob Smith", company_name: null };

// A has 2 docs (07-10, 07-01), B has 1 (07-15), plus 1 no-customer (07-20).
const A1 = doc({ id: "a1", customer: CUST_A, date: "2026-07-10", kind: "service_sheet" });
const A2 = doc({ id: "a2", customer: CUST_A, date: "2026-07-01", kind: "invoice" });
const B1 = doc({ id: "b1", customer: CUST_B, date: "2026-07-15", kind: "agreement" });
const NONE = doc({ id: "n1", customer: null, date: "2026-07-20", kind: "service_sheet" });

const ITEMS = [B1, A1, A2, NONE];

describe("groupDocumentsByCustomer", () => {
  it("groups by customer.id with correct counts", () => {
    const groups = groupDocumentsByCustomer(ITEMS);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(byKey["a"].count).toBe(2);
    expect(byKey["b"].count).toBe(1);
    expect(byKey[NO_CUSTOMER_KEY].count).toBe(1);
    expect(byKey["a"].label).toBe("Acme Ltd"); // company first
    expect(byKey["b"].label).toBe("Bob Smith");
  });

  it("orders groups by most-recent activity, no-customer last", () => {
    const groups = groupDocumentsByCustomer(ITEMS);
    // B (07-15) before A (07-10); no-customer (07-20) still sorts last.
    expect(groups.map((g) => g.key)).toEqual(["b", "a", NO_CUSTOMER_KEY]);
  });

  it("preserves each group's incoming (newest-first) order", () => {
    const groups = groupDocumentsByCustomer(ITEMS);
    const a = groups.find((g) => g.key === "a")!;
    expect(a.items.map((i) => i.id)).toEqual(["a1", "a2"]); // 07-10 then 07-01
  });

  it("empty input yields no groups", () => {
    expect(groupDocumentsByCustomer([])).toEqual([]);
  });
});

describe("filterDocumentsByCustomer", () => {
  it("matches on company name", () => {
    const r = filterDocumentsByCustomer(ITEMS, "acme");
    expect(r.map((i) => i.id).sort()).toEqual(["a1", "a2"]);
  });

  it("matches on contact name, case-insensitively", () => {
    expect(filterDocumentsByCustomer(ITEMS, "BOB").map((i) => i.id)).toEqual(["b1"]);
    expect(filterDocumentsByCustomer(ITEMS, "contact a").map((i) => i.id).sort()).toEqual(["a1", "a2"]);
  });

  it("empty query returns everything", () => {
    expect(filterDocumentsByCustomer(ITEMS, "   ")).toHaveLength(ITEMS.length);
  });

  it("never matches a no-customer doc on a non-empty query", () => {
    expect(filterDocumentsByCustomer(ITEMS, "acme").some((i) => i.id === "n1")).toBe(false);
  });

  it("composes with a kind filter (kind then customer search)", () => {
    const sheets = ITEMS.filter((i) => i.kind === "service_sheet");
    // A has one sheet (a1); the no-customer sheet (n1) won't match "acme".
    const r = filterDocumentsByCustomer(sheets, "acme");
    expect(r.map((i) => i.id)).toEqual(["a1"]);
    // Grouping the composed result: one group, A, count 1.
    const groups = groupDocumentsByCustomer(r);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("a");
    expect(groups[0].count).toBe(1);
  });
});
