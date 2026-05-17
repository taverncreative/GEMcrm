-- Link tasks to agreements
alter table tasks add column agreement_id uuid references agreements(id) on delete set null;

-- Index for agreement-scoped task lookups
create index idx_tasks_agreement_id on tasks (agreement_id);

-- Partial index for pending tasks (most dashboard queries filter on this)
create index idx_tasks_pending on tasks (status, priority_order desc, due_date asc)
  where status = 'pending';
