/**
 * Quotes surface in the Documents list (lib/data/documents.ts → getAllDocuments).
 * Pins the merge: a linked-customer quote groups under its customer; a prospect
 * quote (no customers row) still carries its denormalised name via partyName;
 * both read as kind "quote" with the Q-number, total subtitle and PDF url.
 *
 * Only the Supabase boundary is doubled — an in-memory chainable that returns
 * canned rows per table; the real getAllDocuments merge runs.
 */
import { describe, it, expect, vi } from "vitest";

const TABLES = vi.hoisted(() => ({
  invoices: [] as Record<string, unknown>[],
  reports: [] as Record<string, unknown>[],
  agreements: [] as Record<string, unknown>[],
  quotes: [
    {
      id: "q1",
      quote_number: "Q-2026-001",
      total: 435,
      quote_pdf_url: "https://x/object/public/reports/quotes/q1/quote.pdf",
      created_at: "2026-07-19T10:00:00Z",
      customer_name: "Acme Ltd",
      customer: { id: "cust-1", name: "Acme Ltd", company_name: "Acme Ltd" },
    },
    {
      id: "q2",
      quote_number: "Q-2026-002",
      total: 360,
      quote_pdf_url: "https://x/object/public/reports/quotes/q2/quote.pdf",
      created_at: "2026-07-19T11:00:00Z",
      customer_name: "Jane Prospect",
      customer: null, // prospect: no linked customers row
    },
  ] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: keyof typeof TABLES) {
      const data = TABLES[table] ?? [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        not: () => builder,
        neq: () => builder,
        limit: () => Promise.resolve({ data, error: null }),
      };
      return builder;
    },
  }),
}));

import { getAllDocuments } from "@/lib/data/documents";

describe("getAllDocuments — quotes", () => {
  it("includes a linked-customer quote as kind 'quote' with total + customer", async () => {
    const docs = await getAllDocuments();
    const q = docs.find((d) => d.id === "quote-q1");
    expect(q).toBeTruthy();
    expect(q!.kind).toBe("quote");
    expect(q!.title).toBe("Quote Q-2026-001");
    expect(q!.reference).toBe("Q-2026-001");
    expect(q!.customer?.id).toBe("cust-1");
    expect(q!.partyName).toBe("Acme Ltd");
    expect(q!.subtitle).toBe("£435.00");
    // Open link points at the on-demand route (renders lazily), not the stored URL.
    expect(q!.href).toBe("/api/pdf/quote/q1");
  });

  it("includes a prospect quote (no customer) carrying the denormalised name", async () => {
    const docs = await getAllDocuments();
    const q = docs.find((d) => d.id === "quote-q2");
    expect(q).toBeTruthy();
    expect(q!.kind).toBe("quote");
    expect(q!.customer).toBeNull();
    expect(q!.partyName).toBe("Jane Prospect");
    expect(q!.subtitle).toBe("£360.00");
  });

  it("sorts quotes into the newest-first union", async () => {
    const docs = await getAllDocuments();
    // Only quotes are seeded here; newest (q2, 11:00) precedes q1 (10:00).
    expect(docs.map((d) => d.id)).toEqual(["quote-q2", "quote-q1"]);
  });
});
