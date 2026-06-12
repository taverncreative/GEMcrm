-- 033: report-email truth on jobs (L3)
-- ============================================================
-- The app must STATE whether a completed job's report was actually
-- emailed — never imply it. Today nothing records the outcome:
-- sendServiceReport silently no-ops when the customer has no address
-- (all six launch customers had none), so "Complete & Email" could
-- look done while nothing went anywhere.
--
-- Two nullable columns, written server-side ONLY when a send actually
-- succeeds (approve / amend "Save & Email" / the view-only "Send report
-- now"). Null = not emailed. The view-only sheet renders the truth from
-- these; "Send report now" single-fires by checking report_emailed_to
-- before sending. Additive + nullable → no backfill, no Dexie schema
-- change (rows flow through the pull wholesale).

alter table jobs
  add column if not exists report_emailed_to text,
  add column if not exists report_emailed_at timestamptz;
