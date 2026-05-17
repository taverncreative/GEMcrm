-- Soft archive + data integrity improvements
-- Run this in the Supabase SQL Editor

-- Soft archive columns
alter table customers add column is_archived boolean not null default false;
alter table sites add column is_archived boolean not null default false;
alter table jobs add column is_archived boolean not null default false;
alter table agreements add column is_archived boolean not null default false;
alter table tasks add column is_archived boolean not null default false;

-- Indexes for archive filtering
create index idx_customers_archived on customers (is_archived);
create index idx_sites_archived on sites (is_archived);
create index idx_jobs_archived on jobs (is_archived);
create index idx_agreements_archived on agreements (is_archived);
create index idx_tasks_archived on tasks (is_archived);

-- Unique constraint: prevent duplicate jobs for same site + date
-- (only for non-archived, but Postgres partial unique indexes need a workaround)
create unique index idx_jobs_site_date_unique
  on jobs (site_id, job_date, call_type)
  where (is_archived = false AND agreement_id IS NULL);
