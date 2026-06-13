-- 034: draft jobs + time-window/capture schema foundation (Q0)
-- ============================================================
-- "Quick job capture": the operator jots a phrase + date + arrival
-- window on a phone booking, with no customer/site/details yet. That
-- saves as a `draft` job, upgraded to a full booking later.
--
-- A job reaches its customer only via site -> customer, and `site_id`
-- was NOT NULL, so a detail-free draft didn't fit. Resolution (data
-- shape (a)): a draft is a real `jobs` row with a distinct status
-- value and a null site, gated by a CHECK.
--
-- Why a new STATUS value (not an is_draft flag): every existing status
-- filter lists the statuses it wants (.in("job_status",
-- ['scheduled','in_progress']) on today/upcoming/overdue; the jobs-list
-- Open/Completed tabs; FILLABLE_STATUSES) — so `draft` is excluded from
-- all of them for free, and surfaced only where we opt in. job_status
-- is already a Dexie index, so a Drafts query/tab needs no schema bump,
-- and sync_pull_jobs is `select * ... setof public.jobs` so a new
-- status value (and the new columns below) flow through with no RPC
-- change.
--
-- Additive + safe on the live table:
--   * DROP NOT NULL on site_id is metadata-only (instant, no rewrite).
--   * The site/draft CHECK validates against existing rows — all
--     current jobs are non-draft with a site, so they pass.
--   * Two nullable columns; no backfill.
--
-- NOTE FOR THE FUTURE L4 PASS (completed-requires-filled-sheet CHECK):
-- its predicate MUST exclude draft rows — a draft is never completed,
-- and must not be required to carry sheet fields. Gate L4 on
-- `job_status = 'completed'` only.

-- 1. Allow the draft status value.
alter table jobs drop constraint if exists jobs_job_status_check;
alter table jobs add constraint jobs_job_status_check
  check (job_status in ('scheduled', 'in_progress', 'completed', 'draft'));

-- 2. A draft may have no site; everything else still must.
alter table jobs alter column site_id drop not null;
alter table jobs drop constraint if exists jobs_draft_site_check;
alter table jobs add constraint jobs_draft_site_check
  check (site_id is not null or job_status = 'draft');

-- 3. Capture phrase ("Sarah, Wasps, Folkestone") + arrival-window end.
--    job_time stays the window START (single time = zero-width window),
--    so the soonest-first sort is unchanged.
alter table jobs add column if not exists capture_note text;
alter table jobs add column if not exists job_time_end time;
