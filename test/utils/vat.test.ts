/**
 * grossVatSplit — the single 20% standard-rated split used by every invoice
 * creation path + the migration backfill. GEM is VAT-registered and pest
 * control is standard-rated, so the entered/gross figure is always treated
 * as VAT-inclusive and split out.
 */
import { describe, it, expect } from "vitest";
import {
  grossVatSplit,
  invoiceVatFields,
  STANDARD_VAT_RATE,
} from "@/lib/utils/vat";

describe("grossVatSplit", () => {
  it("splits Natalie's £105 gross into £87.50 + £17.50", () => {
    expect(grossVatSplit(105)).toEqual({
      subtotal: 87.5,
      vat: 17.5,
      total: 105,
      rate: 20,
    });
  });

  it("splits a clean £120 gross into £100 + £20", () => {
    expect(grossVatSplit(120)).toEqual({
      subtotal: 100,
      vat: 20,
      total: 120,
      rate: 20,
    });
  });

  it("subtotal + vat always reconstitute the gross total (rounded to 2dp)", () => {
    for (const gross of [105, 120, 99.99, 250, 47.5, 1000.01]) {
      const { subtotal, vat, total } = grossVatSplit(gross);
      expect(Math.round((subtotal + vat) * 100) / 100).toBe(total);
    }
  });

  it("rate is the UK standard rate", () => {
    expect(grossVatSplit(100).rate).toBe(STANDARD_VAT_RATE);
    expect(STANDARD_VAT_RATE).toBe(20);
  });

  it("guards non-positive / non-finite input to a zero split", () => {
    expect(grossVatSplit(0)).toEqual({ subtotal: 0, vat: 0, total: 0, rate: 20 });
    expect(grossVatSplit(-5)).toEqual({ subtotal: 0, vat: 0, total: 0, rate: 20 });
    expect(grossVatSplit(NaN)).toEqual({ subtotal: 0, vat: 0, total: 0, rate: 20 });
  });
});

describe("invoiceVatFields — VAT gated on registration", () => {
  it("NOT registered → no VAT: amount is the total, no breakdown, rate 0", () => {
    expect(invoiceVatFields(105, false)).toEqual({
      amount: 105,
      subtotal_amount: null,
      vat_amount: null,
      vat_rate: 0,
    });
  });

  it("registered → the 20% standard-rated split (dormant path stays covered)", () => {
    expect(invoiceVatFields(105, true)).toEqual({
      amount: 105,
      subtotal_amount: 87.5,
      vat_amount: 17.5,
      vat_rate: 20,
    });
    expect(invoiceVatFields(120, true)).toEqual({
      amount: 120,
      subtotal_amount: 100,
      vat_amount: 20,
      vat_rate: 20,
    });
  });

  it("guards non-positive input to a zero total in both states", () => {
    expect(invoiceVatFields(0, false).amount).toBe(0);
    expect(invoiceVatFields(-1, true)).toEqual({
      amount: 0,
      subtotal_amount: 0,
      vat_amount: 0,
      vat_rate: 20,
    });
  });
});
