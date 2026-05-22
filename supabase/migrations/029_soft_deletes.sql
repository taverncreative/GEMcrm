-- 029: Soft deletes for the 5 syncable entities
-- ============================================================
-- Adds `deleted_at TIMESTAMPTZ NULL` to customers, sites, jobs, agreements,
-- and tasks — the entities that will sync to the offline PWA store. With a
-- soft-delete column, the device can mark rows deleted while offline and
-- the change replays cleanly during sync, instead of fighting cascade
-- semantics on the wire.
--
-- Three things change per table:
--
-- 1. Column added: `deleted_at timestamptz null` (no default — null
--    means live).
--
-- 2. RLS rewrite: the existing single combined policy
--      "Authenticated users full access" FOR ALL USING (true) WITH CHECK (true)
--    is replaced with 4 per-operation policies. SELECT filters
--    `deleted_at IS NULL` so soft-deleted rows automatically disappear
--    from every read across the app. INSERT/UPDATE/DELETE keep
--    USING (true) so the data layer can soft-delete (and a future
--    restore UI can clear deleted_at), and admin SQL can still hard-
--    delete if ever needed (e.g. GDPR right-to-erasure).
--    Postgres RLS can't express per-operation filters inside a single
--    FOR ALL policy, so splitting is the canonical fix.
--
-- 3. Partial unique index on jobs: `idx_jobs_site_date_unique` already
--    has a partial predicate (`is_archived = false AND agreement_id IS NULL`).
--    Extends it to also include `AND deleted_at IS NULL` so a soft-deleted
--    job doesn't block a new job being scheduled at the same
--    (site_id, job_date, call_type) slot. This is the only unique
--    constraint across the 5 syncable tables that needs the treatment —
--    everything else is just a PRIMARY KEY (id) which is uuid-generated
--    per row and never reused.
--
-- Idempotent throughout (matches repo migration style). Safe to re-run.

-- 1. Add deleted_at columns ─────────────────────────────────────────
alter table customers  add column if not exists deleted_at timestamptz;
alter table sites      add column if not exists deleted_at timestamptz;
alter table jobs       add column if not exists deleted_at timestamptz;
alter table agreements add column if not exists deleted_at timestamptz;
alter table tasks      add column if not exists deleted_at timestamptz;

-- Helpful indexes — most queries will hit RLS's `deleted_at IS NULL`
-- filter on every row, so a partial index on the typical live state
-- keeps that fast. (`WHERE deleted_at IS NOT NULL` is the rare case —
-- restore UI / admin tools — and doesn't need its own index yet.)
create index if not exists idx_customers_live  on customers  (id) where deleted_at is null;
create index if not exists idx_sites_live      on sites      (id) where deleted_at is null;
create index if not exists idx_jobs_live       on jobs       (id) where deleted_at is null;
create index if not exists idx_agreements_live on agreements (id) where deleted_at is null;
create index if not exists idx_tasks_live      on tasks      (id) where deleted_at is null;

-- 2. Rewrite the jobs partial unique index to also exclude soft-deleted
--    rows from the uniqueness predicate. Drop-then-create because the
--    WHERE clause of an existing index can't be altered in place. ──
drop index if exists idx_jobs_site_date_unique;
create unique index idx_jobs_site_date_unique
  on jobs (site_id, job_date, call_type)
  where (is_archived = false and agreement_id is null and deleted_at is null);

-- 3. Replace the FOR ALL policy with 4 per-operation policies on each
--    of the 5 syncable tables. Drop-then-create is the idempotent
--    pattern for policies (Postgres doesn't support CREATE POLICY IF
--    NOT EXISTS). ──────────────────────────────────────────────────

-- ── customers ──
drop policy if exists "Authenticated users full access"           on customers;
drop policy if exists "Authenticated users can read non-deleted"  on customers;
drop policy if exists "Authenticated users can insert"            on customers;
drop policy if exists "Authenticated users can update"            on customers;
drop policy if exists "Authenticated users can delete (hard)"     on customers;

create policy "Authenticated users can read non-deleted" on customers
  for select to authenticated
  using (deleted_at is null);
create policy "Authenticated users can insert" on customers
  for insert to authenticated
  with check (true);
create policy "Authenticated users can update" on customers
  for update to authenticated
  using (true)
  with check (true);
create policy "Authenticated users can delete (hard)" on customers
  for delete to authenticated
  using (true);

-- ── sites ──
drop policy if exists "Authenticated users full access"           on sites;
drop policy if exists "Authenticated users can read non-deleted"  on sites;
drop policy if exists "Authenticated users can insert"            on sites;
drop policy if exists "Authenticated users can update"            on sites;
drop policy if exists "Authenticated users can delete (hard)"     on sites;

create policy "Authenticated users can read non-deleted" on sites
  for select to authenticated
  using (deleted_at is null);
create policy "Authenticated users can insert" on sites
  for insert to authenticated
  with check (true);
create policy "Authenticated users can update" on sites
  for update to authenticated
  using (true)
  with check (true);
create policy "Authenticated users can delete (hard)" on sites
  for delete to authenticated
  using (true);

-- ── jobs ──
drop policy if exists "Authenticated users full access"           on jobs;
drop policy if exists "Authenticated users can read non-deleted"  on jobs;
drop policy if exists "Authenticated users can insert"            on jobs;
drop policy if exists "Authenticated users can update"            on jobs;
drop policy if exists "Authenticated users can delete (hard)"     on jobs;

create policy "Authenticated users can read non-deleted" on jobs
  for select to authenticated
  using (deleted_at is null);
create policy "Authenticated users can insert" on jobs
  for insert to authenticated
  with check (true);
create policy "Authenticated users can update" on jobs
  for update to authenticated
  using (true)
  with check (true);
create policy "Authenticated users can delete (hard)" on jobs
  for delete to authenticated
  using (true);

-- ── agreements ──
drop policy if exists "Authenticated users full access"           on agreements;
drop policy if exists "Authenticated users can read non-deleted"  on agreements;
drop policy if exists "Authenticated users can insert"            on agreements;
drop policy if exists "Authenticated users can update"            on agreements;
drop policy if exists "Authenticated users can delete (hard)"     on agreements;

create policy "Authenticated users can read non-deleted" on agreements
  for select to authenticated
  using (deleted_at is null);
create policy "Authenticated users can insert" on agreements
  for insert to authenticated
  with check (true);
create policy "Authenticated users can update" on agreements
  for update to authenticated
  using (true)
  with check (true);
create policy "Authenticated users can delete (hard)" on agreements
  for delete to authenticated
  using (true);

-- ── tasks ──
drop policy if exists "Authenticated users full access"           on tasks;
drop policy if exists "Authenticated users can read non-deleted"  on tasks;
drop policy if exists "Authenticated users can insert"            on tasks;
drop policy if exists "Authenticated users can update"            on tasks;
drop policy if exists "Authenticated users can delete (hard)"     on tasks;

create policy "Authenticated users can read non-deleted" on tasks
  for select to authenticated
  using (deleted_at is null);
create policy "Authenticated users can insert" on tasks
  for insert to authenticated
  with check (true);
create policy "Authenticated users can update" on tasks
  for update to authenticated
  using (true)
  with check (true);
create policy "Authenticated users can delete (hard)" on tasks
  for delete to authenticated
  using (true);


-- =====================================================================
-- DOWN (manual rollback — repo has no migration tool to run this for you)
-- =====================================================================
-- Run the following to revert this migration. NOTE: dropping `deleted_at`
-- destroys any soft-deletion history. Restore those rows manually first
-- (`UPDATE <table> SET deleted_at = NULL WHERE deleted_at IS NOT NULL`)
-- if you want them back live before tearing the column down.
--
-- -- 1. Restore the original combined "FOR ALL" RLS policy on each table:
-- DO $$
-- DECLARE t text;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY['customers','sites','jobs','agreements','tasks']
--   LOOP
--     EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can read non-deleted" ON %I', t);
--     EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can insert"            ON %I', t);
--     EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can update"            ON %I', t);
--     EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can delete (hard)"     ON %I', t);
--     EXECUTE format('CREATE POLICY "Authenticated users full access" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
--   END LOOP;
-- END $$;
--
-- -- 2. Restore the original jobs partial unique index predicate (without deleted_at):
-- DROP INDEX IF EXISTS idx_jobs_site_date_unique;
-- CREATE UNIQUE INDEX idx_jobs_site_date_unique
--   ON jobs (site_id, job_date, call_type)
--   WHERE (is_archived = false AND agreement_id IS NULL);
--
-- -- 3. Drop the live-row partial indexes added for read-side efficiency:
-- DROP INDEX IF EXISTS idx_customers_live;
-- DROP INDEX IF EXISTS idx_sites_live;
-- DROP INDEX IF EXISTS idx_jobs_live;
-- DROP INDEX IF EXISTS idx_agreements_live;
-- DROP INDEX IF EXISTS idx_tasks_live;
--
-- -- 4. Drop the deleted_at columns. DESTRUCTIVE — any soft-deletion
-- --    history not already restored will be lost:
-- ALTER TABLE customers  DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE sites      DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE jobs       DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE agreements DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE tasks      DROP COLUMN IF EXISTS deleted_at;
