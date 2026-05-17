-- Add agreement status and task type
-- Run this in the Supabase SQL Editor

-- Agreement status
alter table agreements
  add column status text not null default 'active'
  check (status in ('active', 'paused', 'cancelled'));

create index idx_agreements_status on agreements (status);

-- Task type
alter table tasks
  add column task_type text not null default 'general'
  check (task_type in ('general', 'follow_up', 'review_request'));
