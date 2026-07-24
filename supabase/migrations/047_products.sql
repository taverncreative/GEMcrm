-- 047: products reference table + structured "Products Used" on jobs.
-- ============================================================
-- Replaces the free-text `pesticides_used` service-sheet field with
-- structured product rows. Nate picks a product by BRAND NAME (his
-- familiarity + commercial privacy); everything CUSTOMER-FACING shows the
-- CHEMICAL NAME instead — never the brand.
--
-- Two parts:
--   1. `products` — a seeded reference table (brand_name -> chemical_name),
--      syncable/mirrored into Dexie for the offline type-ahead. Self-
--      maintaining: a brand Nate types that isn't listed is saved as a new
--      row (offline via the outbox) so it's in the dropdown next time.
--      chemical_name is NULLABLE — if he can't supply it on-site the row is
--      saved without it and the picker re-prompts next time (self-heal); the
--      customer never sees the brand.
--   2. `jobs.products_used` — a JSONB array of
--      { product_id, brand_name, chemical_name, quantity } snapshotted at
--      fill time, so a completed sheet's customer-facing chemical names are
--      FROZEN even if the products table is later edited. Rides the existing
--      jobs Dexie sync (no new mirror). Old jobs keep `pesticides_used` and
--      carry [] here.
--
-- Mirrors 046_blocked_periods.sql (table/RLS/grants/sync_pull) and 030.
-- Idempotent throughout. Applied LOCAL-only for the build; prod applies this
-- BEFORE the deploy at merge (db push disabled — see CLAUDE.md — so it goes
-- in manually, transaction-wrapped).

begin;

-- ── products reference table ──────────────────────────────────────────
create table if not exists products (
  id            uuid primary key default gen_random_uuid(),
  -- Operator picker value (Nate's brand). Never shown to customers.
  brand_name    text not null,
  -- Customer-facing value. NULLABLE: an on-site "can't supply it yet" add
  -- saves the brand now and the picker re-prompts for the chemical later.
  chemical_name text,
  -- Audit only (single-tenant; not an access gate). Server-stamped on insert.
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- Case-insensitive uniqueness on LIVE brand names keeps the self-maintaining
-- list clean (the type-ahead also surfaces existing brands so Nate picks
-- rather than re-types). Multi-device duplicate creation is a low-risk edge
-- at single-operator scale.
create unique index if not exists idx_products_brand_unique
  on products (lower(brand_name)) where deleted_at is null;
create index if not exists idx_products_live
  on products (id) where deleted_at is null;

alter table products enable row level security;

-- SELECT (hide soft-deleted), INSERT (new brands), UPDATE (fill a missing
-- chemical name later). No DELETE UI in v1.
drop policy if exists "Authenticated users can read non-deleted" on products;
create policy "Authenticated users can read non-deleted" on products
  for select to authenticated using (deleted_at is null);

drop policy if exists "Authenticated users can insert" on products;
create policy "Authenticated users can insert" on products
  for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update" on products;
create policy "Authenticated users can update" on products
  for update to authenticated using (true) with check (true);

revoke all on public.products from anon;
revoke delete, truncate on public.products from authenticated;

-- Incremental sync-pull (mirror 030 / 046). SECURITY DEFINER bypasses the
-- deleted_at RLS filter so retirements propagate; body re-checks auth.uid().
create or replace function public.sync_pull_products(since timestamptz)
returns setof public.products
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sync_pull_products: not authenticated';
  end if;
  return query
    select *
      from public.products
     where since is null or updated_at > since
     order by updated_at asc;
end;
$$;

revoke execute on function public.sync_pull_products(timestamptz) from public;
revoke execute on function public.sync_pull_products(timestamptz) from anon;
grant execute on function public.sync_pull_products(timestamptz) to authenticated;

-- Seed the 12 brand -> chemical rows from "products for CRM app.xlsx".
-- Fixed (deterministic) UUIDs so setup.sql, this migration, and prod all
-- land identical ids; idempotent via on conflict do nothing.
insert into products (id, brand_name, chemical_name) values
  ('39ca1c16-5efa-5117-972d-28b1af77afc0', 'Selontra', 'cholecalciferol 0.075% 20g block'),
  ('c2a8101c-af58-5765-88ee-0289fd68aa4c', 'Harmonix', 'cholecalciferol 0.075% 20g sachet'),
  ('8f84d904-ec2a-5f66-946f-e587b5096528', 'Talon Soft', 'brodifacoum 0.0025% paste'),
  ('f1026359-a301-5d00-ac59-976f8c9e4bec', 'Difen', 'difenacoum 0.005% grain'),
  ('a736e6a3-e022-532a-92c9-755c438c5e1d', 'Brodikill', 'brodifacoum 0.0029% grain'),
  ('b166651b-6790-58c4-bd5e-343c1c692dfb', 'Solo Blox', 'brodifacoum 0.005% 20g block'),
  ('67b49a64-25ba-5c1f-8d9d-a16af4d89503', 'Rodilon soft', 'difethialone 0.0025% 10g sachets'),
  ('a8549ba8-fa07-5530-af4e-15fc34340a54', 'Vulcan Dust', 'permethrin 0.5% dust'),
  ('74f0d3d9-63d2-5357-8c72-c4bec2d5813c', 'Digrain wasp and hornet destroyer', 'permethrin 0.25%, tetramethrin 0.24%'),
  ('ebb95b72-f0eb-5ac4-9f84-3dfaac398e51', 'Vazor wasp nest destroyer', 'trans phenothrin 0.1%, tetramethrin 0.3%'),
  ('8789925b-e706-53a5-a5ea-7f88654c5c2e', 'Cimetrol Super ew', 'cypermethrin 25%, tetramethrin 10%, piperonyl butoxide 20%, pyriproxyfen 1% (IGR)'),
  ('a6a9e353-049a-5c38-84bd-a749ba1c4aed', 'Phobi caps', 'cypermethrin 9.2%, prallethrin 0.46%')
on conflict (id) do nothing;

-- ── structured products used on the job ──────────────────────────────
-- JSONB array of { product_id, brand_name, chemical_name, quantity },
-- snapshotted at fill time. Replaces pesticides_used for NEW sheets; rides
-- the existing jobs Dexie sync. Old jobs keep pesticides_used and carry [].
alter table jobs add column if not exists products_used jsonb not null default '[]'::jsonb;

-- ── relax the completion backstop (was 035) ──────────────────────────
-- DECISION 4 (changed): ZERO products is a VALID completed sheet — Nate does
-- survey/inspection visits where no product is applied, and forcing a dummy
-- row corrupts the record. So the product requirement is DROPPED from the
-- constraint entirely (neither pesticides_used nor products_used is required);
-- the other required fields stay.
--
-- CRITICAL — this predicate MUST stay identical to isServiceSheetFilled and
-- ServiceSheetSchema (lib/validation/service-sheet.ts). If they drift you get
-- the classic "DB rejects what the app allowed" completion failure. Change all
-- three together.
alter table jobs drop constraint if exists jobs_completed_requires_filled_sheet;
alter table jobs add constraint jobs_completed_requires_filled_sheet
  check (
    job_status <> 'completed'
    or (
      findings is not null and btrim(findings) <> ''
      and recommendations is not null and btrim(recommendations) <> ''
      and risk_level is not null and risk_level <> ''
      and risk_comments is not null and btrim(risk_comments) <> ''
      and coalesce(array_length(pest_species, 1), 0) > 0
      and coalesce(array_length(method_used, 1), 0) > 0
    )
  );

commit;

-- DOWN (manual):
--   alter table jobs drop constraint if exists jobs_completed_requires_filled_sheet;
--   -- (re-add the 035 predicate to restore the pesticides_used requirement)
--   alter table jobs drop column if exists products_used;
--   drop function if exists public.sync_pull_products(timestamptz);
--   drop table if exists products;
