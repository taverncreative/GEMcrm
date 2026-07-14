-- 042_agreement_draft_status.sql
--
-- Allow an unsigned DRAFT agreement: a personalised proposal (customer,
-- visits, price, pests, terms) that is sent to the customer to review
-- BEFORE signing, then finalised later by capturing signatures (Slice 2).
--
-- The only change is widening the status check to include 'draft'. Additive:
-- no existing row (active/paused/cancelled) violates the new constraint.
-- Default stays 'active', so the sign-now create path is untouched; the
-- draft-create path passes status='draft' explicitly.
--
-- Applied manually, transaction-wrapped (db push is parked debt).

begin;

alter table public.agreements drop constraint agreements_status_check;

alter table public.agreements
  add constraint agreements_status_check
  check (status in ('draft', 'active', 'paused', 'cancelled'));

commit;
