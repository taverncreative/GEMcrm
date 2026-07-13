// Database row types matching supabase/schema.sql
// These are the shapes returned by Supabase queries.

export type CustomerType = "commercial" | "domestic";

export interface Customer {
  id: string;
  created_at: string;
  updated_at: string;
  /** Set when the row is soft-deleted (migration 029). RLS filters
   *  deleted rows out of every read, so callers normally won't see
   *  this populated — present on the type for completeness + admin /
   *  restore paths that bypass RLS. */
  deleted_at: string | null;
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
  /** See `Customer.deleted_at`. */
  deleted_at: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
}

export type CallType = "routine" | "callout" | "followup" | "survey" | "other";
export type RiskLevel = "low" | "medium" | "high";
export type JobStatus = "scheduled" | "in_progress" | "completed" | "draft";

export interface Job {
  id: string;
  /** Null ONLY for `draft` jobs (quick capture, Q2) — a DB CHECK
   *  enforces site_id IS NOT NULL for every non-draft status. Reads
   *  that follow site -> customer must guard for the draft case. */
  site_id: string | null;
  created_at: string;
  updated_at: string;
  /** See `Customer.deleted_at`. */
  deleted_at: string | null;
  job_date: string;
  /** Booked-in clock time ("HH:MM:SS" / "HH:MM"). With a window this is
   *  the START; null means no specific time — UI shows "All day". The
   *  soonest-first sort keys on this. */
  job_time: string | null;
  /** Arrival-window END (Q1). Null when the booking is a single time or
   *  all-day. Always >= job_time when both are set. */
  job_time_end: string | null;
  /** Quick-capture phrase ("Sarah, Wasps, Folkestone") on a draft job
   *  (Q0 column). Null on normal bookings. */
  capture_note: string | null;
  /** Optional caller contact jotted at quick-capture (Track 2, migration
   *  036) — the everyday trigger is a usually-new customer phoning in.
   *  Deliberately DISTINCT from `client_name` (the service-sheet's "client
   *  present at the visit"). Read at upgrade to pre-fill / local-match the
   *  customer; only ever set on draft rows.
   *
   *  Optional on the TYPE (like `is_archived`): the column flows through
   *  `sync_pull_jobs` (`select *`), so freshly-pulled rows carry it as a
   *  value-or-null — but draft rows synced into Dexie BEFORE 036 lack the
   *  field entirely (`undefined`) until re-pulled. Readers use `?? null`. */
  draft_contact_name?: string | null;
  draft_contact_phone?: string | null;
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
  /** "Invoices required" checklist flag (migration 041). Operator-set via
   *  the service-sheet checkbox or the job-detail toggle; flagged jobs
   *  collect in the homepage checklist and are ticked off once billed in
   *  QuickBooks. Independent of the legacy is_invoiced flag. */
  needs_invoice: boolean;
  reference_number: string | null;
  /** L3 email truth (migration 033): set server-side ONLY when a report
   *  email actually sends. Null = never emailed. */
  report_emailed_to: string | null;
  report_emailed_at: string | null;
  parent_job_id: string | null;
  /**
   * Server-side "hide from normal views without deleting" flag added
   * by migration 005. The Supabase pull RPC (`sync_pull_jobs`)
   * returns the column as part of `setof public.jobs`, so it IS
   * present on synced rows — but the offline-PWA roll-out missed it
   * from this interface and the server's READ-side filters (e.g.
   * `getCustomerDetail`'s `.eq("is_archived", false)`) had no
   * Dexie-side equivalent. Result: archived jobs would surface
   * offline in the customer side panel that don't appear online.
   *
   * Added now as part of Surface 3 (customer side panel) so client
   * reads can match the server's archive filter. No Dexie schema
   * bump — the column is read-filtered in JS at the query site, NOT
   * indexed (chosen explicitly to avoid another schema migration
   * after the v4 bump caused boot grief).
   *
   * Pre-existing job rows synced before this addition will have
   * `is_archived === undefined` at runtime (the column was always
   * in the pull payload, but the field name was absent from the TS
   * type, so callers didn't read it). For safety the filter site
   * checks `!j.is_archived`, which is true for both `false` and
   * `undefined` — newly synced rows have the explicit boolean.
   */
  is_archived?: boolean;
}

export type InvoiceStatus = "draft" | "sent" | "paid";

export interface Invoice {
  id: string;
  /** DEPRECATED (migration 031): legacy single-job link, dual-written
   *  only for single-job invoices. invoice_jobs is the canonical link. */
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

/** Join row linking an invoice to a job it covers (migration 031).
 *  N jobs per invoice; a job appears on at most one invoice
 *  (unique job_id). Supersedes the deprecated `invoices.job_id`. */
export interface InvoiceJob {
  invoice_id: string;
  job_id: string;
  created_at: string;
}

export type AgreementStatus = "active" | "paused" | "cancelled";

export interface Agreement {
  id: string;
  customer_id: string;
  site_id: string;
  created_at: string;
  updated_at: string;
  /** See `Customer.deleted_at`. */
  deleted_at: string | null;
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
export type TaskType =
  | "general"
  | "follow_up"
  | "review_request"
  | "contract_renewal"
  // Manually-created personal to-do (Tasks module v1). Filtered OUT of
  // the auto-follow-up customer surfaces (overdue + customers-to-contact)
  // so personal to-dos never pollute them; shown on the calendar and in
  // "Tasks Due Today".
  | "todo";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  created_at: string;
  updated_at: string;
  /** See `Customer.deleted_at`. */
  deleted_at: string | null;
  title: string;
  due_date: string | null;
  /** Optional free-text, captured on the manual to-do create form
   *  (migration 039). NULL for auto-created tasks and pre-039 rows. */
  notes: string | null;
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
