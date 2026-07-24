import { z } from "zod";

/**
 * Product create/update schema (migration 047).
 *
 * `brand_name` is required (Nate's picker value). `chemical_name` is OPTIONAL:
 * an on-site "can't supply it yet" add saves the brand and the picker
 * re-prompts next time (self-heal). A customer-facing render must never fall
 * back to the brand when the chemical is missing.
 */
export const ProductSchema = z.object({
  brand_name: z
    .string()
    .trim()
    .min(1, "Brand name is required")
    .max(200, "Brand name is too long"),
  chemical_name: z
    .string()
    .trim()
    .max(500, "Chemical name is too long")
    .optional()
    .default(""),
});

export type ProductInput = z.infer<typeof ProductSchema>;
