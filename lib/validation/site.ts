import { z } from "zod";

const optionalString = z.string().optional().default("");

export const SiteSchema = z.object({
  address_line_1: z.string().min(1, "Address line 1 is required"),
  address_line_2: optionalString,
  town: z.string().min(1, "Town is required"),
  county: z.string().min(1, "County is required"),
  postcode: z.string().min(1, "Postcode is required"),
});

export type SiteInput = z.infer<typeof SiteSchema>;
