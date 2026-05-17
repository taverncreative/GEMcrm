-- 026: Structured billing/registered address on customers
-- ============================================================
-- The earlier `address` column (migration 024) was a single free-text
-- textarea, which is awkward to render on invoices/letters and impossible
-- to query (e.g. "customers in Maidstone"). Split it the same way `sites`
-- is structured: line 1, line 2, town, county, postcode.
--
-- We also want a (single) address on DOMESTIC customers — previously the
-- form only collected it for commercial. The columns are all nullable so
-- nothing is forced for domestic.
--
-- Backfill: copy the legacy single-field `address` into `address_line_1`
-- so existing data isn't lost. The legacy column is left in place (nullable)
-- so any older read paths keep working; new write paths only touch the
-- structured columns.

alter table customers add column if not exists address_line_1 text;
alter table customers add column if not exists address_line_2 text;
alter table customers add column if not exists town text;
alter table customers add column if not exists county text;
alter table customers add column if not exists postcode text;

-- One-time backfill for any rows that have legacy `address` but no
-- structured value yet. Dump the whole thing into line 1; users can
-- re-edit to split it cleanly if they care.
update customers
   set address_line_1 = address
 where address is not null
   and address <> ''
   and address_line_1 is null;
