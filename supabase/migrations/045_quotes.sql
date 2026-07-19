-- 045: quotes (sales document generator, Slice 1)
-- ============================================================
-- A standalone, branded sales quote for an EXISTING customer OR a prospect
-- not yet in the system. Online-only (like invoices/agreements — never in
-- Dexie/outbox). Mirrors the invoices feature for money + sequential
-- numbering, and files its PDF into the same Documents surface.
--
-- Numbering: a DEDICATED Postgres sequence + BEFORE INSERT trigger assigns
-- Q-YYYY-NNN. This is atomic/collision-proof (nextval), unlike the old
-- app-side max+1 the invoice register replaced in 037. The app NEVER sets
-- quote_number.
--
-- VAT: GEM is not VAT-registered yet, so vat_registered defaults FALSE and a
-- quote shows no VAT line (total = subtotal). The column + rate ship dormant
-- so flipping the per-quote toggle applies the 20% split the day GEM
-- registers — same "as-issued" posture as invoices.
--
-- Soft-delete: deleted_at + the SELECT-filters-deleted_at policy, so a plain
-- client UPDATE to set deleted_at would 42501. A delete action is NOT in
-- Slice 1, but the soft_delete_quote RPC + `revoke delete` ship now so no
-- second prod migration is needed when a delete/archive action lands (the
-- pattern the 032/038/043 headers mandate for any deleted_at table).
--
-- Idempotent + safe to re-run. Apply to LOCAL only for Slice 1; prod applies
-- this migration BEFORE the deploy at merge (migration-first). Mirrored into
-- setup.sql so a local rebuild lands the same schema.

begin;

create table if not exists quotes (
  id                uuid primary key default gen_random_uuid(),
  quote_number      text,                        -- assigned by trigger: Q-YYYY-NNN
  customer_id       uuid references customers (id) on delete set null,  -- nullable: prospects
  -- Denormalised bill-to snapshot: a quote works with NO customers row, and
  -- the document stays immutable if the linked customer later changes.
  customer_name     text not null,
  customer_address  text,
  customer_email    text,
  -- Line items as an ordered JSONB array of
  -- {description, qty, unit_price, line_total}. First JSONB column in the
  -- schema: line items are embedded document detail, never queried or joined
  -- independently, so a child table would add RLS/soft-delete/joins for no gain.
  line_items        jsonb not null default '[]'::jsonb,
  subtotal          numeric not null default 0,
  vat_registered    boolean not null default false,
  vat_rate          numeric not null default 20,
  vat_amount        numeric not null default 0,   -- 0 when vat_registered = false
  total             numeric not null default 0,
  terms             text,
  valid_until       date,
  notes             text,
  status            text not null default 'draft' check (status in ('draft', 'sent')),
  quote_pdf_url     text,
  created_by        uuid,                         -- audit only (single-tenant; not an access gate)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- updated_at (repo uses set_updated_at(), not the moddatetime extension)
drop trigger if exists trg_quotes_updated_at on quotes;
create trigger trg_quotes_updated_at
  before update on quotes
  for each row execute function set_updated_at();

-- Sequential quote number: dedicated sequence + BEFORE INSERT trigger.
-- Atomic and collision-proof (nextval), assigned server-side on every path.
create sequence if not exists quote_number_seq start 1;

create or replace function assign_quote_number()
returns trigger
language plpgsql
as $$
begin
  if new.quote_number is null then
    new.quote_number := 'Q-' || to_char(coalesce(new.created_at, now()), 'YYYY')
      || '-' || lpad(nextval('quote_number_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_quote_number on quotes;
create trigger trg_assign_quote_number
  before insert on quotes
  for each row execute function assign_quote_number();

-- Uniqueness backstop for the number.
create unique index if not exists quotes_quote_number_unique
  on quotes (quote_number) where quote_number is not null;

-- Lookup / filter indexes.
create index if not exists idx_quotes_customer_id on quotes (customer_id);
create index if not exists idx_quotes_status on quotes (status);
create index if not exists idx_quotes_live on quotes (id) where deleted_at is null;

-- RLS: same authenticated-CRUD + soft-delete-aware SELECT as the core tables.
alter table quotes enable row level security;

drop policy if exists "Authenticated users can read non-deleted" on quotes;
create policy "Authenticated users can read non-deleted" on quotes
  for select to authenticated using (deleted_at is null);

drop policy if exists "Authenticated users can insert" on quotes;
create policy "Authenticated users can insert" on quotes
  for insert to authenticated with check (true);

drop policy if exists "Authenticated users can update" on quotes;
create policy "Authenticated users can update" on quotes
  for update to authenticated using (true) with check (true);

drop policy if exists "Authenticated users can delete (hard)" on quotes;
create policy "Authenticated users can delete (hard)" on quotes
  for delete to authenticated using (true);

-- Defence in depth: anon gets nothing (RLS already blocks it); force
-- hard-deletes through the RPC.
revoke all on public.quotes from anon;
revoke delete, truncate on public.quotes from authenticated;

-- Soft-delete via SECURITY DEFINER RPC (mandatory: a plain client UPDATE that
-- sets deleted_at is rejected 42501 by the post-update SELECT policy).
create or replace function public.soft_delete_quote(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'soft_delete_quote: not authenticated';
  end if;

  update public.quotes
     set deleted_at = now()
   where id = p_id
     and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_quote(uuid) from public;
revoke all on function public.soft_delete_quote(uuid) from anon;
grant execute on function public.soft_delete_quote(uuid) to authenticated;

commit;

-- DOWN (manual):
-- drop function if exists public.soft_delete_quote(uuid);
-- drop table if exists quotes;
-- drop sequence if exists quote_number_seq;
-- drop function if exists assign_quote_number();
