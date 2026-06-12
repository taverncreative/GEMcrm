-- 032: soft_delete_customer SECURITY DEFINER RPC
-- ============================================================
-- Soft-delete (archive) was broken for every logged-in user: the app
-- sets `deleted_at = now()`, but the SELECT RLS policy
-- (`USING (deleted_at IS NULL)`) is enforced against the POST-update
-- row, so the very update that makes a row "deleted" is rejected with
-- 42501 "new row violates row-level security policy". Proven by
-- experiment: relaxing the SELECT policy unblocks the update; recreating
-- the UPDATE policy with explicit WITH CHECK (true) does not.
--
-- There is no policy-only fix that keeps deleted rows hidden from reads
-- AND allows the transition into the deleted state — same predicate,
-- same row. So: a SECURITY DEFINER function, the narrowest possible
-- bypass. Read policies stay exactly as they are; deleted rows remain
-- invisible to every normal read. No new authorization is granted —
-- the UPDATE policy is already USING (true) for authenticated users.
--
-- CUSTOMERS ONLY for now: archiving is only built for customers.
-- sites / jobs / tasks / agreements share the identical RLS gap
-- (same SELECT USING (deleted_at IS NULL) policy) — give each its own
-- soft_delete_<table> function FOLLOWING THIS SAME PATTERN when their
-- archive actions are built.
--
-- In-body auth check follows the 030 sync-pull convention:
-- belt-and-braces against accidental EXECUTE grants.

create or replace function public.soft_delete_customer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_customer: not authenticated';
  end if;

  update public.customers
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

-- Supabase's ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon as
-- well — revoke it explicitly (revoking from public alone leaves it).
-- The in-body auth check would reject anon anyway; this keeps the
-- grant itself honest.
revoke all on function public.soft_delete_customer(uuid) from public;
revoke all on function public.soft_delete_customer(uuid) from anon;
grant execute on function public.soft_delete_customer(uuid) to authenticated;
