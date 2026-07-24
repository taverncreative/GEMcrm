/**
 * Product + service-sheet validation for the "Products Used" feature
 * (migration 047).
 *
 * Pins:
 *   - ProductSchema requires a brand, chemical is OPTIONAL (the on-site
 *     "can't supply it yet" case);
 *   - ServiceSheetSchema treats products_used as OPTIONAL — zero products is a
 *     valid completed sheet (survey visit), and there is no `pesticides_used`
 *     requirement any more. This must agree with the DB CHECK + isServiceSheetFilled.
 */
import { describe, it, expect } from "vitest";
import { ProductSchema } from "@/lib/validation/product";
import { ServiceSheetSchema } from "@/lib/validation/service-sheet";

describe("ProductSchema", () => {
  it("requires a brand name", () => {
    expect(ProductSchema.safeParse({ brand_name: "" }).success).toBe(false);
    expect(ProductSchema.safeParse({ brand_name: "   " }).success).toBe(false);
  });

  it("accepts a brand with no chemical (fill-later case)", () => {
    const res = ProductSchema.safeParse({ brand_name: "SecretBrand" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.chemical_name).toBe("");
  });

  it("trims and keeps the chemical when supplied", () => {
    const res = ProductSchema.safeParse({
      brand_name: "  Selontra  ",
      chemical_name: "  cholecalciferol  ",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.brand_name).toBe("Selontra");
      expect(res.data.chemical_name).toBe("cholecalciferol");
    }
  });
});

describe("ServiceSheetSchema — products optional (zero valid)", () => {
  const base = {
    job_id: "j1",
    call_type: "survey",
    pest_species: ["Rats"],
    findings: "None found",
    recommendations: "Monitor",
    method_used: ["Survey"],
    risk_level: "low",
    risk_comments: "No hazards",
    technician_signature: "sig",
  };

  it("validates with NO products (survey visit)", () => {
    const res = ServiceSheetSchema.safeParse(base);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.products_used).toEqual([]);
  });

  it("validates with structured product rows", () => {
    const res = ServiceSheetSchema.safeParse({
      ...base,
      products_used: [
        {
          product_id: null,
          brand_name: "Selontra",
          chemical_name: "cholecalciferol",
          quantity: "2 blocks",
        },
      ],
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.products_used).toHaveLength(1);
      expect(res.data.products_used[0].quantity).toBe("2 blocks");
    }
  });

  it("coerces a sparse product row (missing fields default)", () => {
    const res = ServiceSheetSchema.safeParse({
      ...base,
      products_used: [{ brand_name: "OnlyBrand" }],
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.products_used[0]).toEqual({
        product_id: null,
        brand_name: "OnlyBrand",
        chemical_name: null,
        quantity: "",
      });
    }
  });
});
