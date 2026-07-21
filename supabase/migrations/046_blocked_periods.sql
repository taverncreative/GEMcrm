-- 046: blocked_periods — personal unavailability / "block-out days".
-- ============================================================
-- Nate marks himself off work for a single day or a range of consecutive
-- days, with a free-text reason as the title (e.g. "Fishing at Bewl
-- Water", "Benidorm holiday"). Slice 1 renders these on the calendar as
-- a full-day band and lets him create / edit / delete them offline-first.
-- (Slice 2 — the non-blocking booking warning — reads these from Dexie.)
--
-- STANDALONE table: no FK to jobs / sites / customers. A block-out is an
-- owner-centric, date-anchored note, conceptually close to a personal
-- 'todo' task — it stands entirely on its own.
--
-- SYNCABLE: unlike quotes/invoices (online-only), this table joins the
-- offline stack (Dexie mirror + outbox + sync pull) so Slice 2's booking
-- warning can read it offline. It therefore carries the full soft-delete
-- + per-operation RLS + sync_pull_* + soft_delete_* shape the 5 core
-- entities use (migrations 029 / 030 / 032 / 038).
--
-- Mirrors 045_quotes.sql (table/RLS/grants/soft-delete) and 030 (pull RPC).
-- Idempotent throughout. Applied LOCAL-only for Slice 1; prod applies this
-- BEFORE the deploy at merge (db push is disabled — see CLAUDE.md — so it
-- goes in manually, transaction-wrapped).

begin;

create table if not exists blocked_periods (
  id          uuid primary key default gen_random_uuid(),
  -- Inclusive [start_date, end_date]. A single-day block sets end = start.
  start_date  date not null,
  end_date    date not null,
  -- Free-text reason, shown as the band label on the calendar.
  title       text not null,
  -- Audit only (single-tenant; not an access gate). Stamped server-side on
  -- insert; the offline optimistic row leaves it null until the next pull.
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint blocked_periods_date_order check (end_date >= start_date)
);

-- updated_at (repo uses set_updated_at(), not the moddatetime extension).
drop trigger if exists trg_blocked_periods_updated_at on blocked_periods;
create trigger trg_blocked_periods_updated_at
  before update on blocked_periods
  for each row execute function set_updated_at();

-- Range-overlap lookup (calendar fetch: start_date <= end AND end_date >= start)
-- + the live partial index (mirror 029).
create index if not exists idx_blocked_periods_range
  on blocked_periods (start_date, end_date);
create index if not exists idx_blocked_periods_live
  on blocked_periods (id) where deleted_at is null;

-- RLS: same authenticated-CRUD + soft-delete-aware SELECT as the core tables.
alter table blocked_periods enable row level security;

drop policy if exists "Authenticated users can read non-deleted" on blocked_periods;
create policy "Authenticated users can read non-deleted" on blocked_periods
  for select to authenticated using (deleted_at is null);

drop policy if exists "Authenticated users can insert" on blocked_periods;
create policy "Authenticated users can insert" on blocked_periods
  for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update" on blocked_periods;
create policy "Authenticated users can update" on blocked_periods
  for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can delete (hard)" on blocked_periods;
create policy "Authenticated users can delete (hard)" on blocked_periods
  for delete to authenticated using (true);

-- Defence in depth: anon gets nothing (RLS already blocks it); force
-- soft-deletes through the RPC below.
revoke all on public.blocked_periods from anon;
revoke delete, truncate on public.blocked_periods from authenticated;

-- Incremental sync-pull (mirror 030). SECURITY DEFINER bypasses the
-- deleted_at RLS filter so deletions propagate to other devices; the
-- body re-checks auth.uid(). Returns soft-deleted rows too (delete bumps
-- updated_at via the trigger, so they fall inside `updated_at > since`).
create or replace function public.sync_pull_blocked_periods(since timestamptz)
returns setof public.blocked_periods
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sync_pull_blocked_periods: not authenticated';
  end if;
  return query
    select *
      from public.blocked_periods
     where since is null or updated_at > since
     order by updated_at asc;
end;
$$;

revoke execute on function public.sync_pull_blocked_periods(timestamptz) from public;
revoke execute on function public.sync_pull_blocked_periods(timestamptz) from anon;
grant execute on function public.sync_pull_blocked_periods(timestamptz) to authenticated;

-- Soft-delete via SECURITY DEFINER RPC (mandatory: a plain client UPDATE
-- that sets deleted_at is rejected 42501 by the post-update SELECT policy —
-- same gap 032/038 fixed for customers/jobs). Idempotent (guards deleted_at
-- is null), so an outbox replay after an online delete is a harmless no-op.
create or replace function public.soft_delete_blocked_period(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_blocked_period: not authenticated';
  end if;

  update public.blocked_periods
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_blocked_period(uuid) from public;
revoke all on function public.soft_delete_blocked_period(uuid) from anon;
grant execute on function public.soft_delete_blocked_period(uuid) to authenticated;

commit;

-- DOWN (manual):
--   drop function if exists public.soft_delete_blocked_period(uuid);
--   drop function if exists public.sync_pull_blocked_periods(timestamptz);
--   drop table if exists blocked_periods;
