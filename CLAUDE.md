@AGENTS.md

# Standing notes

## Soft delete under RLS — must go through a SECURITY DEFINER RPC

The five syncable tables (`customers`, `sites`, `jobs`, `agreements`, `tasks`)
each carry a per-operation SELECT policy `USING (deleted_at IS NULL)`
(migration 029). A self-hiding soft-delete — a plain
`update({ deleted_at: now() })` — is **rejected with 42501 "new row violates
row-level security policy"**: PostgREST returns the post-update row, and that
RETURNING row fails the SELECT policy (`deleted_at` is no longer null). The
UPDATE policy is `using(true)/with check(true)`, so it is NOT the gate.

So a soft-delete MUST go through a `soft_delete_<table>(p_id uuid)` SECURITY
DEFINER RPC, which runs as owner and bypasses RLS for the update while leaving
the read policies untouched. Templates: `soft_delete_customer` (migration 032)
and `soft_delete_job` (migration 038) — `auth.uid()` guard, `set search_path =
public`, `revoke` from public/anon, `grant execute` to authenticated.

`sites`, `tasks`, and `agreements` share the identical SELECT policy and have
no RPC yet — each will need its own `soft_delete_<table>` the day it gets a
delete/archive action. Don't reach for a direct `.update()` to soft-delete
them; it will 42501.

## Migrations apply manually — `db push` is disabled (parked debt)

`[db.migrations] enabled = false` in `supabase/config.toml`: the migrations
are not self-contained (001 does `alter table jobs …`, but the base tables
only exist in `setup.sql`), so a `db push`/reset replay fails at 001. The
local DB is built from `setup.sql` (`npm run db:local:rebuild`); remote
migrations are applied **manually**, transaction-wrapped (e.g.
`supabase db query --linked -f <migration>` — that's how 037 and 038 went in).

Parked debt: add a `000`-base migration so the chain is self-contained, then
re-enable `db push` and let the schema files be authoritative again. Until
that lands, the migrations + `setup.sql` are the live source of truth.
