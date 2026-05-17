-- Daily summary records for reporting
-- Run this in the Supabase SQL Editor

create table daily_summaries (
  id uuid primary key default gen_random_uuid(),
  summary_date date not null unique,
  jobs_completed integer not null default 0,
  tasks_completed integer not null default 0,
  created_at timestamptz not null default now()
);

alter table daily_summaries enable row level security;

create policy "Authenticated users full access" on daily_summaries
  for all to authenticated using (true) with check (true);
