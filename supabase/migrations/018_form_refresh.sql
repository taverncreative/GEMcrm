-- 018: Form refresh — Service Sheet + PMA alignment
-- ============================================================
-- Adds: "other" to call_type, reference_number + mobile on agreements.
-- Old environmental columns on jobs remain (backward compat for older records)
-- but the UI no longer writes to them.

alter table jobs drop constraint if exists jobs_call_type_check;
alter table jobs add constraint jobs_call_type_check
  check (call_type in ('routine', 'callout', 'followup', 'survey', 'other'));

alter table agreements add column if not exists reference_number text;
alter table agreements add column if not exists mobile text;
