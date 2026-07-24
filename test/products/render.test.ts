/**
 * Products render helpers (migration 047) — the SINGLE guarantee that a brand
 * name never reaches a customer.
 *
 * Pins:
 *   - the customer render shows chemical + quantity ONLY, never the brand;
 *   - a row with no chemical shows a neutral fallback, still never the brand;
 *   - old sheets (no structured products) fall back to the legacy free text;
 *   - a zero-product survey visit renders empty (caller omits the section);
 *   - the operator render shows brand + quantity.
 */
import { describe, it, expect } from "vitest";
import {
  productsForCustomer,
  productsForOperator,
  renderProductsForCustomer,
  renderProductsForOperator,
  CHEMICAL_FALLBACK,
} from "@/lib/products/render";
import type { ProductUsed } from "@/types/database";

const rows: ProductUsed[] = [
  {
    product_id: "p1",
    brand_name: "Selontra",
    chemical_name: "cholecalciferol 0.075% 20g block",
    quantity: "2 blocks",
  },
  {
    product_id: "p2",
    brand_name: "SecretBrandX",
    chemical_name: null, // couldn't supply chemical on-site
    quantity: "10g",
  },
];

describe("productsForCustomer — never leaks a brand", () => {
  it("maps to chemical + quantity, and a null chemical to the neutral fallback", () => {
    const out = productsForCustomer(rows);
    expect(out).toEqual([
      { name: "cholecalciferol 0.075% 20g block", quantity: "2 blocks" },
      { name: CHEMICAL_FALLBACK, quantity: "10g" },
    ]);
  });

  it("no output value ever equals a brand name", () => {
    const out = productsForCustomer(rows);
    const brands = rows.map((r) => r.brand_name);
    for (const line of out) {
      expect(brands).not.toContain(line.name);
    }
  });

  it("undefined / empty products → []", () => {
    expect(productsForCustomer(undefined)).toEqual([]);
    expect(productsForCustomer([])).toEqual([]);
  });
});

describe("renderProductsForCustomer — text block + legacy fallback", () => {
  it("joins chemical — quantity per line, never a brand", () => {
    const text = renderProductsForCustomer(rows, null);
    expect(text).toBe(
      `cholecalciferol 0.075% 20g block — 2 blocks\n${CHEMICAL_FALLBACK} — 10g`
    );
    expect(text).not.toContain("Selontra");
    expect(text).not.toContain("SecretBrandX");
  });

  it("old sheet (no structured rows) → legacy free text verbatim", () => {
    expect(renderProductsForCustomer([], "Bromadiolone 0.005%")).toBe(
      "Bromadiolone 0.005%"
    );
    expect(renderProductsForCustomer(undefined, "Legacy text")).toBe(
      "Legacy text"
    );
  });

  it("zero products, no legacy → empty string (section omitted)", () => {
    expect(renderProductsForCustomer([], null)).toBe("");
    expect(renderProductsForCustomer([], "   ")).toBe("");
  });

  it("structured rows take precedence over any legacy value", () => {
    const text = renderProductsForCustomer(rows, "SHOULD NOT SHOW");
    expect(text).not.toContain("SHOULD NOT SHOW");
  });
});

describe("operator render — brand + quantity", () => {
  it("productsForOperator shows the brand", () => {
    expect(productsForOperator(rows)).toEqual([
      { brand: "Selontra", quantity: "2 blocks" },
      { brand: "SecretBrandX", quantity: "10g" },
    ]);
  });

  it("renderProductsForOperator joins brand — quantity, legacy fallback", () => {
    expect(renderProductsForOperator(rows, null)).toBe(
      "Selontra — 2 blocks\nSecretBrandX — 10g"
    );
    expect(renderProductsForOperator([], "Legacy")).toBe("Legacy");
    expect(renderProductsForOperator([], null)).toBe("");
  });
});
