import { z } from "zod";

const CALL_TYPES = ["routine", "callout", "followup", "survey", "other"] as const;

const optionalString = z.string().optional().default("");

/**
 * Minimal booking schema — what you capture on the phone in 30 seconds.
 * No signatures, no findings, no risk assessment required. Those arrive
 * later on-site via the Service Sheet completion flow.
 */
export const BookingSchema = z.object({
  site_id: z.string().min(1, "Site is required"),
  job_date: z.string().min(1, "Date is required"),
  // HH:MM (24h) from <input type="time">. Empty string = "all day".
  // DB column is `time` and will reject malformed values; the form input
  // already constrains the shape so no extra regex needed here.
  job_time: optionalString,
  call_type: z.enum(CALL_TYPES, { message: "Select a call type" }),
  pest_species: z.array(z.string()).default([]),
  value: z.coerce.number().min(0).optional(),
  report_notes: optionalString,
  parent_job_id: optionalString,
});

export type BookingInput = z.infer<typeof BookingSchema>;
export { CALL_TYPES };
