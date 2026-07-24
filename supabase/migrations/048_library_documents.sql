-- ============================================================
-- 048: Site-folder print library
-- ============================================================
-- Two tables, both single-operator (no role/admin concept) and NOT
-- syncable (the library is online-only, like feature_requests):
--
--   library_documents — static documents John uploads (site-folder pages).
--     Files live in the private `reports` bucket under library/<id>/<name>;
--     this row holds the label, category, and the storage path.
--
--   print_orders — a light local record of each basket confirmed for print.
--     `id` is the client-generated order id that doubles as Spotlight's
--     idempotency key, so a retry with the same id can't duplicate.
--
-- Soft delete (library_documents.deleted_at) is a PLAIN update filtered in
-- the query layer — deliberately NO `using (deleted_at is null)` SELECT
-- policy here, so there is no self-hiding 42501 catch-22 and no need for a
-- SECURITY DEFINER RPC (see the standing note in CLAUDE.md). That is safe
-- precisely because the table is not syncable and never needs the
-- offline-safe self-hiding policy.
--
-- Apply LOCALLY via `supabase db query --linked -f` is disabled; run this
-- transaction-wrapped against the local DB. setup.sql mirrors both tables.

begin;

create table if not exists library_documents (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  category    text,
  file_path   text not null,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint,
  uploaded_by text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

alter table library_documents enable row level security;
drop policy if exists "Authenticated users full access" on library_documents;
create policy "Authenticated users full access" on library_documents
  for all to authenticated using (true) with check (true);

create index if not exists idx_library_documents_active
  on library_documents (category, created_at desc)
  where deleted_at is null;

create table if not exists print_orders (
  id              uuid primary key,
  submitter       text,
  note            text,
  item_count      int not null,
  items           jsonb not null,
  delivered       boolean not null default false,
  delivery_reason text,
  created_at      timestamptz not null default now()
);

alter table print_orders enable row level security;
drop policy if exists "Authenticated users full access" on print_orders;
create policy "Authenticated users full access" on print_orders
  for all to authenticated using (true) with check (true);

create index if not exists idx_print_orders_created
  on print_orders (created_at desc);

commit;
