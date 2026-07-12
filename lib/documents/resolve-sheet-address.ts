import { isBlank } from "@/lib/documents/doc-readiness";

/**
 * Resolve the location that prints on a service sheet (feat: sheet prefill).
 *
 * The job already dictates the site (job.site_id), so there's no site to
 * pick — but a quick-add booking can leave that site BARE (no address).
 * Rather than re-ask the operator for an address the customer record
 * already holds, fall back to the customer's own address. Order:
 *
 *   1. the job's site, if it has a usable address (line 1 + town), else
 *   2. the customer's own address, if usable, else
 *   3. nothing (source "none") — genuinely never captured; the gate then
 *      asks for it for the first time.
 *
 * Pure + offline-safe: reads only the passed rows (both come from Dexie in
 * the app). A "usable" address needs line 1 + town; postcode is optional
 * (UK addresses often omit it), matching the readiness gate.
 */

export type SheetAddressSource = "site" | "customer" | "none";

/** Any row carrying address columns — a Site, a Customer, or a test
 *  partial. All optional so callers pass whatever shape they have. */
export interface AddressLike {
  address_line_1?: string | null;
  address_line_2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
}

export interface ResolvedSheetAddress {
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
  source: SheetAddressSource;
}

function usable(parts: AddressLike | null): boolean {
  if (!parts) return false;
  return !isBlank(parts.address_line_1) && !isBlank(parts.town);
}

function pick(parts: AddressLike, source: SheetAddressSource): ResolvedSheetAddress {
  return {
    address_line_1: parts.address_line_1 ?? null,
    address_line_2: parts.address_line_2 ?? null,
    town: parts.town ?? null,
    county: parts.county ?? null,
    postcode: parts.postcode ?? null,
    source,
  };
}

export function resolveSheetAddress(
  site: AddressLike | null,
  customer: AddressLike | null
): ResolvedSheetAddress {
  if (usable(site)) return pick(site!, "site");
  if (usable(customer)) return pick(customer!, "customer");
  return {
    address_line_1: null,
    address_line_2: null,
    town: null,
    county: null,
    postcode: null,
    source: "none",
  };
}

/** One-line address for the sheet header: "line 1, town, POSTCODE". */
export function formatSheetAddress(r: ResolvedSheetAddress): string {
  return [r.address_line_1, r.town, r.postcode].filter(Boolean).join(", ");
}
