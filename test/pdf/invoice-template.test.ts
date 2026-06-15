/**
 * renderInvoiceHtml renders an invoice AS ISSUED: VAT display follows the
 * invoice's OWN stored fields, never the current global BUSINESS.vatRegistered
 * flag. This is the regeneration-safety guarantee — once GEM registers and the
 * flag flips true, re-rendering a pre-registration (no-VAT) invoice (backfill
 * button / future regenerate-on-send) must NOT retro-add VAT it never carried.
 *
 * The flag is mocked TRUE here precisely so a no-VAT invoice that still renders
 * the single-line/no-VAT layout proves the template ignores the global flag.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/constants/branding", () => ({
  BUSINESS: {
    vatRegistered: true,
    vatNumber: "GB123456789",
    name: "GEM Services",
    signoffName: "Nate Green",
  },
}));

import { renderInvoiceHtml } from "@/lib/pdf/templates/invoice-template";

const customer = {
  id: "c1",
  name: "Natalie Feild",
  company_name: null,
  email: null,
  phone: null,
} as never;

function inv(overrides: Record<string, unknown> = {}) {
  return {
    id: "5b35d9cd-6e5f-43c6-a112-8f592dac9b92",
    customer_id: "c1",
    job_id: null,
    amount: 105,
    subtotal_amount: null,
    vat_amount: null,
    vat_rate: 0,
    status: "draft",
    invoice_number: "INV-2026-1001",
    description: null,
    due_date: "2026-07-12",
    issued_at: null,
    paid_at: null,
    created_at: "2026-06-12T00:00:00Z",
    updated_at: "2026-06-12T00:00:00Z",
    pdf_url: null,
    ...overrides,
  } as never;
}

describe("renderInvoiceHtml — renders as-issued, not per the global flag", () => {
  it("no stored VAT → single-line no-VAT layout even with vatRegistered=true", () => {
    const html = renderInvoiceHtml({ invoice: inv(), customer });
    expect(html).toContain("Total due");
    expect(html).toContain("£105.00");
    // No breakdown rows, no VAT row, no VAT number — it wasn't a VAT invoice.
    expect(html).not.toContain("Subtotal");
    expect(html).not.toMatch(/VAT \(/);
    expect(html).not.toContain("VAT No.");
    expect(html).not.toContain("[ADD VAT No.]");
  });

  it("stored VAT → breakdown + VAT No. shown (as-issued)", () => {
    const html = renderInvoiceHtml({
      invoice: inv({ subtotal_amount: 87.5, vat_amount: 17.5, vat_rate: 20 }),
      customer,
    });
    expect(html).toContain("Subtotal");
    expect(html).toContain("VAT (20%)");
    expect(html).toContain("VAT No.");
    expect(html).toContain("GB123456789");
  });
});

describe("renderInvoiceHtml — bill-to address (customer → site → omit)", () => {
  const custWithAddress = {
    id: "c1",
    name: "Natalie Feild",
    company_name: null,
    email: null,
    phone: null,
    address_line_1: "12 Customer Way",
    address_line_2: null,
    town: "Folkestone",
    county: "Kent",
    postcode: "CT20 1AA",
  } as never;

  const site = {
    id: "s1",
    address_line_1: "9 Site Road",
    address_line_2: null,
    town: "Dover",
    county: "Kent",
    postcode: "CT16 1AA",
  } as never;

  it("renders the customer's saved address when present", () => {
    const html = renderInvoiceHtml({ invoice: inv(), customer: custWithAddress });
    expect(html).toContain("Address");
    expect(html).toContain("12 Customer Way, Folkestone, Kent, CT20 1AA");
  });

  it("prefers the customer address over the site address", () => {
    const html = renderInvoiceHtml({
      invoice: inv(),
      customer: custWithAddress,
      site,
    });
    expect(html).toContain("12 Customer Way, Folkestone, Kent, CT20 1AA");
    expect(html).not.toContain("9 Site Road");
  });

  it("falls back to the site address when the customer has none", () => {
    const html = renderInvoiceHtml({ invoice: inv(), customer, site });
    expect(html).toContain("9 Site Road, Dover, Kent, CT16 1AA");
  });

  it("omits the address block entirely when both are blank", () => {
    const html = renderInvoiceHtml({ invoice: inv(), customer, site: null });
    // No "Address" field label in the bill-to.
    expect(html).not.toMatch(/field-label">Address</);
  });
});
