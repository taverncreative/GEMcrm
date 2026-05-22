-- 030: Sync-pull RPC functions for the 5 syncable entities
-- ============================================================
-- The offline PWA store mirrors customers / sites / jobs / agreements /
-- tasks locally. The sync engine (step 6 of the offline-pwa rollout)
-- needs an incremental "give me everything that changed since cursor X,
-- including soft-deleted rows" query per entity.
--
-- Step 3 (migration 029) installed per-operation RLS policies. The
-- SELECT policy filters `deleted_at IS NULL` from every read, so any
-- pull query that goes through the normal authenticated client never
-- sees soft-deleted rows — which means an engineer deleting a customer
-- on Browser A would never sync that deletion to Browser B.
--
-- Fix: a SECURITY DEFINER function per entity. The function runs as the
-- owner (postgres), bypassing RLS. Authorisation belt-and-braces is
-- enforced inside each function body: `auth.uid() IS NOT NULL` check
-- raises if invoked without an authenticated session (future-proofing
-- against misuse — e.g. an anonymous edge function inadvertently
-- granted EXECUTE on these).
--
-- Each function:
--   * Takes `since timestamptz` (nullable). NULL → return everything
--     (used for first-ever sync). Non-null → return rows whose
--     `updated_at > since` (strict greater-than; the caller uses
--     max(updated_at) of the returned set as the next cursor to avoid
--     duplicate boundary rows).
--   * Returns the full row including `deleted_at`. The caller's local
--     merge logic interprets `deleted_at IS NOT NULL` as "mirror as
--     deleted locally" (RLS handles SELECT-side hiding for normal app
--     reads, the local Dexie store filters at the query layer).
--   * Orders by `updated_at ASC` so partial-failure resumption picks
--     up cleanly from a partial set.
--
-- Idempotent: `create or replace function`. Safe to re-run.

-- 1. Grant + revoke template ───────────────────────────────────────
-- All five functions follow the same shape. To repeat the boilerplate
-- consistently and keep them visually grouped, the function body is
-- a one-liner SELECT — there's no special per-entity logic.

create or replace function public.sync_pull_customers(since timestamptz)
returns setof public.customers
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Belt-and-braces auth check. SECURITY DEFINER would let this run
  -- without a session otherwise; reject if no signed-in user.
  if auth.uid() is null then
    raise exception 'sync_pull_customers: not authenticated';
  end if;
  return query
    select *
      from public.customers
     where since is null or updated_at > since
     order by updated_at asc;
end;
$$;

create or replace function public.sync_pull_sites(since timestamptz)
returns setof public.sites
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sync_pull_sites: not authenticated';
  end if;
  return query
    select *
      from public.sites
     where since is null or updated_at > since
     order by updated_at asc;
end;
$$;

create or replace function public.sync_pull_jobs(since timestamptz)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sync_pull_jobs: not authenticated';
  end if;
  return query
    select *
      from public.jobs
     where since is null or updated_at > since
     order by updated_at asc;
end;
$$;

create or replace function public.sync_pull_agreements(since timestamptz)
returns setof public.agreements
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sync_pull_agreements: not authenticated';
  end if;
  return query
    select *
      from public.agreements
     where since is null or updated_at > since
     order by updated_at asc;
end;
$$;

create or replace function public.sync_pull_tasks(since timestamptz)
returns setof public.tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sync_pull_tasks: not authenticated';
  end if;
  return query
    select *
      from public.tasks
     where since is null or updated_at > since
     order by updated_at asc;
end;
$$;

-- 2. Revoke public; grant authenticated ────────────────────────────
-- Default `create function` grants EXECUTE to PUBLIC. We don't want
-- anonymous callers (or `anon` role) hitting these — the in-function
-- `auth.uid()` check would catch it, but defence in depth.
revoke execute on function public.sync_pull_customers(timestamptz)  from public;
revoke execute on function public.sync_pull_sites(timestamptz)      from public;
revoke execute on function public.sync_pull_jobs(timestamptz)       from public;
revoke execute on function public.sync_pull_agreements(timestamptz) from public;
revoke execute on function public.sync_pull_tasks(timestamptz)      from public;

grant execute on function public.sync_pull_customers(timestamptz)  to authenticated;
grant execute on function public.sync_pull_sites(timestamptz)      to authenticated;
grant execute on function public.sync_pull_jobs(timestamptz)       to authenticated;
grant execute on function public.sync_pull_agreements(timestamptz) to authenticated;
grant execute on function public.sync_pull_tasks(timestamptz)      to authenticated;

-- DOWN (manual rollback) ───────────────────────────────────────────
--   drop function if exists public.sync_pull_customers(timestamptz);
--   drop function if exists public.sync_pull_sites(timestamptz);
--   drop function if exists public.sync_pull_jobs(timestamptz);
--   drop function if exists public.sync_pull_agreements(timestamptz);
--   drop function if exists public.sync_pull_tasks(timestamptz);
