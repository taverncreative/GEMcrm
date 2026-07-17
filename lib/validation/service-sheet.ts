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

  pesticides_used: z.string().min(1, "Pesticides used is required"),

  risk_level: z.enum(RISK_LEVELS, { message: "Select a risk level" }),
  risk_comments: z.string().min(1, "Risk assessment comments are required"),

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
 */
export function isServiceSheetFilled(job: {
  findings: string | null;
  recommendations: string | null;
  pesticides_used: string | null;
  risk_level: string | null;
  risk_comments: string | null;
  pest_species: string[];
  method_used: string[];
}): boolean {
  return Boolean(
    job.findings?.trim() &&
      job.recommendations?.trim() &&
      job.pesticides_used?.trim() &&
      job.risk_level &&
      job.risk_comments?.trim() &&
      job.pest_species.length > 0 &&
      job.method_used.length > 0
  );
}
