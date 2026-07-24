/**
 * searchProductsLocal / findProductByBrandLocal — the offline-first product
 * type-ahead reading the Dexie `products` mirror (migration 047).
 *
 * Pins (against fake-indexeddb — the offline path):
 *   - case-insensitive substring match on brand AND chemical;
 *   - empty query returns the whole live list (tap-to-see-all);
 *   - soft-deleted (retired) products are excluded;
 *   - brand-ordered;
 *   - findProductByBrandLocal detects an existing brand (the "unlisted?" check).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { searchProductsLocal, findProductByBrandLocal } from "@/lib/db/lookups";
import type { Product } from "@/types/database";

function add(over: Partial<Product> & { id: string; brand_name: string }) {
  return db.products.add({
    chemical_name: null,
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    deleted_at: null,
    ...over,
  } as Product);
}

beforeEach(async () => {
  await db.products.clear();
  await add({ id: "1", brand_name: "Selontra", chemical_name: "cholecalciferol 0.075% block" });
  await add({ id: "2", brand_name: "Talon Soft", chemical_name: "brodifacoum 0.0025% paste" });
  await add({ id: "3", brand_name: "Brodikill", chemical_name: "brodifacoum 0.0029% grain" });
  await add({ id: "4", brand_name: "Retired Brand", chemical_name: "old", deleted_at: "2026-07-10T00:00:00Z" });
});

describe("searchProductsLocal", () => {
  it("matches on brand (case-insensitive substring)", async () => {
    const out = await searchProductsLocal("sel");
    expect(out.map((p) => p.brand_name)).toEqual(["Selontra"]);
  });

  it("matches on chemical name too", async () => {
    const out = await searchProductsLocal("brodifacoum");
    expect(out.map((p) => p.brand_name).sort()).toEqual(["Brodikill", "Talon Soft"]);
  });

  it("empty query returns the whole live list, brand-ordered", async () => {
    const out = await searchProductsLocal("");
    expect(out.map((p) => p.brand_name)).toEqual([
      "Brodikill",
      "Selontra",
      "Talon Soft",
    ]);
  });

  it("excludes soft-deleted (retired) products", async () => {
    const out = await searchProductsLocal("retired");
    expect(out).toEqual([]);
    expect((await searchProductsLocal("")).map((p) => p.id)).not.toContain("4");
  });
});

describe("findProductByBrandLocal", () => {
  it("finds an existing brand exactly (case-insensitive)", async () => {
    expect((await findProductByBrandLocal("selontra"))?.id).toBe("1");
    expect((await findProductByBrandLocal("  Talon Soft "))?.id).toBe("2");
  });

  it("returns undefined for an unlisted brand (→ offer to add it)", async () => {
    expect(await findProductByBrandLocal("Nonexistent")).toBeUndefined();
    // A retired brand is treated as unlisted (excluded).
    expect(await findProductByBrandLocal("Retired Brand")).toBeUndefined();
  });
});
