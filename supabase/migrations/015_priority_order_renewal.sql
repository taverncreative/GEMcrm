-- Add numeric priority_order for deterministic sorting
alter table tasks add column priority_order int not null default 2;

-- Backfill from existing priority text
update tasks set priority_order = 3 where priority = 'high';
update tasks set priority_order = 2 where priority = 'medium';
update tasks set priority_order = 1 where priority = 'low';

-- Index for efficient dashboard queries
create index idx_tasks_priority_order on tasks (status, priority_order desc, due_date asc);
