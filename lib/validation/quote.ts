import { z } from "zod";

/**
 * Quote create validation (Slice 1). The form serialises its dynamic line-item
 * rows into a single `line_items` JSON field; the action JSON-parses it before
 * this schema runs. Money is validated as numbers here but RE-COMPUTED
 * authoritatively server-side (lib/quotes/money.ts) — the client-sent
 * line_total/subtotal/total are never trusted.
 */

export const QuoteLineItemSchema = z.object({
  description: z.string().trim().min(1, "Each line needs a description"),
  qty: z.coerce
    .number()
    .refine((n) => Number.isFinite(n) && n > 0, "Qty must be greater than zero"),
  unit_price: z.coerce
    .number()
    .refine((n) => Number.isFinite(n) && n >= 0, "Unit price must be zero or more"),
});

export const QuoteInputSchema = z.object({
  // Empty string means "prospect" (no linked customer). Coerced to null later.
  customer_id: z.string().optional().default(""),
  customer_name: z.string().trim().min(1, "Customer name is required"),
  customer_address: z.string().optional().default(""),
  customer_email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("")),
  line_items: z
    .array(QuoteLineItemSchema)
    .min(1, "Add at least one line item"),
  vat_registered: z.boolean().default(false),
  vat_rate: z.coerce.number().min(0).max(100).default(20),
  terms: z.string().optional().default(""),
  valid_until: z.string().optional().default(""),
  notes: z.string().optional().default(""),
});

export type QuoteInput = z.infer<typeof QuoteInputSchema>;
