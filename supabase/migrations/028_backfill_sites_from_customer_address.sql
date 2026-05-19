-- 028: Backfill sites from existing customers' registered addresses
-- ============================================================
-- Customers added before the auto-site-on-create change (commit
-- 1763f5c) have address fields populated but no corresponding `sites`
-- row, so the booking modal shows "no sites on record" and forces the
-- operator to re-enter the same address.
--
-- This migration creates a site for every such customer whose address
-- is complete enough to be useful (line 1 + town + postcode at minimum).
-- Idempotent thanks to the `not exists` check — safe to re-run on any DB.

insert into sites (
  customer_id,
  address_line_1,
  address_line_2,
  town,
  county,
  postcode
)
select
  c.id,
  c.address_line_1,
  c.address_line_2,
  c.town,
  c.county,
  c.postcode
from customers c
where c.address_line_1 is not null and c.address_line_1 <> ''
  and c.town           is not null and c.town           <> ''
  and c.postcode       is not null and c.postcode       <> ''
  and not exists (
    select 1 from sites s where s.customer_id = c.id
  );
