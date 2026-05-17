-- Add priority field to tasks
alter table tasks add column priority text not null default 'medium';
alter table tasks add constraint tasks_priority_check check (priority in ('low', 'medium', 'high'));

-- Index for priority-based ordering
create index idx_tasks_priority_status on tasks (status, priority, due_date);
