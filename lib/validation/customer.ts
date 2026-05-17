import { z } from "zod";

const optionalString = z.string().optional().default("");

const optionalEmail = z
  .union([z.string().email("Invalid email address"), z.literal("")])
  .optional()
  .default("");

const optionalUrl = z
  .union([z.string().url("Enter a valid URL (incl. https://)"), z.literal("")])
  .optional()
  .default("");

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
  website: optionalUrl,
  notes: optionalString,
  customer_type: z.enum(CUSTOMER_TYPES).default("commercial"),
  // Optional headline contract value — e.g. £40,000 pa. Allows operator
  // to capture an expected value before the PMA is set up.
  annual_contract_value: z.union([z.coerce.number().min(0), z.literal("")])
    .optional()
    .default(""),
});

export type CustomerInput = z.infer<typeof CustomerSchema>;
