-- 043: soft_delete_agreement SECURITY DEFINER RPC
-- ============================================================
-- Agreements now have a delete action (Discard draft, Slice 2 of the
-- draft-agreement flow) and share the identical RLS gap fixed for
-- customers (032) and jobs (038): the app sets `deleted_at = now()`, but
-- the SELECT RLS policy (`USING (deleted_at IS NULL)`, added in 029) is
-- enforced against the POST-update row that PostgREST returns, so the
-- very update that makes an agreement "deleted" is rejected with 42501
-- "new row violates row-level security policy". The UPDATE policy is
-- `USING (true) WITH CHECK (true)`, so it is NOT the gate — proven for
-- customers in 032.
--
-- This is the per-table function migration 032's header anticipated:
-- "sites / jobs / tasks / agreements share the identical RLS gap …
-- give each its own soft_delete_<table> function FOLLOWING THIS SAME
-- PATTERN when their archive actions are built." Agreements' discard
-- action has now shipped, so this lands its function. (The Slice-2
-- interim used the admin client for this one write; this RPC replaces
-- that, restoring the 032/038 pattern.)
--
-- In-body auth check follows the 030 sync-pull convention:
-- belt-and-braces against accidental EXECUTE grants.

create or replace function public.soft_delete_agreement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_agreement: not authenticated';
  end if;

  update public.agreements
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

-- Supabase's ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon as
-- well — revoke it explicitly (revoking from public alone leaves it).
-- The in-body auth check would reject anon anyway; this keeps the
-- grant itself honest.
revoke all on function public.soft_delete_agreement(uuid) from public;
revoke all on function public.soft_delete_agreement(uuid) from anon;
grant execute on function public.soft_delete_agreement(uuid) to authenticated;
