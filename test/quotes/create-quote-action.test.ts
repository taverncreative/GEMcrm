/**
 * createQuoteAction (app/(app)/quotes/actions.ts). Pins:
 *   - totals are computed SERVER-SIDE from the line items (client math ignored);
 *   - the app does NOT assign quote_number — it is delegated to the DB
 *     sequence trigger (the insert payload carries no quote_number key);
 *   - a standalone prospect (blank customer_id) creates a quote with a NULL
 *     customer_id and the denormalised name;
 *   - the PDF is NOT generated in create (that is lazy, on first download) — the
 *     action just inserts and redirects, so create stays fast;
 *   - VAT on vs off both flow through correctly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const createQuoteMock = vi.fn(async (input: Record<string, unknown>) => ({
  id: "quote-123",
  quote_number: "Q-2026-005",
  ...input,
}));
const renderPdfMock = vi.fn(async (_id: string) => ({
  pdfUrl: "https://x/quotes/quote-123/quote.pdf",
  buffer: Buffer.from("PDF"),
}));
const redirectMock = vi.fn((_url: string) => undefined);

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op-1" })),
}));
vi.mock("@/lib/data/quotes", () => ({
  createQuote: (input: Record<string, unknown>) => createQuoteMock(input),
}));
vi.mock("@/lib/services/quote-pdf", () => ({
  renderAndStoreQuotePdf: (id: string) => renderPdfMock(id),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import { createQuoteAction } from "@/app/(app)/quotes/actions";
import { INITIAL_ACTION_STATE } from "@/types/actions";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const THREE_LINES = JSON.stringify([
  { description: "Initial visit", qty: 1, unit_price: 120 },
  { description: "Follow-ups", qty: 3, unit_price: 80 },
  { description: "Bait stations", qty: 6, unit_price: 12.5 },
]);

beforeEach(() => {
  createQuoteMock.mockClear();
  renderPdfMock.mockClear();
  redirectMock.mockClear();
});

describe("createQuoteAction — existing customer, VAT off", () => {
  it("computes totals server-side, omits quote_number, does NOT render a PDF, redirects", async () => {
    await createQuoteAction(
      INITIAL_ACTION_STATE,
      fd({
        customer_id: "cust-1",
        customer_name: "Acme Ltd",
        customer_address: "1 Industrial Way",
        customer_email: "acme@example.test",
        line_items: THREE_LINES,
        vat_rate: "20",
        terms: "Valid 30 days.",
        valid_until: "2026-08-31",
        notes: "",
      })
    );

    expect(createQuoteMock).toHaveBeenCalledTimes(1);
    const arg = createQuoteMock.mock.calls[0][0];

    // Server-side maths: 120 + 240 + 75 = 435, no VAT.
    expect(arg.subtotal).toBe(435);
    expect(arg.vat_amount).toBe(0);
    expect(arg.total).toBe(435);
    expect(arg.vat_registered).toBe(false);
    expect((arg.line_items as { line_total: number }[]).map((l) => l.line_total)).toEqual([
      120, 240, 75,
    ]);

    // The app never assigns the number — the DB trigger does.
    expect(arg).not.toHaveProperty("quote_number");

    // Linked customer + audit stamp.
    expect(arg.customer_id).toBe("cust-1");
    expect(arg.customer_name).toBe("Acme Ltd");
    expect(arg.created_by).toBe("op-1");

    // Create must NOT render a PDF (that is lazy on first download).
    expect(renderPdfMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/quotes/quote-123");
  });
});

describe("createQuoteAction — standalone prospect, VAT on", () => {
  it("stores a null customer_id with the denormalised name and applies VAT", async () => {
    await createQuoteAction(
      INITIAL_ACTION_STATE,
      fd({
        customer_id: "", // prospect: no linked customer
        customer_name: "Jane Prospect",
        customer_address: "",
        customer_email: "",
        line_items: JSON.stringify([
          { description: "Treatment", qty: 1, unit_price: 300 },
        ]),
        vat_registered: "on",
        vat_rate: "20",
        terms: "",
        valid_until: "",
        notes: "",
      })
    );

    expect(createQuoteMock).toHaveBeenCalledTimes(1);
    const arg = createQuoteMock.mock.calls[0][0];

    expect(arg.customer_id).toBeNull(); // no customers row referenced
    expect(arg.customer_name).toBe("Jane Prospect");
    expect(arg.customer_email).toBeNull();

    // VAT ON: 300 + 20% = 360.
    expect(arg.vat_registered).toBe(true);
    expect(arg.subtotal).toBe(300);
    expect(arg.vat_amount).toBe(60);
    expect(arg.total).toBe(360);

    expect(redirectMock).toHaveBeenCalledWith("/quotes/quote-123");
  });
});

describe("createQuoteAction — validation", () => {
  it("rejects with no line items and never inserts", async () => {
    const res = await createQuoteAction(
      INITIAL_ACTION_STATE,
      fd({
        customer_name: "Someone",
        line_items: JSON.stringify([]),
      })
    );
    expect(res?.success).toBe(false);
    expect(res?.errors.line_items).toBeTruthy();
    expect(createQuoteMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("rejects a blank customer name", async () => {
    const res = await createQuoteAction(
      INITIAL_ACTION_STATE,
      fd({
        customer_name: "",
        line_items: JSON.stringify([
          { description: "X", qty: 1, unit_price: 10 },
        ]),
      })
    );
    expect(res?.success).toBe(false);
    expect(res?.errors.customer_name).toBeTruthy();
    expect(createQuoteMock).not.toHaveBeenCalled();
  });
});
