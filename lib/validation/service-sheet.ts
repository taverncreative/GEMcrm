import { z } from "zod";

const RISK_LEVELS = ["low", "medium", "high"] as const;
const optionalString = z.string().optional().default("");

/**
 * Treatment checkbox options for the Service Sheet.
 * Values stored in jobs.method_used[].
 */
export const TREATMENT_METHODS = [
  "Survey",
  "Inspection",
  "Liquid Spray",
  "Fumigation",
  "Rodenticide Used",
  "Insecticide Used",
  "Burrows Baited",
  "Other",
] as const;

/**
 * Schema for completing an existing booking's Service Sheet.
 *
 * Note: site_id + job_date + call_type are inherited from the booking;
 * they are not re-captured here. This runs server-side against an existing
 * job row and updates it into a "completed" state.
 */
const CALL_TYPES = ["routine", "callout", "followup", "survey", "other"] as const;

/**
 * One structured "Products Used" row (migration 047). Snapshot of the picked
 * product + a completely free-text quantity (never parsed). chemical_name is
 * nullable (the on-site "can't supply yet" case). Lenient by design — the form
 * builds these, so we coerce rather than reject a partially-filled row.
 */
export const ProductUsedSchema = z.object({
  product_id: z.string().nullable().default(null),
  brand_name: z.string().default(""),
  chemical_name: z.string().nullable().default(null),
  quantity: z.string().default(""),
});

export const ServiceSheetSchema = z.object({
  job_id: z.string().min(1, "Job ID required"),

  call_type: z.enum(CALL_TYPES, { message: "Select a call type" }),
  /** Free-text description, required when call_type is "other" (enforced by
   *  the superRefine below). Stored in jobs.call_type_other_desc; the data
   *  layer clears it to null whenever the type is not "other". */
  call_type_other_desc: optionalString,

  pest_species: z
    .array(z.string())
    .min(1, "Select at least one pest species")
    .default([]),

  findings: z.string().min(1, "Findings are required"),
  recommendations: z.string().min(1, "Recommendations are required"),
  report_notes: optionalString,

  method_used: z
    .array(z.string())
    .min(1, "Select at least one treatment")
    .default([]),

  // Structured "Products Used" rows (migration 047). OPTIONAL — zero products
  // is a VALID completed sheet (survey/inspection visits apply nothing, and
  // forcing a dummy row corrupts the record). Replaces the old required
  // free-text `pesticides_used`. MUST stay optional in lockstep with the DB
  // constraint + isServiceSheetFilled (see the note on both) — if any of the
  // three requires a product the others don't, completion breaks.
  products_used: z.array(ProductUsedSchema).default([]),

  risk_level: z.enum(RISK_LEVELS, { message: "Select a risk level" }),
  risk_comments: z.string().min(1, "Risk assessment comments are required"),

  /** "Environmental risk assessment" tick. Transient FILLING state only —
   *  there is no era_required column. Presence of environmental_comments IS
   *  the flag on the row (see the note there), so this rides the form purely
   *  to drive the required-when-ticked rule below and the null-on-storage
   *  clear. Coerced + defaulted like client_present, so an unticked box
   *  (absent key) is a clean false. */
  era_required: z.coerce.boolean().default(false),
  /** ERA free text → jobs.environmental_comments. OPTIONAL: most jobs need no
   *  ERA (it applies when toxic bait is used outdoors), so it is absent from
   *  isServiceSheetFilled and from the DB completion CHECK, and can never
   *  block a completion. Required ONLY when era_required is ticked, enforced
   *  in the superRefine below — the call_type_other_desc pattern exactly. */
  environmental_comments: optionalString,

  photo_data_urls: z.array(z.string()).default([]),

  technician_signature: z
    .string()
    .min(1, "Technician signature is required"),
  client_present: z.coerce.boolean().default(false),
  client_signature: optionalString,
  client_name: optionalString,
  /** "Invoice required" checkbox — flags the job for the QuickBooks
   *  billing checklist. Coerced + defaulted like client_present so an
   *  unchecked box (absent key) is a clean false. */
  invoice_required: z.coerce.boolean().default(false),
}).superRefine((val, ctx) => {
  // Required-when-Other, mirroring the pest/method "Other" gate.
  if (val.call_type === "other" && !val.call_type_other_desc.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Describe the other call type",
      path: ["call_type_other_desc"],
    });
  }
  // Required-when-ticked, same shape as the "Other" gates above. Ticking the
  // box and leaving it empty means the tick says nothing, so it blocks. The
  // message carries the escape hatch: unticking is always a valid way out,
  // because the ERA itself is optional.
  if (val.era_required && !val.environmental_comments.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Describe the environmental risk, or untick the box",
      path: ["environmental_comments"],
    });
  }
});

export type ServiceSheetInput = z.infer<typeof ServiceSheetSchema>;
export { RISK_LEVELS, CALL_TYPES };

/**
 * True once the sheet's required CONTENT fields are present on the job
 * row — the same fields ServiceSheetSchema requires, minus the
 * signature (a completion artifact, not report content). Any sheet
 * completed through the app's flow passes; a dropdown-completed job
 * with an untouched sheet does not.
 *
 * Gates report generation (button + server action) so a PDF can never
 * be produced from an unfilled sheet — generating one used to yield a
 * placeholder report that the old completion auto-send could mail.
 *
 * CRITICAL — this predicate MUST match the DB CHECK
 * `jobs_completed_requires_filled_sheet` (migration 047) and
 * ServiceSheetSchema EXACTLY, or you get "DB rejects what the app allowed"
 * completion failures. Migration 047 DROPPED the products/pesticides
 * requirement (zero products is a valid survey visit), so this NO LONGER
 * checks pesticides_used or products_used. Change all three together.
 *
 * environmental_comments (the ERA box) is deliberately NOT here: it applies
 * to a minority of jobs (toxic bait used outdoors) and must never block a
 * completion. It is absent from the DB CHECK for the same reason, so all
 * three stay in agreement.
 */
export function isServiceSheetFilled(job: {
  findings: string | null;
  recommendations: string | null;
  risk_level: string | null;
  risk_comments: string | null;
  pest_species: string[];
  method_used: string[];
}): boolean {
  return Boolean(
    job.findings?.trim() &&
      job.recommendations?.trim() &&
      job.risk_level &&
      job.risk_comments?.trim() &&
      job.pest_species.length > 0 &&
      job.method_used.length > 0
  );
}
