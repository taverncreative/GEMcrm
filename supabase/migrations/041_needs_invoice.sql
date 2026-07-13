-- 041: needs_invoice flag on jobs (Invoices-required checklist, slice 1)
-- ============================================================
-- Nate invoices in QuickBooks, not in-app. He flags a job as "needs
-- invoicing" (from the service sheet's "Invoice required" checkbox, or a
-- toggle on the job detail page); flagged jobs collect into a homepage
-- checklist he ticks off once he has billed them in QuickBooks.
--
-- One additive column, `not null default false`, so every existing row
-- is unaffected: no job is "needs invoice" until it is explicitly
-- flagged. No backfill needed, and no collision with the legacy
-- `is_invoiced` flag, which is left exactly as-is here (slice 2 gates the
-- old in-app auto-generation + invoice UI separately).

alter table jobs add column if not exists needs_invoice boolean not null default false;
