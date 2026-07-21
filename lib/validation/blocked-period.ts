import { z } from "zod";

/**
 * Block-out day create/edit schema (migration 046).
 *
 * A required free-text `title` (the reason), a required `start_date`
 * (YYYY-MM-DD from <input type="date">), and an `end_date` that defaults
 * to the start when omitted — so a single-day block is one tap. The range
 * is inclusive and `end_date` must be >= `start_date`, mirroring the SQL
 * CHECK constraint so the client guard and the DB guard agree.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const BlockedPeriodSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Reason is required")
      .max(200, "Reason is too long"),
    start_date: z.string().regex(ISO_DATE, "Pick a valid start date"),
    // Optional in the form; "" means "same as start" (single day).
    end_date: z
      .string()
      .regex(ISO_DATE, "Pick a valid end date")
      .or(z.literal(""))
      .optional()
      .default(""),
  })
  // Normalise: an empty end_date collapses to start_date (single-day block).
  .transform((v) => ({
    ...v,
    end_date: v.end_date === "" ? v.start_date : v.end_date,
  }))
  // Enforce end >= start (matches blocked_periods_date_order CHECK).
  .refine((v) => v.end_date >= v.start_date, {
    message: "End date can't be before the start date",
    path: ["end_date"],
  });

export type BlockedPeriodInput = z.infer<typeof BlockedPeriodSchema>;
