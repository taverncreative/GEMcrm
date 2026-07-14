-- GemCRM Database Schema
-- Single-company pest control CRM
-- Run this in the Supabase SQL Editor
--
-- ⚠️  OUT OF DATE — DO NOT TRUST FOR RLS OR SCHEMA. This snapshot predates
--     migration 029 (per-operation policies; the jobs/customers/etc. RLS here
--     is still the old single `FOR ALL using(true)/with check(true)` policy)
--     and every migration after it. It does NOT reflect the live database.
--     The migrations (supabase/migrations/) + setup.sql are the live source
--     of truth until the `000`-base reconcile lands (see CLAUDE.md "Standing
--     notes"). Reading RLS off this file is how the soft_delete_job bug was
--     misdiagnosed — don't repeat that.

-- ============================================================
-- TABLES
-- ============================================================

create table customers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  company_name text,
  email text,
  phone text
);

create table sites (
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

create table jobs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  job_date date not null,
  call_type text check (call_type in ('routine', 'callout', 'followup', 'survey')),
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

create table agreements (
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
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'cancelled'))
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'complete')),
  task_type text not null default 'general' check (task_type in ('general', 'follow_up', 'review_request')),
  related_job_id uuid references jobs (id) on delete set null,
  related_customer_id uuid references customers (id) on delete set null,
  site_id uuid references sites (id) on delete set null
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  report_type text not null default 'service',
  pdf_url text
);

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_customers_email on customers (email);
create index idx_customers_phone on customers (phone);
create index idx_sites_customer_id on sites (customer_id);
create index idx_jobs_site_id on jobs (site_id);
create index idx_jobs_job_date on jobs (job_date);
create index idx_jobs_site_date on jobs (site_id, job_date);
create index idx_jobs_status on jobs (job_status);
create index idx_jobs_agreement_id on jobs (agreement_id);
create index idx_agreements_customer_id on agreements (customer_id);
create index idx_agreements_status on agreements (status);
create index idx_tasks_due_date on tasks (due_date);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();

create trigger trg_sites_updated_at before update on sites
  for each row execute function set_updated_at();

create trigger trg_jobs_updated_at before update on jobs
  for each row execute function set_updated_at();

create trigger trg_agreements_updated_at before update on agreements
  for each row execute function set_updated_at();

create trigger trg_tasks_updated_at before update on tasks
  for each row execute function set_updated_at();

create trigger trg_reports_updated_at before update on reports
  for each row execute function set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table customers enable row level security;
alter table sites enable row level security;
alter table jobs enable row level security;
alter table agreements enable row level security;
alter table tasks enable row level security;
alter table reports enable row level security;

-- Authenticated users get full access (single-company system)
-- The `to authenticated` clause ensures anonymous/anon-key requests are denied.

create policy "Authenticated users full access" on customers
  for all to authenticated using (true) with check (true);

create policy "Authenticated users full access" on sites
  for all to authenticated using (true) with check (true);

create policy "Authenticated users full access" on jobs
  for all to authenticated using (true) with check (true);

create policy "Authenticated users full access" on agreements
  for all to authenticated using (true) with check (true);

create policy "Authenticated users full access" on tasks
  for all to authenticated using (true) with check (true);

create policy "Authenticated users full access" on reports
  for all to authenticated using (true) with check (true);
