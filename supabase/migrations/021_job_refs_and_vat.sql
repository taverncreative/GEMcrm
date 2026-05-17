-- 021: Per-job reference numbers + follow-up linkage + VAT breakdown on invoices
-- ============================================================
-- jobs.reference_number — human-readable, also reused as invoice_number
--   when an invoice is created from the job. Format:
--     00001            (domestic)
--     00001-BSK        (commercial, 3-letter company code)
--     00001-1          (1st follow-up of domestic)
--     00001-BSK-1      (1st follow-up of commercial)
-- jobs.parent_job_id  — follow-up jobs point to the parent so the suffix
--   can be derived and so the timeline of related work is visible.

alter table jobs
  add column if not exists reference_number text;

alter table jobs
  add column if not exists parent_job_id uuid references jobs(id) on delete set null;

create index if not exists idx_jobs_reference_number
  on jobs (reference_number);

create index if not exists idx_jobs_parent_id
  on jobs (parent_job_id);

-- VAT breakdown on invoices.
-- amount stays as the gross total. subtotal/vat are stored for the PDF
-- and so reports can sum either net or gross figures.
alter table invoices
  add column if not exists subtotal_amount numeric;

alter table invoices
  add column if not exists vat_amount numeric;

alter table invoices
  add column if not exists vat_rate numeric not null default 20;
