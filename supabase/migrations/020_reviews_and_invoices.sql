-- 020: Review-request workflow + invoice creator extensions
-- ============================================================

-- ─── Customer review tracking ───────────────────────────────────────────
-- snoozed_until: when set + in the future, hide from the review-request
--   widget. Null means "not snoozed".
-- email_sent_at: when (or whether) we last auto-sent a review email. Used
--   to avoid double-sending.
alter table customers
  add column if not exists review_request_snoozed_until date;

alter table customers
  add column if not exists review_email_sent_at timestamptz;

-- ─── Invoice extensions ─────────────────────────────────────────────────
-- invoice_number: human-readable reference (e.g. INV-2026-1042). Unique.
-- description: free-text or single-line summary for invoices that aren't
--   tied to a job's `value`.
-- due_date: when payment is due. Defaults to issued_at + 30 days at app level.
-- pdf_url: generated invoice PDF in the reports bucket.

create sequence if not exists invoice_number_seq start 1000;

alter table invoices
  add column if not exists invoice_number text;

alter table invoices
  add column if not exists description text;

alter table invoices
  add column if not exists due_date date;

alter table invoices
  add column if not exists pdf_url text;

-- Backfill any null invoice_number values with a sequence-derived ref.
update invoices
set invoice_number = 'INV-' || to_char(coalesce(created_at, now()), 'YYYY') || '-' ||
  lpad(nextval('invoice_number_seq')::text, 4, '0')
where invoice_number is null;

-- Once backfilled, enforce uniqueness.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'invoices_invoice_number_unique'
  ) then
    create unique index invoices_invoice_number_unique
      on invoices (invoice_number) where invoice_number is not null;
  end if;
end $$;

create index if not exists idx_invoices_due_date
  on invoices (due_date) where due_date is not null;
