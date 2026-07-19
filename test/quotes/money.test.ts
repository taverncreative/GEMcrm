/**
 * Quote money maths (lib/quotes/money.ts). Pins:
 *   - subtotal = sum of line totals (qty * unit_price);
 *   - VAT OFF  -> vat_amount 0, total = subtotal;
 *   - VAT ON   -> vat_amount = round(subtotal * rate%), total = subtotal + vat;
 *   - rounding to the penny, computed in integer pence (no float drift).
 */
import { describe, it, expect } from "vitest";
import { computeQuoteTotals, toPence } from "@/lib/quotes/money";

describe("computeQuoteTotals — VAT OFF", () => {
  it("subtotal is the sum of line totals; total equals subtotal; no VAT", () => {
    const res = computeQuoteTotals(
      [
        { description: "Initial visit", qty: 1, unit_price: 120 },
        { description: "Follow-up visits", qty: 3, unit_price: 80 },
        { description: "Bait stations", qty: 6, unit_price: 12.5 },
      ],
      false,
      20
    );
    // 120 + 240 + 75 = 435
    expect(res.subtotal).toBe(435);
    expect(res.vat_amount).toBe(0);
    expect(res.total).toBe(435);
    expect(res.lineItems.map((l) => l.line_total)).toEqual([120, 240, 75]);
  });

  it("ignores the rate entirely when not registered", () => {
    const res = computeQuoteTotals(
      [{ description: "X", qty: 2, unit_price: 50 }],
      false,
      20
    );
    expect(res.subtotal).toBe(100);
    expect(res.vat_amount).toBe(0);
    expect(res.total).toBe(100);
  });
});

describe("computeQuoteTotals — VAT ON", () => {
  it("adds 20% VAT on the subtotal; total = subtotal + vat", () => {
    const res = computeQuoteTotals(
      [{ description: "Treatment", qty: 1, unit_price: 300 }],
      true,
      20
    );
    expect(res.subtotal).toBe(300);
    expect(res.vat_amount).toBe(60);
    expect(res.total).toBe(360);
  });

  it("rounds VAT to the nearest penny (100.10 @ 20% = 20.02)", () => {
    const res = computeQuoteTotals(
      [{ description: "Odd", qty: 1, unit_price: 100.1 }],
      true,
      20
    );
    expect(res.subtotal).toBe(100.1);
    expect(res.vat_amount).toBe(20.02);
    expect(res.total).toBe(120.12);
  });

  it("VAT rounds half-up per penny (subtotal 12.34 @ 20% = 2.47)", () => {
    // 12.34 * 0.20 = 2.468 -> 2.47
    const res = computeQuoteTotals(
      [{ description: "Rounding", qty: 1, unit_price: 12.34 }],
      true,
      20
    );
    expect(res.vat_amount).toBe(2.47);
    expect(res.total).toBe(14.81);
  });
});

describe("computeQuoteTotals — penny safety + line rounding", () => {
  it("does not drift on classic float cases (0.1 + 0.2)", () => {
    const res = computeQuoteTotals(
      [
        { description: "a", qty: 1, unit_price: 0.1 },
        { description: "b", qty: 1, unit_price: 0.2 },
      ],
      false,
      20
    );
    expect(res.subtotal).toBe(0.3);
  });

  it("rounds a fractional-quantity line total to the penny", () => {
    // 2.5 * 3.33 = 8.325 -> 8.33 (round half up in pence)
    const res = computeQuoteTotals(
      [{ description: "Hours", qty: 2.5, unit_price: 3.33 }],
      false,
      20
    );
    expect(res.lineItems[0].line_total).toBe(8.33);
    expect(res.subtotal).toBe(8.33);
  });

  it("toPence rounds to the nearest penny and is blank-safe", () => {
    expect(toPence(1.01)).toBe(101);
    expect(toPence(12.5)).toBe(1250);
    expect(toPence(12.344)).toBe(1234); // rounds down
    expect(toPence(12.346)).toBe(1235); // rounds up
    expect(toPence(0)).toBe(0);
    expect(toPence(NaN)).toBe(0);
  });
});
