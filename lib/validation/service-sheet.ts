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
});

export type ServiceSheetInput = z.infer<typeof ServiceSheetSchema>;
export { RISK_LEVELS, CALL_TYPES };
