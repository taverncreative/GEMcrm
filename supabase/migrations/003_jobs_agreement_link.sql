-- Link jobs to agreements
-- Run this in the Supabase SQL Editor

alter table jobs
  add column agreement_id uuid references agreements(id) on delete set null;

create index idx_jobs_agreement_id on jobs (agreement_id);
