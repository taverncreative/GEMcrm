import { z } from "zod";

const CALL_TYPES = ["routine", "callout", "followup", "survey", "other"] as const;

const optionalString = z.string().optional().default("");

/**
 * Required-when-Other gate for the call-type description, mirroring the
 * pest/method "Other" rule. Shared by both booking schemas via superRefine
 * (superRefine returns a ZodEffects, which is not extendable, so the base
 * object below stays a plain z.object and each export applies this).
 */
function requireOtherDesc(
  val: { call_type?: string; call_type_other_desc: string },
  ctx: z.RefinementCtx
): void {
  if (val.call_type === "other" && !val.call_type_other_desc.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Describe the other call type",
      path: ["call_type_other_desc"],
    });
  }
}

/**
 * Minimal booking fields — what you capture on the phone in 30 seconds.
 * No signatures, no findings, no risk assessment required. Those arrive
 * later on-site via the Service Sheet completion flow. Kept as a plain
 * object so BookingCreateSchema can .extend() it before refining.
 */
const BookingBase = z.object({
  site_id: z.string().min(1, "Site is required"),
  job_date: z.string().min(1, "Date is required"),
  // HH:MM (24h) from <input type="time">. Empty string = "all day".
  // With a window, job_time is the START; job_time_end is the end. DB
  // columns are `time` and reject malformed values; the picker already
  // constrains the shape (and prevents end <= start) so no regex here.
  job_time: optionalString,
  job_time_end: optionalString,
  call_type: z.enum(CALL_TYPES, { message: "Select a call type" }),
  /** Free-text description, required when call_type is "other" (enforced by
   *  requireOtherDesc). Stored in jobs.call_type_other_desc; the data layer
   *  clears it to null whenever the type is not "other". */
  call_type_other_desc: optionalString,
  pest_species: z.array(z.string()).default([]),
  value: z.coerce.number().min(0).optional(),
  report_notes: optionalString,
  parent_job_id: optionalString,
});

export const BookingSchema = BookingBase.superRefine(requireOtherDesc);

export type BookingInput = z.infer<typeof BookingSchema>;

/**
 * Lenient variant for the quick-add booking CREATE path only
 * (createQuickBookingAction): call_type may be blank ("" → null in
 * createBooking). Everything else matches BookingSchema. The strict
 * BookingSchema stays the contract for the site-page form and the
 * draft-upgrade flow, so those still reject a missing call type server-side.
 */
export const BookingCreateSchema = BookingBase.extend({
  call_type: z.enum(CALL_TYPES).or(z.literal("")).optional().default(""),
}).superRefine(requireOtherDesc);

export type BookingCreateInput = z.infer<typeof BookingCreateSchema>;

export { CALL_TYPES };
