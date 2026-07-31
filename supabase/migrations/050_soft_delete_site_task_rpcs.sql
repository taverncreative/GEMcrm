-- 050: soft_delete_site + soft_delete_task SECURITY DEFINER RPCs
-- ============================================================
-- The last two of the core five to get a delete path. `sites` and `tasks`
-- have carried `deleted_at` since migration 029 along with the self-hiding
-- SELECT policy `USING (deleted_at IS NULL)`, but neither ever got an RPC
-- or a UI — so neither could actually be deleted. A plain
-- `update({deleted_at: now()})` is rejected with 42501 "new row violates
-- row-level security policy": PostgREST returns the post-update row and
-- that RETURNING row fails the SELECT policy. The UPDATE policy is
-- `using(true)/with check(true)`, so it is NOT the gate — proven for
-- customers in 032, jobs in 038, agreements in 043.
--
-- Same narrowest-possible bypass as those three: SECURITY DEFINER, in-body
-- `auth.uid()` guard, `set search_path = public`, EXECUTE revoked from
-- public + anon and granted only to authenticated. Read policies are left
-- exactly as they are; deleted rows stay invisible to every normal read.

-- ── soft_delete_task ───────────────────────────────────────────────
-- The simple one: a task has no dependents. Nothing points at `tasks`;
-- `tasks` points OUT (related_job_id, related_customer_id, agreement_id,
-- site_id). Straight copy of the 038 shape.

create or replace function public.soft_delete_task(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_task: not authenticated';
  end if;

  update public.tasks
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_task(uuid) from public;
revoke all on function public.soft_delete_task(uuid) from anon;
grant execute on function public.soft_delete_task(uuid) to authenticated;

-- ── soft_delete_site ───────────────────────────────────────────────
-- A site is NOT a leaf, and unlike a report orphan (049) the dependents do
-- not stay usefully readable — they become invisible zombies. Every jobs
-- read in the app embeds `site:sites!inner(...)` (calendar, jobs list,
-- dashboard, overdue, needs-invoice), so the moment the site row is hidden
-- by RLS its jobs vanish from every list ANYWAY, while still sitting in the
-- table as `scheduled`. Leaving them undeleted would mean phantom rows that
-- no screen can reach but `hasJobForSiteOnDate` and friends still count.
--
-- So this one CASCADES, in a single transaction, in this order:
--
--   1. hard guard: refuse outright if the site has an ACTIVE or PAUSED
--      agreement. Those are real live contracts (same rule the agreement
--      delete guard enforces) and a site delete must never take one with
--      it. The operator cancels the agreement first, deliberately.
--   2. soft-delete the site's jobs. Their service sheets SURVIVE — the
--      `reports` FK is on job_id and jobs are only ever soft-deleted, so
--      the cascade never fires and `list_report_documents` (049) keeps an
--      orphaned sheet fully readable in Documents. Any invoice STANDS,
--      exactly as for a single job delete (038).
--   3. soft-delete the site's remaining agreements — by now only draft or
--      cancelled ones can be left, the two states the agreement delete
--      guard already allows.
--   4. soft-delete the site itself.
--
-- Deliberately NOT cascaded: `tasks` carrying this site_id. That matches
-- the job delete, which leaves its follow-up tasks alone — a task is the
-- operator's own note, deletable on its own now (soft_delete_task above).
--
-- Ordering note: the guard reads agreements BEFORE anything is stamped, so
-- a blocked call raises with nothing written (the whole function body is
-- one transaction, so a raise rolls back regardless).

create or replace function public.soft_delete_site(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live_agreements int;
begin
  if auth.uid() is null then
    raise exception 'soft_delete_site: not authenticated';
  end if;

  select count(*)
    into v_live_agreements
    from public.agreements
   where site_id = p_id
     and deleted_at is null
     and status in ('active', 'paused');

  if v_live_agreements > 0 then
    raise exception
      'soft_delete_site: site has % live agreement(s), cancel them first',
      v_live_agreements;
  end if;

  update public.jobs
     set deleted_at = now()
   where site_id = p_id
     and deleted_at is null;

  update public.agreements
     set deleted_at = now()
   where site_id = p_id
     and deleted_at is null;

  update public.sites
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_site(uuid) from public;
revoke all on function public.soft_delete_site(uuid) from anon;
grant execute on function public.soft_delete_site(uuid) to authenticated;

-- Rollback:
--   drop function if exists public.soft_delete_site(uuid);
--   drop function if exists public.soft_delete_task(uuid);
