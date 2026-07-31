-- 049: report soft-delete + orphan-safe Documents read
-- ============================================================
-- Two related gaps, both surfaced by the delete audit:
--
--   1. A service sheet (`reports` row) had NO delete path anywhere in the
--      stack — no column, no RPC, no UI. It is the only document kind that
--      could never be removed.
--
--   2. Soft-deleting a job ORPHANS its report. The FK is
--      `job_id ... on delete cascade`, but jobs are only ever SOFT-deleted,
--      so the cascade never fires. The Documents list then left-joins
--      `job:jobs(...)`, the jobs SELECT policy (029) filters
--      `deleted_at IS NULL`, and the embed comes back NULL — rendering an
--      anonymous "Service Sheet" row with no reference, customer, site or
--      date. Prod has one today: report eee84f3b (job 00091, deleted
--      2026-07-14).
--
-- DECISION (John, 2026-07-31): the sheet is the record of work performed,
-- so deleting a job must KEEP its service sheet in Documents. Orphans are
-- NOT hidden — they are shown WITH their details plus a "job deleted"
-- marker, and are separately deletable. Hence a read that can see past the
-- jobs soft-delete filter (part 2 below) rather than an `!inner` join.

-- ── 1. reports.deleted_at + soft_delete_report RPC ─────────────────
-- Mirrors the core-five soft-delete shape. NOTE: unlike customers/jobs/
-- agreements, the `reports` SELECT policy is a plain
-- `for all to authenticated using (true)` — there is NO self-hiding
-- `deleted_at IS NULL` predicate, so a direct `update({deleted_at})` would
-- NOT hit the 42501 catch-22 documented in CLAUDE.md (same situation as
-- library_documents, migration 048). The RPC is used anyway, for two
-- reasons: it keeps every soft-delete in the app on one auditable shape,
-- and it means tightening the reports SELECT policy later cannot silently
-- break the delete path. Reads filter `deleted_at is null` at the query
-- layer.

alter table public.reports
  add column if not exists deleted_at timestamptz;

-- Partial index: every read filters `deleted_at is null`, and soft-deleted
-- rows are the rare case.
create index if not exists idx_reports_live
  on public.reports (created_at desc)
  where deleted_at is null;

create or replace function public.soft_delete_report(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_report: not authenticated';
  end if;

  update public.reports
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_report(uuid) from public;
revoke all on function public.soft_delete_report(uuid) from anon;
grant execute on function public.soft_delete_report(uuid) to authenticated;

-- Defence in depth, extending migration 039's M1 to reports. 039 revoked
-- hard DELETE on the core five precisely so no cascade could wipe reports;
-- now that reports have a soft-delete of their own, close the same door on
-- the table itself. A signed service sheet must never be removable by a raw
-- REST DELETE. Nothing in the app hard-deletes a report (the only real
-- `.delete()` calls are the invoice-create rollback and feature_requests).
revoke delete, truncate on public.reports from authenticated;

-- ── 2. list_report_documents — orphan-safe Documents read ──────────
-- SECURITY DEFINER so the job/site/customer lookup is NOT subject to the
-- jobs SELECT policy's `deleted_at IS NULL`. This is what lets an orphaned
-- sheet keep its reference, customer, site address and job date instead of
-- collapsing to a bare "Service Sheet".
--
-- Chosen over the alternatives: denormalising onto `reports` would need a
-- backfill plus a trigger to stay honest, and relaxing the jobs SELECT
-- policy would leak soft-deleted jobs into every other read. This function
-- widens exactly one query and nothing else.
--
-- `job_deleted` drives the "Job deleted" chip in the UI. It is true both
-- when the job row is soft-deleted AND when it is missing outright, so a
-- genuinely dangling report still reads as orphaned rather than as normal.
--
-- Only live rows with a stored PDF are returned — the same two filters the
-- previous inline query applied, plus the new `reports.deleted_at is null`.

create or replace function public.list_report_documents(p_limit int default 200)
returns table (
  id uuid,
  created_at timestamptz,
  pdf_url text,
  job_id uuid,
  job_deleted boolean,
  reference_number text,
  job_date date,
  pest_species text[],
  site_address_line_1 text,
  site_town text,
  site_postcode text,
  customer_id uuid,
  customer_name text,
  customer_company_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'list_report_documents: not authenticated';
  end if;

  return query
    select r.id,
           r.created_at,
           r.pdf_url,
           r.job_id,
           (j.id is null or j.deleted_at is not null) as job_deleted,
           j.reference_number,
           j.job_date,
           j.pest_species,
           s.address_line_1,
           s.town,
           s.postcode,
           c.id,
           c.name,
           c.company_name
      from public.reports r
      left join public.jobs      j on j.id = r.job_id
      left join public.sites     s on s.id = j.site_id
      left join public.customers c on c.id = s.customer_id
     where r.deleted_at is null
       and r.pdf_url is not null
     order by r.created_at desc
     limit p_limit;
end;
$$;

revoke all on function public.list_report_documents(int) from public;
revoke all on function public.list_report_documents(int) from anon;
grant execute on function public.list_report_documents(int) to authenticated;

-- ── 3. get_report_document — the same read, for ONE sheet ──────────
-- `getDocumentForEmail` resolves the label that names the emailed
-- attachment ("Service Sheet 00091"). It used the same jobs embed the list
-- did, so it had the same blind spot: for a soft-deleted job the embed came
-- back null and the attachment fell back to a bare "Service Sheet" — the
-- Documents ROW would read "Service Sheet 00091" while the PDF that landed
-- in the customer's inbox was called something else.
--
-- Same definer treatment, single row. Narrower return than the list
-- function: the email path needs only the pdf and the label inputs.
-- `deleted_at is null` is enforced HERE rather than by the caller, so a
-- soft-deleted sheet can't be emailed from a stale open dialog.

create or replace function public.get_report_document(p_id uuid)
returns table (
  id uuid,
  pdf_url text,
  job_deleted boolean,
  reference_number text,
  job_date date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'get_report_document: not authenticated';
  end if;

  return query
    select r.id,
           r.pdf_url,
           (j.id is null or j.deleted_at is not null) as job_deleted,
           j.reference_number,
           j.job_date
      from public.reports r
      left join public.jobs j on j.id = r.job_id
     where r.id = p_id
       and r.deleted_at is null;
end;
$$;

revoke all on function public.get_report_document(uuid) from public;
revoke all on function public.get_report_document(uuid) from anon;
grant execute on function public.get_report_document(uuid) to authenticated;

-- Rollback:
--   revoke delete, truncate is intentionally NOT restored — see 039.
--   drop function if exists public.get_report_document(uuid);
--   drop function if exists public.list_report_documents(int);
--   drop function if exists public.soft_delete_report(uuid);
--   drop index if exists public.idx_reports_live;
--   alter table public.reports drop column if exists deleted_at;
