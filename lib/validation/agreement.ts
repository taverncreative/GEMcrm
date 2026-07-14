import { z } from "zod";

const AGREEMENT_STATUSES = ["draft", "active", "paused", "cancelled"] as const;

const optionalString = z.string().optional().default("");

export const AgreementSchema = z.object({
  customer_id: z.string().min(1, "Customer is required"),
  site_id: z.string().min(1, "Site is required"),

  // Page 1 — Customer & Contact Details (PMA JotForm)
  reference_number: z.string().min(1, "GEM Services Reference is required"),
  contact_name: z.string().min(1, "Company/Owner name is required"),
  contact_email: z.string().email("Enter a valid email"),
  contact_phone: z.string().min(1, "Telephone is required"),
  mobile: optionalString,
  invoice_address: z.string().min(1, "Invoice address is required"),

  // Page 2 — Agreement Details
  start_date: z.string().min(1, "Start date is required"),
  visit_frequency: z.coerce
    .number()
    .int()
    .min(1, "Must be at least 1 visit per year")
    .max(52, "Maximum 52 visits per year"),
  contract_value: z.coerce
    .number()
    .min(0, "Contract value cannot be negative"),
  pest_species: z
    .array(z.string())
    .min(1, "Select at least one pest species")
    .default([]),
  callout_terms: z.string().min(1, "Call out arrangement is required"),

  // Page 3 — Terms (text only, read-only in UI)
  terms_text: optionalString,

  // Page 4 — Signatures
  client_signature: z
    .string()
    .min(1, "Client signature is required"),
  gem_signature: z
    .string()
    .min(1, "GEM Services signature is required"),
  client_signatory_name: z
    .string()
    .min(1, "Signee name is required"),
  signed_date: optionalString,

  status: z.enum(AGREEMENT_STATUSES).default("active"),
  end_date: optionalString,
});

export { AGREEMENT_STATUSES };

export type AgreementInput = z.infer<typeof AgreementSchema>;

/**
 * A DRAFT agreement: the full personalised proposal MINUS the signatures.
 * Everything the review copy needs (reference, contact, dates, visits,
 * value, pests, callout terms, terms) stays required, so the customer
 * reviews a complete document; only the three signature fields become
 * optional (they are captured later at finalise, Slice 2).
 */
export const DraftAgreementSchema = AgreementSchema.extend({
  client_signature: optionalString,
  gem_signature: optionalString,
  client_signatory_name: optionalString,
});

export type DraftAgreementInput = z.infer<typeof DraftAgreementSchema>;
