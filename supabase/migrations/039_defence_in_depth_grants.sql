-- 039: defence-in-depth grants — revoke anon table access + client hard-delete
-- ============================================================
-- Two belt-and-braces grant tightenings. Neither changes app behaviour;
-- both remove a footgun that RLS alone leaves standing.
--
-- Applied the manual linked way (db.migrations is disabled — see CLAUDE.md)
-- and mirrored into setup.sql so local rebuilds match prod.
--
-- ── M2: anon gets NO table access ──────────────────────────────────
-- Every RLS policy on these tables is `to authenticated`, so anon is
-- already blocked. But Supabase's default broad grants to anon
-- (SELECT/INSERT/UPDATE/DELETE/TRUNCATE) are a single point of failure:
-- one accidental `alter table … disable row level security` would expose
-- everything to the public anon key that ships in the client bundle.
-- Revoke them. The app never reads tables as anon — logged-in requests
-- carry the user JWT and run as `authenticated`; pre-login only hits the
-- GoTrue auth endpoints, not PostgREST tables.
revoke all on all tables in schema public from anon;

-- ── M1: authenticated cannot HARD-delete the five core tables ──────
-- All app deletes are soft-deletes through the soft_delete_<table>
-- SECURITY DEFINER RPCs, which UPDATE `deleted_at` as the table owner and
-- are unaffected by this revoke. Removing DELETE/TRUNCATE from the
-- `authenticated` role makes a raw REST DELETE impossible from any client
-- session — closing the path where one bad call cascades
-- customers → sites → jobs → reports/invoices/agreements. (invoices /
-- invoice_jobs keep DELETE: the invoice-create rollback in
-- lib/data/invoices.ts issues a real delete on its own row.)
revoke delete, truncate on public.customers  from authenticated;
revoke delete, truncate on public.sites       from authenticated;
revoke delete, truncate on public.jobs        from authenticated;
revoke delete, truncate on public.agreements  from authenticated;
revoke delete, truncate on public.tasks       from authenticated;
