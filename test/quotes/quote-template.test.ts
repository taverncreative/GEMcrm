/**
 * renderQuoteHtml (lib/pdf/templates/quote-template.ts). Pins the branded HTML
 * a quote PDF is built from: line items, totals, the as-issued VAT gate, and
 * that validity/terms/notes render. The binary PDF (htmlToPdf/Puppeteer) is
 * proven on :3002; this pins the template content deterministically.
 */
import { describe, it, expect } from "vitest";
import { renderQuoteHtml } from "@/lib/pdf/templates/quote-template";
import type { Quote } from "@/types/database";

function baseQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    quote_number: "Q-2026-001",
    customer_id: null,
    customer_name: "Acme Ltd",
    customer_address: "1 Industrial Way, Testford, TF1 1AA",
    customer_email: "acme@example.test",
    line_items: [
      { description: "Initial visit", qty: 1, unit_price: 120, line_total: 120 },
      { description: "Follow-ups", qty: 3, unit_price: 80, line_total: 240 },
    ],
    subtotal: 360,
    vat_registered: false,
    vat_rate: 20,
    vat_amount: 0,
    total: 360,
    terms: "Valid for 30 days from issue.",
    valid_until: "2026-08-31",
    notes: "Access via the rear gate.",
    status: "draft",
    quote_pdf_url: null,
    created_by: "op-1",
    created_at: "2026-07-19T10:00:00Z",
    updated_at: "2026-07-19T10:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("renderQuoteHtml — content", () => {
  it("renders the number, customer, line items and total", () => {
    const html = renderQuoteHtml({ quote: baseQuote() });
    expect(html).toContain("Q-2026-001");
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("Initial visit");
    expect(html).toContain("Follow-ups");
    expect(html).toContain("£360.00"); // total
    expect(html).toContain("Quote"); // doc type label
  });

  it("renders validity date, terms and notes", () => {
    const html = renderQuoteHtml({ quote: baseQuote() });
    expect(html).toContain("31 August 2026"); // valid_until, en-GB long
    expect(html).toContain("Valid for 30 days from issue.");
    expect(html).toContain("Access via the rear gate.");
  });
});

describe("renderQuoteHtml — as-issued VAT gate", () => {
  it("shows NO VAT breakdown when not registered", () => {
    const html = renderQuoteHtml({ quote: baseQuote({ vat_registered: false }) });
    expect(html).not.toContain("VAT (");
    expect(html).not.toContain("Subtotal");
  });

  it("shows the subtotal + VAT split when registered", () => {
    const html = renderQuoteHtml({
      quote: baseQuote({
        vat_registered: true,
        vat_rate: 20,
        vat_amount: 72,
        total: 432,
      }),
    });
    expect(html).toContain("Subtotal");
    expect(html).toContain("VAT (20%)");
    expect(html).toContain("£72.00");
    expect(html).toContain("£432.00");
  });
});
