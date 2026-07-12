-- GemCRM — Full Database Setup (single file)
-- ============================================================
-- This script is IDEMPOTENT — safe to re-run on a fresh project or
-- against an existing database. Every `create` statement is guarded
-- (`if not exists`, or drop-then-create for triggers/policies which
-- don't support the clause), and every `alter table … add column` is
-- guarded with `if not exists`. Running it twice should be a no-op.
--
-- Use this when you want a single SQL file that brings any database
-- up to the current schema. For incremental changes, prefer running
-- the individual migration file under `supabase/migrations/`.
-- ============================================================


-- ============================================================
-- BASE SCHEMA
-- ============================================================

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  company_name text,
  email text,
  phone text
);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  address_line_1 text,
  address_line_2 text,
  town text,
  county text,
  postcode text
);

create table if not exists agreements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  site_id uuid not null references sites (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  start_date date,
  contract_value numeric,
  visit_frequency integer,
  pest_species text[],
  callout_terms text,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled'))
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  job_date date not null,
  call_type text,
  pest_species text[],
  findings text,
  recommendations text,
  treatment text,
  pesticides_used text,
  risk_level text check (risk_level in ('low', 'medium', 'high')),
  risk_comments text,
  technician_signature_url text,
  client_signature_url text,
  job_status text not null default 'scheduled' check (job_status in ('scheduled', 'in_progress', 'completed')),
  agreement_id uuid references agreements(id) on delete set null
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'complete')),
  task_type text not null default 'general',
  related_job_id uuid references jobs (id) on delete set null,
  related_customer_id uuid references customers (id) on delete set null,
  site_id uuid references sites (id) on delete set null
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  report_type text not null default 'service',
  pdf_url text
);

-- Indexes
create index if not exists idx_customers_email on customers (email);
create index if not exists idx_customers_phone on customers (phone);
create index if not exists idx_sites_customer_id on sites (customer_id);
create index if not exists idx_jobs_site_id on jobs (site_id);
create index if not exists idx_jobs_job_date on jobs (job_date);
create index if not exists idx_jobs_site_date on jobs (site_id, job_date);
create index if not exists idx_jobs_status on jobs (job_status);
create index if not exists idx_jobs_agreement_id on jobs (agreement_id);
create index if not exists idx_agreements_customer_id on agreements (customer_id);
create index if not exists idx_agreements_status on agreements (status);
create index if not exists idx_tasks_due_date on tasks (due_date);

-- updated_at trigger function. `create or replace` is naturally idempotent.
create or replace function set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- Triggers — PG doesn't support `create or replace trigger` portably, so we
-- drop-then-create. The drop is a no-op on a fresh DB.
drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at before update on customers for each row execute function set_updated_at();
drop trigger if exists trg_sites_updated_at on sites;
create trigger trg_sites_updated_at before update on sites for each row execute function set_updated_at();
drop trigger if exists trg_jobs_updated_at on jobs;
create trigger trg_jobs_updated_at before update on jobs for each row execute function set_updated_at();
drop trigger if exists trg_agreements_updated_at on agreements;
create trigger trg_agreements_updated_at before update on agreements for each row execute function set_updated_at();
drop trigger if exists trg_tasks_updated_at on tasks;
create trigger trg_tasks_updated_at before update on tasks for each row execute function set_updated_at();
drop trigger if exists trg_reports_updated_at on reports;
create trigger trg_reports_updated_at before update on reports for each row execute function set_updated_at();

-- RLS — `enable row level security` is naturally idempotent.
alter table customers enable row level security;
alter table sites enable row level security;
alter table jobs enable row level security;
alter table agreements enable row level security;
alter table tasks enable row level security;
alter table reports enable row level security;

-- Policies — same drop-then-create story as triggers.
drop policy if exists "Authenticated users full access" on customers;
create policy "Authenticated users full access" on customers for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users full access" on sites;
create policy "Authenticated users full access" on sites for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users full access" on jobs;
create policy "Authenticated users full access" on jobs for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users full access" on agreements;
create policy "Authenticated users full access" on agreements for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users full access" on tasks;
create policy "Authenticated users full access" on tasks for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users full access" on reports;
create policy "Authenticated users full access" on reports for all to authenticated using (true) with check (true);


-- ============================================================
-- 004: Task type refinement
-- ============================================================
-- 'todo' is included here (not only in the 040 block at the tail) so this
-- canonical schema stays idempotent over an EXISTING DB that already holds
-- 'todo' rows: the rebuild applies setup.sql before truncating data, and a
-- 4-value constraint would re-validate against those rows and fail. The 040
-- block below re-affirms the same final set as the migration mirror.
alter table tasks drop constraint if exists tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check
  check (task_type in ('general', 'follow_up', 'review_request', 'contract_renewal', 'todo'));


-- ============================================================
-- 005: Archive flags + duplicate-job prevention
-- ============================================================
alter table customers  add column if not exists is_archived boolean not null default false;
alter table sites      add column if not exists is_archived boolean not null default false;
alter table jobs       add column if not exists is_archived boolean not null default false;
alter table agreements add column if not exists is_archived boolean not null default false;
alter table tasks      add column if not exists is_archived boolean not null default false;

create index if not exists idx_customers_archived  on customers  (is_archived);
create index if not exists idx_sites_archived      on sites      (is_archived);
create index if not exists idx_jobs_archived       on jobs       (is_archived);
create index if not exists idx_agreements_archived on agreements (is_archived);
create index if not exists idx_tasks_archived      on tasks      (is_archived);

create unique index if not exists idx_jobs_site_date_unique
  on jobs (site_id, job_date, call_type)
  where (is_archived = false AND agreement_id IS NULL);


-- ============================================================
-- 006: Daily summaries
-- ============================================================
create table if not exists daily_summaries (
  id uuid primary key default gen_random_uuid(),
  summary_date date not null unique,
  jobs_completed int not null default 0,
  tasks_completed int not null default 0,
  created_at timestamptz not null default now()
);

alter table daily_summaries enable row level security;
drop policy if exists "Authenticated users full access" on daily_summaries;
create policy "Authenticated users full access" on daily_summaries
  for all to authenticated using (true) with check (true);

create index if not exists idx_daily_summaries_date on daily_summaries (summary_date desc);


-- ============================================================
-- 007: Environmental fields on jobs (kept for older records; new UI no longer writes to them)
-- ============================================================
alter table jobs add column if not exists environmental_risk text;
alter table jobs add column if not exists environmental_comments text;
alter table jobs add column if not exists protected_species_present boolean not null default false;


-- ============================================================
-- 008: Agreement contract fields
-- ============================================================
alter table agreements add column if not exists contact_name text;
alter table agreements add column if not exists contact_phone text;
alter table agreements add column if not exists contact_email text;
alter table agreements add column if not exists invoice_address text;
alter table agreements add column if not exists terms_text text;
alter table agreements add column if not exists client_signature_url text;
alter table agreements add column if not exists gem_signature_url text;
alter table agreements add column if not exists signed_date date;
alter table agreements add column if not exists contract_pdf_url text;


-- ============================================================
-- 010: Job service record fields
-- ============================================================
alter table jobs add column if not exists method_used text[] not null default '{}';
alter table jobs add column if not exists photo_urls text[] not null default '{}';
alter table jobs add column if not exists client_present boolean not null default false;
alter table jobs add column if not exists client_name text;


-- ============================================================
-- 011: Agreement signatory + report notes
-- ============================================================
alter table agreements add column if not exists client_signatory_name text;
alter table jobs add column if not exists report_notes text;


-- ============================================================
-- 013: Task priority
-- ============================================================
alter table tasks add column if not exists priority text not null default 'medium';
alter table tasks drop constraint if exists tasks_priority_check;
alter table tasks add constraint tasks_priority_check
  check (priority in ('low', 'medium', 'high'));


-- ============================================================
-- 014: Agreement end_date, task completed_at
-- ============================================================
alter table agreements add column if not exists end_date date;
alter table tasks add column if not exists completed_at timestamptz;


-- ============================================================
-- 015: Priority order on tasks
-- ============================================================
alter table tasks add column if not exists priority_order int not null default 2;
-- One-time backfill from priority text — safe to re-run; just rewrites the
-- same values for any row whose priority hasn't been edited since.
update tasks set priority_order = case priority
  when 'high' then 3
  when 'medium' then 2
  when 'low' then 1
end;


-- ============================================================
-- 016: agreement_id on tasks
-- ============================================================
alter table tasks add column if not exists agreement_id uuid references agreements(id) on delete set null;
create index if not exists idx_tasks_agreement_id on tasks (agreement_id);


-- ============================================================
-- 017: Invoices + job revenue tracking
-- ============================================================
alter table jobs add column if not exists value numeric;
alter table jobs add column if not exists is_invoiced boolean not null default false;
alter table jobs add column if not exists is_paid boolean not null default false;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  amount numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_invoices_customer_id on invoices (customer_id);
create index if not exists idx_invoices_job_id on invoices (job_id);
create index if not exists idx_invoices_status on invoices (status) where status != 'paid';
create index if not exists idx_jobs_is_paid on jobs (is_paid) where is_paid = false;

alter table invoices enable row level security;
drop policy if exists "Authenticated users can manage invoices" on invoices;
create policy "Authenticated users can manage invoices"
  on invoices for all to authenticated using (true) with check (true);


-- ============================================================
-- 018: Form refresh — Service Sheet + PMA alignment
-- ============================================================
alter table jobs drop constraint if exists jobs_call_type_check;
alter table jobs add constraint jobs_call_type_check
  check (call_type in ('routine', 'callout', 'followup', 'survey', 'other'));

alter table agreements add column if not exists reference_number text;
alter table agreements add column if not exists mobile text;


-- ============================================================
-- 019: Customer type + Google review status
-- ============================================================
alter table customers add column if not exists customer_type text not null default 'commercial';
alter table customers drop constraint if exists customers_type_check;
alter table customers add constraint customers_type_check
  check (customer_type in ('commercial', 'domestic'));
alter table customers add column if not exists google_review_received boolean not null default false;
create index if not exists idx_customers_type on customers (customer_type);


-- ============================================================
-- 020: Review-request workflow + invoice extensions
-- ============================================================
alter table customers add column if not exists review_request_snoozed_until date;
alter table customers add column if not exists review_email_sent_at timestamptz;

create sequence if not exists invoice_number_seq start 1000;

alter table invoices add column if not exists invoice_number text;
alter table invoices add column if not exists description text;
alter table invoices add column if not exists due_date date;
alter table invoices add column if not exists pdf_url text;

update invoices set invoice_number = 'INV-' || to_char(coalesce(created_at, now()), 'YYYY') ||
  '-' || lpad(nextval('invoice_number_seq')::text, 4, '0')
where invoice_number is null;

do $$ begin
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


-- ============================================================
-- 021: Per-job reference numbers + VAT breakdown on invoices
-- ============================================================
alter table jobs add column if not exists reference_number text;
alter table jobs add column if not exists parent_job_id uuid references jobs(id) on delete set null;
create index if not exists idx_jobs_reference_number on jobs (reference_number);
create index if not exists idx_jobs_parent_id on jobs (parent_job_id);

alter table invoices add column if not exists subtotal_amount numeric;
alter table invoices add column if not exists vat_amount numeric;
alter table invoices add column if not exists vat_rate numeric not null default 20;


-- ============================================================
-- 022: Feature/bug request log
-- ============================================================
create table if not exists feature_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_type text not null check (request_type in ('feature', 'bug', 'change')),
  message text not null,
  status text not null default 'pending'
    check (status in ('pending', 'addressed', 'declined')),
  submitter_email text
);
alter table feature_requests enable row level security;
drop policy if exists "Authenticated users full access" on feature_requests;
create policy "Authenticated users full access" on feature_requests
  for all to authenticated using (true) with check (true);
create index if not exists idx_feature_requests_created
  on feature_requests (created_at desc);


-- ============================================================
-- 023: Backfill missing references + invoice numbers
-- ============================================================
do $$
declare
  rec record;
  i int;
  base text;
  code text;
  src text;
  letters text;
begin
  select coalesce(max((regexp_match(reference_number, '^(\d+)'))[1]::int), 0)
    into i from jobs where reference_number is not null;

  for rec in
    select j.id, c.customer_type, c.company_name, c.name
    from jobs j join sites s on s.id = j.site_id
    join customers c on c.id = s.customer_id
    where j.reference_number is null
    order by j.created_at asc
  loop
    i := i + 1;
    base := lpad(i::text, 5, '0');
    if rec.customer_type = 'commercial' then
      src := coalesce(rec.company_name, rec.name);
      letters := upper(regexp_replace(src, '[^a-zA-Z]', '', 'g'));
      code := rpad(left(letters, 3), 3, 'X');
      update jobs set reference_number = base || '-' || code where id = rec.id;
    else
      update jobs set reference_number = base where id = rec.id;
    end if;
  end loop;
end $$;

do $$
declare
  rec record;
  job_ref text;
  next_seq int;
  yr text;
begin
  select coalesce(max((regexp_match(invoice_number, '^INV-\d{4}-(\d+)$'))[1]::int), 1000) + 1
    into next_seq from invoices where invoice_number like 'INV-%';

  for rec in
    select id, job_id, created_at from invoices
    where invoice_number is null order by created_at asc
  loop
    job_ref := null;
    if rec.job_id is not null then
      select reference_number into job_ref from jobs where id = rec.job_id;
    end if;
    if job_ref is not null then
      update invoices set invoice_number = job_ref where id = rec.id;
    else
      yr := to_char(coalesce(rec.created_at, now()), 'YYYY');
      update invoices set invoice_number = 'INV-' || yr || '-' || lpad(next_seq::text, 4, '0')
        where id = rec.id;
      next_seq := next_seq + 1;
    end if;
  end loop;
end $$;


-- ============================================================
-- 024: Additional contact fields on customers
-- ============================================================
alter table customers add column if not exists mobile text;
alter table customers add column if not exists position text;
alter table customers add column if not exists address text;
alter table customers add column if not exists website text;
alter table customers add column if not exists notes text;


-- ============================================================
-- 025: Optional annual contract value on customers
-- ============================================================
alter table customers add column if not exists annual_contract_value numeric;


-- ============================================================
-- 026: Structured billing/registered address on customers
-- ============================================================
alter table customers add column if not exists address_line_1 text;
alter table customers add column if not exists address_line_2 text;
alter table customers add column if not exists town text;
alter table customers add column if not exists county text;
alter table customers add column if not exists postcode text;

update customers
   set address_line_1 = address
 where address is not null
   and address <> ''
   and address_line_1 is null;


-- ============================================================
-- 027: Booked-in time on jobs
-- ============================================================
alter table jobs add column if not exists job_time time;


-- ============================================================
-- 028: Backfill sites from existing customers' registered addresses
-- ============================================================
insert into sites (
  customer_id,
  address_line_1,
  address_line_2,
  town,
  county,
  postcode
)
select
  c.id,
  c.address_line_1,
  c.address_line_2,
  c.town,
  c.county,
  c.postcode
from customers c
where c.address_line_1 is not null and c.address_line_1 <> ''
  and c.town           is not null and c.town           <> ''
  and c.postcode       is not null and c.postcode       <> ''
  and not exists (
    select 1 from sites s where s.customer_id = c.id
  );


-- ============================================================
-- 029: Soft deletes for the 5 syncable entities
-- ============================================================
-- Adds `deleted_at timestamptz null` to customers/sites/jobs/agreements/
-- tasks. Splits the FOR ALL RLS policy on each into 4 per-operation
-- policies: SELECT filters `deleted_at IS NULL` (soft-deleted rows
-- disappear from every read), INSERT/UPDATE/DELETE keep USING(true) so
-- soft-delete + future restore + emergency hard-delete still work.
-- Extends the jobs partial unique index predicate to also exclude
-- soft-deleted rows so a slot can be re-used after soft delete.
alter table customers  add column if not exists deleted_at timestamptz;
alter table sites      add column if not exists deleted_at timestamptz;
alter table jobs       add column if not exists deleted_at timestamptz;
alter table agreements add column if not exists deleted_at timestamptz;
alter table tasks      add column if not exists deleted_at timestamptz;

create index if not exists idx_customers_live  on customers  (id) where deleted_at is null;
create index if not exists idx_sites_live      on sites      (id) where deleted_at is null;
create index if not exists idx_jobs_live       on jobs       (id) where deleted_at is null;
create index if not exists idx_agreements_live on agreements (id) where deleted_at is null;
create index if not exists idx_tasks_live      on tasks      (id) where deleted_at is null;

drop index if exists idx_jobs_site_date_unique;
create unique index idx_jobs_site_date_unique
  on jobs (site_id, job_date, call_type)
  where (is_archived = false and agreement_id is null and deleted_at is null);

-- Re-policy each of the 5 syncable tables. Same per-operation pattern
-- repeated; see migration 029 for the rationale.
do $$
declare t text;
begin
  foreach t in array array['customers','sites','jobs','agreements','tasks']
  loop
    execute format('drop policy if exists "Authenticated users full access"          on %I', t);
    execute format('drop policy if exists "Authenticated users can read non-deleted" on %I', t);
    execute format('drop policy if exists "Authenticated users can insert"           on %I', t);
    execute format('drop policy if exists "Authenticated users can update"           on %I', t);
    execute format('drop policy if exists "Authenticated users can delete (hard)"    on %I', t);
    execute format('create policy "Authenticated users can read non-deleted" on %I for select to authenticated using (deleted_at is null)', t);
    execute format('create policy "Authenticated users can insert"           on %I for insert to authenticated with check (true)', t);
    execute format('create policy "Authenticated users can update"           on %I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "Authenticated users can delete (hard)"    on %I for delete to authenticated using (true)', t);
  end loop;
end $$;


-- ============================================================
-- 030: Sync-pull RPC functions (SECURITY DEFINER)
-- ============================================================
-- One per syncable entity. Bypass RLS so the pull sync can see
-- soft-deleted rows (the SELECT policy filters `deleted_at IS NULL`
-- for every other read). Auth check inside each function body —
-- belt-and-braces against accidental EXECUTE grants. See
-- supabase/migrations/030_sync_pull_functions.sql for full rationale.
do $$
declare t text;
begin
  foreach t in array array['customers','sites','jobs','agreements','tasks']
  loop
    execute format($f$
      create or replace function public.sync_pull_%1$s(since timestamptz)
      returns setof public.%1$s
      language plpgsql
      security definer
      set search_path = public
      as $body$
      begin
        if auth.uid() is null then
          raise exception 'sync_pull_%1$s: not authenticated';
        end if;
        return query
          select *
            from public.%1$s
           where since is null or updated_at > since
           order by updated_at asc;
      end;
      $body$;
    $f$, t);
    execute format('revoke execute on function public.sync_pull_%I(timestamptz) from public', t);
    execute format('grant  execute on function public.sync_pull_%I(timestamptz) to authenticated', t);
  end loop;
end $$;


-- ============================================================
-- 031: invoice_jobs join table (multi-job → one invoice)
-- ============================================================
-- N jobs per invoice; a job appears on at most one invoice
-- (unique job_id). invoices.job_id is deprecated but kept as the
-- legacy read path. See supabase/migrations/031_invoice_jobs.sql
-- for full rationale.

create table if not exists invoice_jobs (
  invoice_id uuid not null references invoices (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (invoice_id, job_id),
  constraint invoice_jobs_job_id_unique unique (job_id)
);

alter table invoice_jobs enable row level security;
drop policy if exists "Authenticated users can manage invoice_jobs" on invoice_jobs;
create policy "Authenticated users can manage invoice_jobs"
  on invoice_jobs for all
  to authenticated
  using (true)
  with check (true);

insert into invoice_jobs (invoice_id, job_id)
select id, job_id
from invoices
where job_id is not null
on conflict do nothing;


-- ============================================================
-- 032: soft_delete_customer SECURITY DEFINER RPC
-- ============================================================
-- The SELECT policy's USING (deleted_at IS NULL) is enforced against
-- the post-update row, so the update that sets deleted_at is itself
-- rejected (42501). Narrowest bypass: a SECURITY DEFINER function;
-- read policies untouched. Customers only — sites/jobs/tasks/
-- agreements get the same pattern when their archive actions are
-- built. See supabase/migrations/032_soft_delete_customer_rpc.sql.

create or replace function public.soft_delete_customer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_customer: not authenticated';
  end if;

  update public.customers
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_customer(uuid) from public;
revoke all on function public.soft_delete_customer(uuid) from anon;
grant execute on function public.soft_delete_customer(uuid) to authenticated;


-- ============================================================
-- 038: soft_delete_job SECURITY DEFINER RPC
-- ============================================================
-- Jobs share the identical RLS gap the 032 header anticipated: the
-- SELECT policy's USING (deleted_at IS NULL) is enforced against the
-- post-update row, so a plain deleted_at update is rejected (42501).
-- Same narrowest bypass as soft_delete_customer. Kept here (not just in
-- migration 038) so a local rebuild from setup.sql matches prod — the
-- job Delete button calls this RPC and 500s (PGRST202) without it.
-- See supabase/migrations/038_soft_delete_job_rpc.sql.

create or replace function public.soft_delete_job(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_job: not authenticated';
  end if;

  update public.jobs
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_job(uuid) from public;
revoke all on function public.soft_delete_job(uuid) from anon;
grant execute on function public.soft_delete_job(uuid) to authenticated;


-- ============================================================
-- 033: report-email truth on jobs (L3)
-- ============================================================
-- Written server-side only when a report email actually SENDS
-- (approve / amend Save & Email / Send report now). Null = not
-- emailed. See supabase/migrations/033_report_email_truth.sql.

alter table jobs
  add column if not exists report_emailed_to text,
  add column if not exists report_emailed_at timestamptz;


-- ============================================================
-- 034: draft jobs + time-window/capture schema foundation (Q0)
-- ============================================================
-- Quick job capture: a draft is a real jobs row with a distinct status
-- value and a null site, gated by a CHECK. New status value + the two
-- nullable columns flow through sync_pull_jobs (`select *`) and the
-- Dexie mirror with no RPC/schema bump. See
-- supabase/migrations/034_draft_jobs_and_window.sql.
-- NOTE: when the L4 completed-requires-filled-sheet CHECK lands, it
-- MUST exclude draft rows (gate on job_status = 'completed' only).

alter table jobs drop constraint if exists jobs_job_status_check;
alter table jobs add constraint jobs_job_status_check
  check (job_status in ('scheduled', 'in_progress', 'completed', 'draft'));

alter table jobs alter column site_id drop not null;
alter table jobs drop constraint if exists jobs_draft_site_check;
alter table jobs add constraint jobs_draft_site_check
  check (site_id is not null or job_status = 'draft');

alter table jobs add column if not exists capture_note text;
alter table jobs add column if not exists job_time_end time;


-- ============================================================
-- 035: L4 — completed jobs require a filled service sheet
-- ============================================================
-- DB backstop mirroring isServiceSheetFilled (lib/validation/
-- service-sheet.ts) EXACTLY: a completed job must carry a filled sheet
-- (findings/recommendations/pesticides_used/risk_comments non-empty
-- trimmed, risk_level non-empty, pest_species + method_used non-empty).
-- Gate is `job_status <> 'completed' OR (...)`, so draft / scheduled /
-- in_progress pass vacuously. The completion write order keeps this
-- safe (fields persisted before the status flip). See
-- supabase/migrations/035_completed_requires_filled_sheet.sql.

alter table jobs drop constraint if exists jobs_completed_requires_filled_sheet;
alter table jobs add constraint jobs_completed_requires_filled_sheet
  check (
    job_status <> 'completed'
    or (
      findings is not null and btrim(findings) <> ''
      and recommendations is not null and btrim(recommendations) <> ''
      and pesticides_used is not null and btrim(pesticides_used) <> ''
      and risk_level is not null and risk_level <> ''
      and risk_comments is not null and btrim(risk_comments) <> ''
      and coalesce(array_length(pest_species, 1), 0) > 0
      and coalesce(array_length(method_used, 1), 0) > 0
    )
  );


-- ============================================================
-- 036: optional structured contact on draft jobs (Track 2)
-- ============================================================
-- Two nullable contact columns on draft quick-captures (caller name +
-- phone), captured at intake when a usually-new customer phones in.
-- Distinct from the service-sheet's client_name. Additive, nullable, no
-- backfill; sync_pull_jobs is `select *` so no RPC change; not indexed so
-- no Dexie bump. See supabase/migrations/036_draft_contact.sql.

alter table jobs add column if not exists draft_contact_name text;
alter table jobs add column if not exists draft_contact_phone text;


-- ============================================================
-- 037: unified sequential invoice numbering
-- ============================================================
-- ONE sequential INV-YYYY-NNNN register across every creation path via a
-- BEFORE INSERT trigger off invoice_number_seq (the app no longer assigns
-- numbers; the single-job job-ref reuse is dropped). VAT is NOT touched
-- here — GEM is not VAT-registered yet, so invoices carry no VAT; that is
-- gated in the app behind BUSINESS.vatRegistered (a flag flip when GEM
-- registers, not a migration). See supabase/migrations/037_invoice_numbering.sql.

create sequence if not exists invoice_number_seq start 1000;

select setval(
  'invoice_number_seq',
  greatest(
    (select last_value from invoice_number_seq),
    (select coalesce(
       max((regexp_match(invoice_number, '^INV-\d{4}-(\d+)$'))[1]::int), 1000)
     from invoices)
  ),
  true
);

update invoices
set invoice_number = 'INV-' || to_char(coalesce(created_at, now()), 'YYYY') || '-' ||
  lpad(nextval('invoice_number_seq')::text, 4, '0')
where invoice_number is null;

create or replace function assign_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'INV-' || to_char(coalesce(new.created_at, now()), 'YYYY')
      || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_invoice_number on invoices;
create trigger trg_assign_invoice_number
  before insert on invoices
  for each row
  execute function assign_invoice_number();

do $$ begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'invoices_invoice_number_unique'
  ) then
    create unique index invoices_invoice_number_unique
      on invoices (invoice_number) where invoice_number is not null;
  end if;
end $$;


-- ============================================================
-- Storage bucket: "reports" for signatures, photos, and PDFs
-- ============================================================
-- H1: PRIVATE bucket. It holds customer PII (service reports, signed
-- agreements, invoices, site photos, signatures) — public-read exposed
-- all of it to anyone with the URL. The app now streams objects through
-- the auth-gated proxy (/api/storage/reports/[...path], service-role
-- download); emailed customer links use short-lived signed URLs.
insert into storage.buckets (id, name, public)
  values ('reports', 'reports', false)
on conflict (id) do nothing;
-- Idempotent for an already-created bucket: force it private on re-run.
update storage.buckets set public = false where id = 'reports';

-- Authenticated users may upload / update / delete files. There is NO
-- read policy: reads go through the service-role proxy (which bypasses
-- RLS), so nothing public or anon-readable is granted.
-- Drop-then-create keeps these idempotent across re-runs.
drop policy if exists "Authenticated users can upload reports" on storage.objects;
create policy "Authenticated users can upload reports"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'reports');

drop policy if exists "Authenticated users can update reports" on storage.objects;
create policy "Authenticated users can update reports"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'reports')
  with check (bucket_id = 'reports');

drop policy if exists "Authenticated users can delete reports" on storage.objects;
create policy "Authenticated users can delete reports"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'reports');

-- H1: remove the old public read policy — the bucket is private now and
-- all reads go through the service-role proxy. Left as a drop (no
-- recreate) so a rebuild lands the private state.
drop policy if exists "Anyone can read reports" on storage.objects;


-- ============================================================
-- 039: defence-in-depth grants (belt-and-braces; RLS is the real gate)
-- ============================================================
-- See supabase/migrations/039_defence_in_depth_grants.sql for the full
-- rationale. Placed at the end so every table already exists.
--
-- M2: anon gets NO table access. RLS already blocks it (all policies are
-- `to authenticated`); this removes the single-point-of-failure where an
-- accidental RLS-disable would expose data to the public anon key.
revoke all on all tables in schema public from anon;

-- M1: authenticated cannot HARD-delete the five core tables — all deletes
-- go through the soft_delete_<table> SECURITY DEFINER RPCs (UPDATE as
-- owner, unaffected). invoices / invoice_jobs keep DELETE (invoice-create
-- rollback issues a real delete on its own row).
revoke delete, truncate on public.customers  from authenticated;
revoke delete, truncate on public.sites       from authenticated;
revoke delete, truncate on public.jobs        from authenticated;
revoke delete, truncate on public.agreements  from authenticated;
revoke delete, truncate on public.tasks       from authenticated;


-- ============================================================
-- 040: manual to-do task type + optional notes on tasks
-- ============================================================
-- See supabase/migrations/040_task_todo_type_and_notes.sql for the full
-- rationale. Tasks module v1, two additive changes:
--   1. 'todo' joins the task_type CHECK. Existing rows keep their type, so
--      the auto-follow-up widgets (overdue + customers-to-contact) that key
--      off task_type are unchanged; new manual to-dos are written as 'todo'
--      and filtered out of those surfaces.
--   2. A nullable `notes` column backs the optional free-text on the manual
--      create form. NULL for every existing row and every auto-created task.
-- The default stays 'general', so any insert that omits task_type is
-- unchanged. Constraint name matches migrations 004/014 so the
-- drop-then-add cleanly replaces the live constraint.
alter table tasks drop constraint if exists tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check
  check (task_type in ('general', 'follow_up', 'review_request', 'contract_renewal', 'todo'));

alter table tasks add column if not exists notes text;
