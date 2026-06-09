-- 031: invoice_jobs join table (multi-job → one invoice, Pass A)
-- ============================================================
-- Invoicing is becoming job-driven: the operator multi-selects jobs on
-- the Jobs list and raises ONE invoice covering all of them. The legacy
-- `invoices.job_id` column can hold at most one job, so the link moves
-- to a join table.
--
-- Cardinality: N jobs per invoice, but a job appears on AT MOST ONE
-- invoice — `unique (job_id)` preserves the 1:1 semantics today's code
-- assumes (`jobs.is_invoiced`, `getInvoiceByJobId`'s `.maybeSingle()`).
-- Relax by dropping that constraint if credit notes / re-invoicing
-- ever need a job on several invoices.
--
-- Delete rules (deliberately NOT a copy of invoices.job_id's cascade):
--   * invoice deleted → its link rows go too (cascade) — the invoice
--     owns the links.
--   * job deleted → RESTRICT. A job on an invoice is a billing record;
--     hard-deleting it must fail rather than silently unlink (the app
--     soft-deletes jobs anyway — migration 029).
--
-- `invoices.job_id` is DEPRECATED as of this migration but kept as the
-- legacy read path: markInvoicePaid / getInvoiceByJobId / the email
-- builder still read it. New writes move to invoice_jobs in Pass B;
-- readers migrate in Pass B/C. Do not drop until nothing reads it.
--
-- Idempotent: `if not exists` + `on conflict do nothing`. Safe to re-run.

create table if not exists invoice_jobs (
  invoice_id uuid not null references invoices (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (invoice_id, job_id),
  constraint invoice_jobs_job_id_unique unique (job_id)
);

-- The PK gives invoice → jobs lookups (invoice_id is the leading
-- column); the unique constraint's index gives job → invoice lookups.
-- No further indexes needed.

-- RLS — same single-operator policy shape as invoices (017). Without
-- this the table would be exposed to the anon role via PostgREST.
alter table invoice_jobs enable row level security;
drop policy if exists "Authenticated users can manage invoice_jobs" on invoice_jobs;
create policy "Authenticated users can manage invoice_jobs"
  on invoice_jobs for all
  to authenticated
  using (true)
  with check (true);

-- Backfill from the legacy column. `on conflict do nothing` keeps the
-- re-run safe; it would also skip the second row of any pair of
-- invoices pointing at the same job — verification compares row counts
-- precisely to surface that (none expected: the app has always written
-- at most one invoice per job).
insert into invoice_jobs (invoice_id, job_id)
select id, job_id
from invoices
where job_id is not null
on conflict do nothing;

-- DOWN (manual rollback):
--   drop table if exists invoice_jobs;
-- (No changes to invoices/jobs to revert — the legacy column was left
-- untouched.)
