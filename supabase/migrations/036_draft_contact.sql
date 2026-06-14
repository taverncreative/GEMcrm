-- 036: optional structured contact on draft jobs (Track 2, Half 1)
-- ============================================================
-- Quick-job capture (Q2) records a phrase + date + arrival window with no
-- customer. But the everyday trigger is "a usually-NEW customer phones
-- in", so the operator wants to jot the caller's name + number at intake —
-- structured, not buried in the free-text capture_note. These two nullable
-- columns carry that contact on the draft row; upgrade (Half 2, a later
-- pass) will read them to pre-fill / local-match the customer.
--
-- Both OPTIONAL. Deliberately DISTINCT from jobs.client_name, which is the
-- service-sheet's "client present at the visit" field — overloading it
-- would foul the L4 / sheet semantics, so these get their own columns.
--
-- Additive + safe on the live table (same shape as 034/035):
--   * Two nullable text columns; metadata-only, instant, no rewrite, no
--     backfill.
--   * sync_pull_jobs is `select * ... setof public.jobs`, so the new
--     columns flow through with NO RPC change.
--   * Not indexed -> no Dexie schema bump (they ride structured clone,
--     same as capture_note / is_archived).

alter table jobs add column if not exists draft_contact_name text;
alter table jobs add column if not exists draft_contact_phone text;

-- DOWN (manual):
-- alter table jobs drop column if exists draft_contact_name;
-- alter table jobs drop column if exists draft_contact_phone;
