import { z } from "zod";

const optionalString = z.string().optional().default("");

// Strict shared schema — the standalone Add Site form and the draft-upgrade
// flow validate against this (a full address is required). The quick-add
// booking path does NOT use this; it builds a lenient (possibly bare) site
// inline in createQuickBookingAction. createSite stores blank fields as null.
export const SiteSchema = z.object({
  address_line_1: z.string().min(1, "Address line 1 is required"),
  address_line_2: optionalString,
  town: z.string().min(1, "Town is required"),
  county: z.string().min(1, "County is required"),
  // Optional — some sites (rural, in-development) have no postcode to hand.
  postcode: optionalString,
});

export type SiteInput = z.infer<typeof SiteSchema>;
