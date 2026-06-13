-- 035: L4 — completed jobs require a filled service sheet (DB CHECK)
-- ============================================================
-- The app already enforces this at every completion route (L0:
-- approveServiceSheetAction re-checks isServiceSheetFilled before
-- finalizing, and ServiceSheetSchema requires all content fields). This
-- adds the SAME invariant at the database layer as a backstop, so a
-- completed × empty-sheet row is unreachable no matter the writer — a
-- stale outbox replay carrying a dropdown "completed", manual SQL, or a
-- future code path can never strand another empty completed job.
--
-- The predicate mirrors isServiceSheetFilled (lib/validation/
-- service-sheet.ts) EXACTLY so DB and app agree:
--   findings, recommendations, pesticides_used, risk_comments
--                                  -> non-empty after trim (the app trims)
--   risk_level                     -> non-empty, no trim (matches the app's
--                                     raw truthiness check on this enum field)
--   pest_species, method_used      -> at least one element
-- Gate is `job_status <> 'completed' OR (...)`, so draft / scheduled /
-- in_progress rows pass vacuously — they carry no sheet yet.
--
-- Validated on add (no NOT VALID): the only completed row in production
-- is 00006-NAT and it is filled, so this validates clean. The three
-- legacy stranded completed-empty jobs (00001-GEH / 00002 / 00003-DOU)
-- were hard-deleted FIRST — this constraint could not have been added
-- while they existed.
--
-- Write-order safety (why a legitimate completion never trips this):
-- saveServiceSheet writes the sheet fields while status is in_progress;
-- finalizeServiceSheet then flips status -> completed in a SEPARATE,
-- LATER statement, by which point the row is already filled. The legacy
-- completeServiceSheet writes fields + completed in one atomic UPDATE.
-- Amend rewrites validated (filled) fields on an already-completed row.
-- No path ever produces a transient completed+empty row.

alter table jobs drop constraint if exists jobs_completed_requires_filled_sheet;
alter table jobs add constraint jobs_completed_requires_filled_sheet
  check (
    job_status <> 'completed'
    or (
      findings is not null and btrim(findings) <> ''
      and recommendations is not null and btrim(recommendations) <> ''
      and pesticides_used is not null and btrim(pesticides_used) <> ''
      and risk_level is not null and risk_level <> ''
      and risk_comments is not null and btrim(risk_comments) <> ''
      and coalesce(array_length(pest_species, 1), 0) > 0
      and coalesce(array_length(method_used, 1), 0) > 0
    )
  );

-- DOWN (manual):
-- alter table jobs drop constraint if exists jobs_completed_requires_filled_sheet;
