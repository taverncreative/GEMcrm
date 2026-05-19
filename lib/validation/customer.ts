import { z } from "zod";

const optionalString = z.string().optional().default("");

const optionalEmail = z
  .union([z.string().email("Invalid email address"), z.literal("")])
  .optional()
  .default("");

/**
 * Lenient website validation:
 *   - empty                         → "" (stored as null in DB)
 *   - "example.com"                 → "https://example.com"
 *   - "www.example.com"             → "https://www.example.com"
 *   - "https://example.com"         → unchanged
 *   - "asdf"  / "no dots"           → rejected with friendly message
 *
 * The previous schema used `z.string().url()` which requires a protocol
 * (http://) and rejects bare-domain input like "gemservices.uk" with the
 * default Zod union error "Invalid input" — confusing for operators who
 * naturally type the domain only. We auto-prepend https:// when missing.
 */
const optionalWebsite = z
  .string()
  .optional()
  .default("")
  .transform((v) => (v ?? "").trim())
  .transform((v) => {
    if (v === "") return "";
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  })
  .refine(
    (v) =>
      v === "" ||
      // Domain part must look like real.tld — at least one dot, no spaces.
      /^https?:\/\/[^\s.]+\.[^\s.]+/.test(v),
    { message: "Enter a website like example.com" }
  );

export const CUSTOMER_TYPES = ["commercial", "domestic"] as const;

export const CustomerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  company_name: optionalString,
  position: optionalString,
  email: optionalEmail,
  phone: optionalString,
  mobile: optionalString,
  // Structured address (replaces the old single-textarea `address`).
  // All optional — domestic customers can leave the whole block empty.
  address_line_1: optionalString,
  address_line_2: optionalString,
  town: optionalString,
  county: optionalString,
  postcode: optionalString,
  website: optionalWebsite,
  notes: optionalString,
  customer_type: z.enum(CUSTOMER_TYPES).default("commercial"),
  // Optional headline contract value — e.g. £40,000 pa. Allows operator
  // to capture an expected value before the PMA is set up.
  annual_contract_value: z.union([z.coerce.number().min(0), z.literal("")])
    .optional()
    .default(""),
});

export type CustomerInput = z.infer<typeof CustomerSchema>;
