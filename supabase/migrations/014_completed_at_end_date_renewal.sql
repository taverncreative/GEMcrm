-- Add completed_at to tasks
alter table tasks add column completed_at timestamptz;

-- Add end_date to agreements
alter table agreements add column end_date date;

-- Backfill end_date from start_date + 1 year
update agreements
set end_date = start_date + interval '1 year'
where start_date is not null and end_date is null;

-- Update task_type constraint to include contract_renewal
alter table tasks drop constraint if exists tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check
  check (task_type in ('general', 'follow_up', 'review_request', 'contract_renewal'));
