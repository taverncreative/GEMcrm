# Step 3 — Soft deletes for syncable entities (notes)

Branch: `offline-pwa`
Commit: see HEAD on this branch — message starts `step 3: soft deletes for syncable entities`.

## What changed

| File | Change |
|---|---|
| `supabase/migrations/029_soft_deletes.sql` | **New.** Adds `deleted_at TIMESTAMPTZ NULL` to the 5 syncable tables, recreates the jobs partial unique index with `deleted_at IS NULL` in its predicate, replaces the single `FOR ALL` RLS policy on each table with 4 per-operation policies (SELECT filters deleted, others don't). Idempotent. Includes a commented `-- DOWN:` rollback block at the bottom for manual reversal. |
| `supabase/setup.sql` | Mirrored: added a `029: Soft deletes` section near the end (before the storage bucket setup). Uses a `DO $$ … END $$` loop over the 5 table names to keep the policy block compact in setup.sql vs the verbose per-table version in the migration. Both produce the same result. |
| `types/database.ts` | Added `deleted_at: string \| null` to `Customer`, `Site`, `Job`, `Agreement`, `Task` interfaces. Each has a comment cross-referencing the migration. |
| `lib/data/customers.ts` | `deleteCustomer()` rewritten to set `deleted_at = new Date().toISOString()` instead of running `DELETE`. Function signature unchanged (still `Promise<void>`). Long docstring explains the soft-delete semantics + the deliberate omission of `.select()` chain (which would otherwise hit the same SELECT RLS policy and return empty). Also updated `DeleteImpact` interface docstring to acknowledge that the counted child rows now become *hidden* rather than *deleted*. |
| `POST_OFFLINE_FOLLOWUPS.md` | Added four new parking-lot items: (1) inner-join visibility cascade, (2) financial reporting refactor to preserve historical revenue, (3) UI wording on delete-confirmation dialog, (4) restore UI + hard-delete admin path. |
| `STEP_3_NOTES.md` | This file. |

## Unique constraint conversion

Only one needed: **`idx_jobs_site_date_unique`** on `jobs(site_id, job_date, call_type)`. Previous partial predicate was `WHERE (is_archived = false AND agreement_id IS NULL)`. New predicate is `WHERE (is_archived = false AND agreement_id IS NULL AND deleted_at IS NULL)`. Existing index is dropped and recreated — the WHERE clause of a partial index can't be modified in place.

This was the *only* unique constraint across the 5 syncable tables apart from primary keys. Confirmed by exhaustive grep across `supabase/setup.sql` and all 28 prior migrations. Other UNIQUEs in the schema (`daily_summaries.summary_date`, `invoices.invoice_number`) sit on tables that aren't in the syncable set.

## RLS policy changes

Each of `customers`, `sites`, `jobs`, `agreements`, `tasks` previously had one policy:

```sql
CREATE POLICY "Authenticated users full access" ON <table>
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
```

Now has four:

```sql
CREATE POLICY "Authenticated users can read non-deleted" ON <table>
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

CREATE POLICY "Authenticated users can insert" ON <table>
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update" ON <table>
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete (hard)" ON <table>
  FOR DELETE TO authenticated
  USING (true);
```

Why split: Postgres RLS can't express "filter SELECT but leave UPDATE unfiltered" within a single `FOR ALL` policy. SELECT needs the deleted-row filter for the soft-delete enforcement to work; UPDATE needs to be able to target deleted rows so we can soft-delete (and later restore) them; DELETE is retained for emergency admin hard-deletion (e.g. GDPR right-to-erasure) and isn't called from the data layer.

The four policies on `daily_summaries`, `feature_requests`, `invoices` are untouched — those tables don't have `deleted_at` and aren't in the syncable set.

## Data layer changes

Only one hard `.delete()` call existed in the entire `lib/data/*` tree: `deleteCustomer()`. It's the only one converted. No data-layer function name changed — `deleteCustomer` still exists, it just does a soft delete now. The action that calls it (`deleteCustomerAction` in `app/(app)/customers/actions.ts`) is untouched and works as-is.

## Things that surprised me

1. **One real surprise on the `.select()` chain.** When I first sketched the soft-delete update, my instinct was `.update({ deleted_at }).eq("id", $1).select().single()` to confirm the write. But: the same SELECT RLS policy filters `deleted_at IS NULL`, so the just-updated row (which now *isn't* null) is invisible to the SELECT clause — `.single()` would throw "no rows returned" even though the update succeeded. The fix is just to omit `.select()` entirely. Inline comment added to make this not-a-bug-but-deliberate clear to future readers.

2. **`DeleteImpact` was already misleading even pre-soft-delete.** The interface counted "cascaded children" because the old hard-delete physically removed them. With Option-1 soft-delete (no cascade), the children stay in the DB but become hidden via the inner-join + RLS interaction. So the counts are still meaningful ("how many of this customer's records are about to vanish from your views?") but the dialog wording in the UI now needs updating. Tracked as a UI follow-up in `POST_OFFLINE_FOLLOWUPS.md`.

3. **The agreement-events service is safe.** `generateAgreementJobs()` is only called once at agreement creation, with the just-created agreement object — there's no "regenerate jobs for an existing agreement" path that could fire for a soft-deleted PMA. No additional defence needed. Confirmed by tracing the only call site (`app/(app)/sites/[id]/agreements/actions.ts`).

4. **No other read-query refactors needed for step 3.** The RLS SELECT filter is automatic — every `supabase.from('customers').select(...)` in `lib/data/*` will start filtering deleted rows the moment the migration applies. No code changes required for that to take effect.

5. **Live-row partial indexes added as a small perf hedge.** `idx_<table>_live ON <table> (id) WHERE deleted_at IS NULL` on each of the 5 tables. Cheap insurance — the planner can use them as covering indexes for the typical `WHERE deleted_at IS NULL` filter that every query now implicitly carries. Won't make any difference at GEM's current volume but matters at 5K+ rows. If you want to skip these, remove the `create index if not exists idx_*_live` block from the migration before applying — purely an optimisation.

## Acceptance criteria

| Criterion | Status |
|---|---|
| `next build` passes | ✅ All 22 routes generated |
| `npx tsc --noEmit` clean | ✅ |
| ESLint clean on changed files | ✅ |
| Migration applies cleanly to a fresh DB | ⚠️ I have no local Supabase. **Awaiting your apply via Supabase Studio** — see "Manual smoke test steps" below. The SQL is idempotent so safe to re-run. |
| Soft-delete a customer via UI, verify row exists with `deleted_at` set, disappears from lists | ⚠️ Awaiting manual test |
| Recreate-after-soft-delete works | ⚠️ Awaiting manual test |
| `proxy.ts` still works (step-1 sanity check) | ✅ Build succeeds with `Proxy (Middleware)` line — no regression in the auth-middleware swap |

## Manual smoke test steps

### Step A — apply the migration

1. Open Supabase Studio for the GEM project → SQL Editor → New Query.
2. Paste the contents of `supabase/migrations/029_soft_deletes.sql` and run.
3. Confirm the output is `Success. No rows returned`.
4. Sanity check via Studio's Table Editor: open `customers` → confirm the `deleted_at` column now appears (timestamptz, nullable). Repeat for `sites`, `jobs`, `agreements`, `tasks`.
5. SQL check on the RLS policies:
   ```sql
   SELECT schemaname, tablename, policyname, cmd
   FROM pg_policies
   WHERE tablename IN ('customers','sites','jobs','agreements','tasks')
   ORDER BY tablename, cmd;
   ```
   Should show 4 policies per table (SELECT/INSERT/UPDATE/DELETE), 20 rows total.
6. SQL check on the partial unique index:
   ```sql
   SELECT indexname, indexdef
   FROM pg_indexes
   WHERE indexname = 'idx_jobs_site_date_unique';
   ```
   The `indexdef` should include `WHERE ((is_archived = false) AND (agreement_id IS NULL) AND (deleted_at IS NULL))`.

### Step B — soft-delete a customer end-to-end

1. In the deployed app (or `npm run dev`), open Customers → pick any test customer → side panel → scroll to bottom → "Delete customer" → confirm.
2. The list should re-render and the customer should no longer appear.
3. In Supabase Studio: `SELECT id, name, deleted_at FROM customers WHERE name = '<their name>';`. The row exists with `deleted_at` populated. ✓ Soft delete worked.
4. Confirm the visibility cascade: SELECT against `jobs` for one of that customer's sites — `SELECT id FROM jobs WHERE site_id = '<some-site-id-of-deleted-customer>';` returns rows (they still exist physically), but the UI's Jobs list does NOT show them (because the list query inner-joins through customers and RLS hides the parent). ✓ This is the documented Option-1 behaviour, not a bug.

### Step C — recreate-after-soft-delete on a job

1. Pick any existing scheduled `routine` job that isn't archived and isn't tied to an agreement. Note its `(site_id, job_date, call_type)`.
2. In Studio: `UPDATE jobs SET deleted_at = now() WHERE id = '<that job id>';` — soft-delete it.
3. In the app (or via SQL), create a new job with the same `(site_id, job_date, call_type)`. The unique-constraint check should let it through (because the soft-deleted row is now excluded from the partial index predicate). ✓
4. Verify in Studio: two rows now exist at that `(site_id, job_date, call_type)`, one with `deleted_at` set, one without. ✓

### Step D — restore confirmation (admin SQL only — no UI)

1. In Studio: `UPDATE customers SET deleted_at = NULL WHERE id = '<the one you soft-deleted in step B>';`
2. Refresh the Customers list. They should reappear. ✓

### Step E — sanity check the step-1 fix hasn't regressed

1. Log out, then log back in. Navigate to /dashboard.
2. Open DevTools → Application → Cookies → delete the `sb-*-auth-token` cookie.
3. Reload. Should redirect to `/login`. ✓

## What I have NOT done (deliberately)

- Not pushed the branch — local only, awaiting your review.
- Not applied the migration anywhere — no local Supabase; awaiting your apply via Studio.
- Not converted any inner-join queries to outer joins (Option 1 accepted; flagged in followups for later).
- Not updated the `DeleteCustomerConfirm` UI copy ("deleted" vs "hidden") — flagged in followups.
- Not refactored `getRevenueStats` for soft-delete-safe historical revenue — flagged in followups.
- Not added a Restore UI or admin hard-delete path — flagged in followups.
- Not touched `types/database.ts` for non-syncable entities (`Invoice`, `Report`, etc) — they don't get `deleted_at`.

## Awaiting your review + manual application

Step 3 done as code. Migration ready to apply via Studio per the steps above.

When ready, tell me to proceed to **step 4: Dexie store + schema mirror**.
