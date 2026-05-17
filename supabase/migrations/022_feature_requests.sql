-- 022: Feature/bug request log
-- ============================================================
-- Captures user-submitted requests from the Settings page. The handler
-- also pings an email (stubbed today) so the developer is notified.

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

create policy "Authenticated users full access" on feature_requests
  for all to authenticated using (true) with check (true);

create index if not exists idx_feature_requests_created
  on feature_requests (created_at desc);
