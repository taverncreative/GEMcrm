-- Add job_status column to jobs table
-- Run this in the Supabase SQL Editor

alter table jobs
  add column job_status text not null default 'scheduled'
  check (job_status in ('scheduled', 'in_progress', 'completed'));

-- Index for filtering by status
create index idx_jobs_status on jobs (job_status);
