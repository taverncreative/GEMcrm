import type { ProductUsed } from "@/types/database";

/**
 * "Products Used" render helpers — the SINGLE guarantee that a brand name
 * never leaks to a customer.
 *
 * Nate picks products by BRAND NAME (his familiarity + commercial privacy).
 * Everything CUSTOMER-FACING (the PDF; there is no customer web view — the
 * emailed "online copy" link points at the same PDF) must show the CHEMICAL
 * NAME only, never the brand. Operator-facing surfaces (fill form, job detail,
 * view-only sheet) show the brand.
 *
 * ALL customer rendering of products MUST go through `renderProductsForCustomer`
 * / `productsForCustomer` — that is the enforcement point. Do not read
 * `brand_name` in any customer-facing template.
 */

/** Shown to the customer when a product row has no chemical name yet (the
 *  on-site "couldn't supply it" case). NEVER the brand. */
export const CHEMICAL_FALLBACK = "Professional product";

/** One line as the CUSTOMER sees it: chemical (or neutral fallback) + qty.
 *  Brand is intentionally unreachable here. */
export interface CustomerProductLine {
  /** Chemical name, or the neutral fallback — never the brand. */
  name: string;
  quantity: string;
}

/** One line as the OPERATOR sees it: brand + qty. */
export interface OperatorProductLine {
  brand: string;
  quantity: string;
}

function rows(productsUsed: ProductUsed[] | null | undefined): ProductUsed[] {
  return Array.isArray(productsUsed) ? productsUsed : [];
}

/**
 * CUSTOMER-FACING lines. Maps each row to its chemical name (or the neutral
 * fallback when the chemical is missing) + quantity. Brand is never included.
 */
export function productsForCustomer(
  productsUsed: ProductUsed[] | null | undefined
): CustomerProductLine[] {
  return rows(productsUsed).map((p) => ({
    name: p.chemical_name?.trim() ? p.chemical_name.trim() : CHEMICAL_FALLBACK,
    quantity: (p.quantity ?? "").trim(),
  }));
}

/** OPERATOR-FACING lines: brand + quantity. */
export function productsForOperator(
  productsUsed: ProductUsed[] | null | undefined
): OperatorProductLine[] {
  return rows(productsUsed).map((p) => ({
    brand: (p.brand_name ?? "").trim(),
    quantity: (p.quantity ?? "").trim(),
  }));
}

/** Join a line to "name — quantity" (or just the name when no quantity). */
function joinLine(name: string, quantity: string): string {
  return quantity ? `${name} — ${quantity}` : name;
}

/**
 * CUSTOMER-FACING plain-text block for a job's products, with the legacy
 * fallback: new sheets have structured `products_used` (chemical-only);
 * pre-047 sheets have free-text `pesticides_used` — render that verbatim.
 * Returns "" when there's nothing (a valid zero-product survey visit), so the
 * caller can omit the section entirely.
 */
export function renderProductsForCustomer(
  productsUsed: ProductUsed[] | null | undefined,
  legacyPesticidesUsed: string | null | undefined
): string {
  const lines = productsForCustomer(productsUsed);
  if (lines.length > 0) {
    return lines.map((l) => joinLine(l.name, l.quantity)).join("\n");
  }
  // Legacy free text (old completed sheets). May contain brand names Nate
  // typed himself pre-047 — unchanged from how it renders today.
  return (legacyPesticidesUsed ?? "").trim();
}

/**
 * OPERATOR-FACING plain-text block, same legacy fallback but brand + qty.
 */
export function renderProductsForOperator(
  productsUsed: ProductUsed[] | null | undefined,
  legacyPesticidesUsed: string | null | undefined
): string {
  const lines = productsForOperator(productsUsed);
  if (lines.length > 0) {
    return lines.map((l) => joinLine(l.brand, l.quantity)).join("\n");
  }
  return (legacyPesticidesUsed ?? "").trim();
}
