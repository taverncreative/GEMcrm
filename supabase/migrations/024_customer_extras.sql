-- 024: Additional contact fields on customers
-- ============================================================
-- Commercial customers in particular need more context than name + email:
-- a role/position, a billing/registered address, a mobile, a website, and
-- a free-text notes field for "they only want morning visits" etc.
-- All are nullable so existing customers don't need backfilling.

alter table customers add column if not exists mobile text;
alter table customers add column if not exists position text;
alter table customers add column if not exists address text;
alter table customers add column if not exists website text;
alter table customers add column if not exists notes text;
