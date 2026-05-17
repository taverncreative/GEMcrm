-- 023: Backfill missing references + invoice numbers
-- ============================================================
-- Existing jobs created before migration 021 have NULL reference_number, so
-- invoices made from them fell back to a raw UUID stub (e.g. "77500CEF").
-- This script:
--   1. Assigns sequential refs to every job missing one — domestic just gets
--      the padded number, commercial gets number + 3-letter company code.
--   2. Backfills any invoice without an invoice_number, preferring the
--      linked job's reference; otherwise INV-YYYY-NNNN.

do $$
declare
  rec record;
  i int;
  base text;
  code text;
  src text;
  letters text;
begin
  -- Highest existing base number across all references; new ones start above it.
  select coalesce(max(
    (regexp_match(reference_number, '^(\d+)'))[1]::int
  ), 0) into i from jobs where reference_number is not null;

  for rec in
    select j.id, c.customer_type, c.company_name, c.name
    from jobs j
    join sites s on s.id = j.site_id
    join customers c on c.id = s.customer_id
    where j.reference_number is null
    order by j.created_at asc
  loop
    i := i + 1;
    base := lpad(i::text, 5, '0');

    if rec.customer_type = 'commercial' then
      src := coalesce(rec.company_name, rec.name);
      -- 3 alpha chars (uppercase). Pad with X if shorter than 3.
      letters := upper(regexp_replace(src, '[^a-zA-Z]', '', 'g'));
      code := rpad(left(letters, 3), 3, 'X');
      update jobs set reference_number = base || '-' || code where id = rec.id;
    else
      update jobs set reference_number = base where id = rec.id;
    end if;
  end loop;
end $$;

-- Invoices without a number adopt the linked job's reference if available,
-- otherwise a fresh INV-YYYY-NNNN.
do $$
declare
  rec record;
  job_ref text;
  next_seq int;
  yr text;
begin
  -- Seed the next INV sequence from existing INV-... numbers.
  select coalesce(max(
    (regexp_match(invoice_number, '^INV-\d{4}-(\d+)$'))[1]::int
  ), 1000) + 1 into next_seq from invoices where invoice_number like 'INV-%';

  for rec in
    select id, job_id, created_at from invoices
    where invoice_number is null
    order by created_at asc
  loop
    job_ref := null;
    if rec.job_id is not null then
      select reference_number into job_ref from jobs where id = rec.job_id;
    end if;

    if job_ref is not null then
      update invoices set invoice_number = job_ref where id = rec.id;
    else
      yr := to_char(coalesce(rec.created_at, now()), 'YYYY');
      update invoices set invoice_number = 'INV-' || yr || '-' || lpad(next_seq::text, 4, '0')
        where id = rec.id;
      next_seq := next_seq + 1;
    end if;
  end loop;
end $$;
