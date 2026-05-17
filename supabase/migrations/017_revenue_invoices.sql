-- Extend jobs with revenue tracking
alter table jobs add column value numeric;
alter table jobs add column is_invoiced boolean not null default false;
alter table jobs add column is_paid boolean not null default false;

-- Invoices table
create table invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  amount numeric not null default 0,
  status text not null default 'draft',
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_status_check check (status in ('draft', 'sent', 'paid'))
);

-- Indexes
create index idx_invoices_customer_id on invoices (customer_id);
create index idx_invoices_job_id on invoices (job_id);
create index idx_invoices_status on invoices (status) where status != 'paid';
create index idx_jobs_is_paid on jobs (is_paid) where is_paid = false;

-- RLS
alter table invoices enable row level security;
create policy "Authenticated users can manage invoices"
  on invoices for all
  to authenticated
  using (true)
  with check (true);
