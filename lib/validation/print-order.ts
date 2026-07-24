import { z } from "zod";

/**
 * Print-order validation — shared by the basket UI (immediate feedback) and
 * the submit action (authoritative gate), so the two never disagree. The
 * limits mirror Spotlight's contract exactly: 1–100 items, name 1–300 chars,
 * quantity an integer 1–10000. Body-size (<16KB) is enforced separately in
 * the Spotlight service, since it depends on the serialised payload.
 */

export const PRINT_ORDER_LIMITS = {
  maxItems: 100,
  nameMax: 300,
  quantityMin: 1,
  quantityMax: 10000,
  noteMax: 2000,
} as const;

export const PrintOrderItemSchema = z.object({
  /** The source library document's id — stable across renames. */
  reference: z.string().min(1),
  name: z.string().min(1).max(PRINT_ORDER_LIMITS.nameMax),
  quantity: z
    .number()
    .int()
    .min(PRINT_ORDER_LIMITS.quantityMin)
    .max(PRINT_ORDER_LIMITS.quantityMax),
});

export const PrintOrderSchema = z.object({
  /** Client-generated order id (idempotency key). */
  orderId: z.string().uuid(),
  items: z
    .array(PrintOrderItemSchema)
    .min(1)
    .max(PRINT_ORDER_LIMITS.maxItems),
  note: z.string().max(PRINT_ORDER_LIMITS.noteMax).optional(),
});

export type PrintOrderItemInput = z.infer<typeof PrintOrderItemSchema>;
export type PrintOrderInput = z.infer<typeof PrintOrderSchema>;

/** Clamp a raw quantity to the allowed integer range (for the basket UI). */
export function clampQuantity(raw: number): number {
  if (!Number.isFinite(raw)) return PRINT_ORDER_LIMITS.quantityMin;
  const n = Math.round(raw);
  if (n < PRINT_ORDER_LIMITS.quantityMin) return PRINT_ORDER_LIMITS.quantityMin;
  if (n > PRINT_ORDER_LIMITS.quantityMax) return PRINT_ORDER_LIMITS.quantityMax;
  return n;
}
