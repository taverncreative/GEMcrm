-- 040: manual to-do task type + optional notes on tasks
-- ============================================================
-- (Numbered 040 — main already carries a 039 for the defence-in-depth
-- grants; this is the renumbered tasks-module-v1 migration.)
-- Two additive changes, both preserving every existing row's behaviour:
--
--   1. Extend the task_type CHECK to allow 'todo'. Existing rows keep
--      their current type ('general' / 'follow_up' / 'review_request' /
--      'contract_renewal'), so the auto-follow-up widgets that key off
--      task_type are unchanged. New manually-created to-dos are written
--      as 'todo' and are filtered OUT of the overdue follow-up surface
--      (getOverdueTasks) so personal to-dos never pollute the
--      customer-follow-up widgets. ('todo' is also already excluded from
--      "Customers to contact", whose query allowlists
--      review_request/follow_up/contract_renewal.)
--
--   2. Add a nullable `notes` column for the optional free-text on the
--      manual create form. NULL for every existing row; the
--      auto-creators (job-events, agreement-renewal) don't set it.
--
-- The default stays 'general' so any insert that omits task_type keeps
-- behaving as before.
--
-- Constraint name `tasks_task_type_check` matches migration 004/014 so
-- the drop-then-add is a clean replace of the live constraint.

alter table tasks drop constraint if exists tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check
  check (task_type in ('general', 'follow_up', 'review_request', 'contract_renewal', 'todo'));

alter table tasks add column if not exists notes text;
