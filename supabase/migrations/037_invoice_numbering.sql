-- 037: unified sequential invoice numbering
-- ============================================================
-- Auto-invoices (createInvoiceForJob, on job completion) used to land with
-- no invoice_number — the PDF/UI fell back to a UUID stub (e.g. Natalie's
-- £105). This establishes ONE sequential INV-YYYY-NNNN register across
-- EVERY creation path, assigned by a BEFORE INSERT trigger sourced from
-- invoice_number_seq. The app no longer assigns numbers (the old JS max+1
-- was race-prone and never advanced the sequence; single-job invoices used
-- to reuse the job ref — that dual scheme is dropped so the register is its
-- own strictly-sequential series).
--
-- VAT is intentionally NOT touched here: GEM is not VAT-registered yet, so
-- invoices carry no VAT. VAT is gated in the app behind
-- BUSINESS.vatRegistered (branding.ts) — when GEM registers, flipping that
-- flag (not a migration) starts applying the split. Natalie stays at her
-- actual £105 with no VAT.
--
-- Idempotent + safe to re-run. The unique partial index on invoice_number
-- (migration 020) is the duplicate backstop; re-asserted below.

-- Sequence (created in 020; ensure for self-containment).
create sequence if not exists invoice_number_seq start 1000;

-- Realign the sequence to the true max INV- counter before we draw from it.
-- It lagged: every modal-created number used JS max+1 and never advanced
-- nextval, so nextval() could otherwise reissue an existing number.
select setval(
  'invoice_number_seq',
  greatest(
    (select last_value from invoice_number_seq),
    (select coalesce(
       max((regexp_match(invoice_number, '^INV-\d{4}-(\d+)$'))[1]::int), 1000)
     from invoices)
  ),
  true
);

-- Backfill every null number into the unified series (incl. job-linked
-- rows — no more job-ref reuse). Year is stamped from created_at.
update invoices
set invoice_number = 'INV-' || to_char(coalesce(created_at, now()), 'YYYY') || '-' ||
  lpad(nextval('invoice_number_seq')::text, 4, '0')
where invoice_number is null;

-- Trigger: assign the next number from the sequence when one isn't supplied.
-- Fires for ALL paths (auto, modal, manual SQL). Explicit numbers pass through.
create or replace function assign_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'INV-' || to_char(coalesce(new.created_at, now()), 'YYYY')
      || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_invoice_number on invoices;
create trigger trg_assign_invoice_number
  before insert on invoices
  for each row
  execute function assign_invoice_number();

-- Uniqueness backstop (re-assert; created in 020).
do $$ begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'invoices_invoice_number_unique'
  ) then
    create unique index invoices_invoice_number_unique
      on invoices (invoice_number) where invoice_number is not null;
  end if;
end $$;

-- DOWN (manual):
-- drop trigger if exists trg_assign_invoice_number on invoices;
-- drop function if exists assign_invoice_number();
-- Data backfills (invoice_number, VAT split) are NOT auto-reverted.
