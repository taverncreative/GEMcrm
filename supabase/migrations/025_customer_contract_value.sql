-- 025: Optional annual contract value on customers
-- ============================================================
-- Lets the operator note an expected / headline annual contract value on
-- a customer record (e.g. £40,000 pa) without needing a full Pest
-- Management Agreement saved yet. Pure metadata — independent of the
-- per-PMA `agreements.contract_value`. Nullable.

alter table customers
  add column if not exists annual_contract_value numeric;
