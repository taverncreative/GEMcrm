-- 019: Customer type + Google review status
-- ============================================================
-- Adds:
--  - customers.customer_type ('commercial' | 'domestic')
--  - customers.google_review_received (bool)
-- Default type is 'commercial' so existing rows stay categorisable.

alter table customers
  add column if not exists customer_type text not null default 'commercial';

alter table customers
  drop constraint if exists customers_type_check;

alter table customers
  add constraint customers_type_check
  check (customer_type in ('commercial', 'domestic'));

alter table customers
  add column if not exists google_review_received boolean not null default false;

create index if not exists idx_customers_type on customers (customer_type);
