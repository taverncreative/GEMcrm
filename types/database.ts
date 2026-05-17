// Database row types matching supabase/schema.sql
// These are the shapes returned by Supabase queries.

export type CustomerType = "commercial" | "domestic";

export interface Customer {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  customer_type: CustomerType;
  google_review_received: boolean;
  review_request_snoozed_until: string | null;
  review_email_sent_at: string | null;
  mobile: string | null;
  position: string | null;
  /** @deprecated Use structured address fields (address_line_1, etc).
   *  Kept for legacy reads — migration 026 backfills line 1 from this. */
  address: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
  website: string | null;
  notes: string | null;
  annual_contract_value: number | null;
}

export interface Site {
  id: string;
  customer_id: string;
  created_at: string;
  updated_at: string;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
}

export type CallType = "routine" | "callout" | "followup" | "survey" | "other";
export type RiskLevel = "low" | "medium" | "high";
export type JobStatus = "scheduled" | "in_progress" | "completed";

export interface Job {
  id: string;
  site_id: string;
  created_at: string;
  updated_at: string;
  job_date: string;
  /** Booked-in clock time ("HH:MM:SS" / "HH:MM"). Null means no specific
   *  time yet — UI shows "All day". */
  job_time: string | null;
  call_type: CallType | null;
  pest_species: string[];
  findings: string | null;
  recommendations: string | null;
  treatment: string | null;
  pesticides_used: string | null;
  risk_level: RiskLevel | null;
  risk_comments: string | null;
  technician_signature_url: string | null;
  client_signature_url: string | null;
  job_status: JobStatus;
  agreement_id: string | null;
  environmental_risk: string | null;
  environmental_comments: string | null;
  protected_species_present: boolean;
  method_used: string[];
  photo_urls: string[];
  client_present: boolean;
  client_name: string | null;
  report_notes: string | null;
  value: number | null;
  is_invoiced: boolean;
  is_paid: boolean;
  reference_number: string | null;
  parent_job_id: string | null;
}

export type InvoiceStatus = "draft" | "sent" | "paid";

export interface Invoice {
  id: string;
  job_id: string | null;
  customer_id: string;
  amount: number;
  status: InvoiceStatus;
  issued_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  invoice_number: string | null;
  description: string | null;
  due_date: string | null;
  pdf_url: string | null;
  subtotal_amount: number | null;
  vat_amount: number | null;
  vat_rate: number;
}

export type AgreementStatus = "active" | "paused" | "cancelled";

export interface Agreement {
  id: string;
  customer_id: string;
  site_id: string;
  created_at: string;
  updated_at: string;
  start_date: string | null;
  contract_value: number | null;
  visit_frequency: number | null;
  pest_species: string[] | null;
  callout_terms: string | null;
  status: AgreementStatus;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  invoice_address: string | null;
  terms_text: string | null;
  client_signature_url: string | null;
  gem_signature_url: string | null;
  signed_date: string | null;
  client_signatory_name: string | null;
  contract_pdf_url: string | null;
  end_date: string | null;
  reference_number: string | null;
  mobile: string | null;
}

export type TaskStatus = "pending" | "complete";
export type TaskType = "general" | "follow_up" | "review_request" | "contract_renewal";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  due_date: string | null;
  status: TaskStatus;
  task_type: TaskType;
  priority: TaskPriority;
  priority_order: number;
  completed_at: string | null;
  related_job_id: string | null;
  related_customer_id: string | null;
  agreement_id: string | null;
  site_id: string | null;
}

export interface Report {
  id: string;
  job_id: string;
  created_at: string;
  updated_at: string;
  report_type: string;
  pdf_url: string | null;
}
