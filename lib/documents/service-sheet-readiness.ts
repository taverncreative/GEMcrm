import type { Customer } from "@/types/database";
import { isBlank } from "@/lib/documents/doc-readiness";
import {
  siteHasUsableAddress,
  type AddressLike,
} from "@/lib/documents/resolve-sheet-address";

/**
 * Service-sheet completeness gate — refuse to START a service record sheet
 * until the job's customer and site carry the details the printed sheet
 * needs, so a relaxed/quick booking can't produce a sheet missing contact
 * info or an address.
 *
 * This is its OWN rule, deliberately NOT doc-readiness: that module only
 * models a document SEND needing an `email` (its `DocField` can't even
 * express phone/name). Here we require a fuller fixed set, and each missing
 * field knows where it's fixed — contact fields on the customer
 * (/customers/[id]/edit), the address on the site (/sites/[id]/edit).
 *
 * Pure — no IO, no React — so the rule is unit-tested in isolation.
 */

/** A field the sheet requires, with enough to label it and route the fix. */
export interface ServiceSheetField {
  key: "name" | "phone" | "email" | "site_address";
  /** Plain-words label for the blocking panel, e.g. "a phone number". */
  label: string;
  /** Which edit surface fixes it: the customer record or the site. */
  fixOn: "customer" | "site";
}

export interface ServiceSheetReadiness {
  /** No required field is missing — the sheet may be filled. */
  ready: boolean;
  /** Required-but-blank fields, in display order. Empty when `ready`. */
  missing: ServiceSheetField[];
}

// Contact fields are the gate's own concern; the address columns (optional
// via AddressLike) are the fallback location the resolver reads when the
// job's site is bare.
type CustomerFields = Pick<Customer, "name" | "phone" | "email"> & AddressLike;
type SiteFields = AddressLike;

/**
 * Decide whether a (customer, site) pair is complete enough to start the
 * service sheet, and which fields are missing if not.
 */
export function customerServiceSheetReadiness(
  customer: CustomerFields | null,
  site: SiteFields | null
): ServiceSheetReadiness {
  const missing: ServiceSheetField[] = [];

  // Contact details live on the customer.
  if (isBlank(customer?.name)) {
    missing.push({ key: "name", label: "a name", fixOn: "customer" });
  }
  if (isBlank(customer?.phone)) {
    missing.push({ key: "phone", label: "a phone number", fixOn: "customer" });
  }
  if (isBlank(customer?.email)) {
    missing.push({ key: "email", label: "an email address", fixOn: "customer" });
  }

  // The SITE row itself must carry the address that prints on the sheet.
  // The customer-address fallback still PREFILLS the header (see
  // resolveSheetAddress), but it may NOT satisfy completion: a bare
  // quick-add site backed only by a customer address would otherwise
  // finalise with the customer's address printed as the site. Requiring
  // the site here matches the server completion guard, so the operator is
  // caught early online and routed to fix the site.
  if (!siteHasUsableAddress(site)) {
    missing.push({ key: "site_address", label: "a site address", fixOn: "site" });
  }

  return { ready: missing.length === 0, missing };
}
