-- 038: soft_delete_job SECURITY DEFINER RPC
-- ============================================================
-- Soft-delete (archive) is broken for jobs for the same reason it was
-- for customers (migration 032): the app sets `deleted_at = now()`, but
-- the SELECT RLS policy (`USING (deleted_at IS NULL)`, added in 029) is
-- enforced against the POST-update row that PostgREST returns, so the
-- very update that makes a job "deleted" is rejected with 42501
-- "new row violates row-level security policy for table jobs". The
-- UPDATE policy is `USING (true) WITH CHECK (true)`, so it is NOT the
-- gate — proven for customers in 032: relaxing the SELECT policy
-- unblocks the update; recreating the UPDATE policy with explicit
-- WITH CHECK (true) does not. Same predicate, same row, same outcome
-- here. Reported from the field on job 00028.
--
-- There is no policy-only fix that keeps deleted rows hidden from reads
-- AND allows the transition into the deleted state. So, exactly as for
-- customers: a SECURITY DEFINER function, the narrowest possible bypass.
-- Read policies stay exactly as they are; deleted rows remain invisible
-- to every normal read. No new authorization is granted — the UPDATE
-- policy is already USING (true) for authenticated users.
--
-- This is the per-table function migration 032's header anticipated:
-- "sites / jobs / tasks / agreements share the identical RLS gap …
-- give each its own soft_delete_<table> function FOLLOWING THIS SAME
-- PATTERN when their archive actions are built." Jobs' archive action
-- (delete-a-job) has now shipped, so this lands its function.
--
-- In-body auth check follows the 030 sync-pull convention:
-- belt-and-braces against accidental EXECUTE grants.

create or replace function public.soft_delete_job(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_job: not authenticated';
  end if;

  update public.jobs
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

-- Supabase's ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon as
-- well — revoke it explicitly (revoking from public alone leaves it).
-- The in-body auth check would reject anon anyway; this keeps the
-- grant itself honest.
revoke all on function public.soft_delete_job(uuid) from public;
revoke all on function public.soft_delete_job(uuid) from anon;
grant execute on function public.soft_delete_job(uuid) to authenticated;
