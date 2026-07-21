/**
 * Sync-pull data layer.
 *
 * One function per syncable entity. Each calls the matching SECURITY
 * DEFINER RPC installed by `supabase/migrations/030_sync_pull_functions.sql`.
 *
 * Why an RPC and not a plain `.from(table).select("*")` call:
 *
 *   Migration 029 installed a per-operation RLS policy on each syncable
 *   table whose SELECT predicate filters `deleted_at IS NULL`. That's
 *   the right behaviour for every other read in the app (the operator
 *   never wants to see deleted rows in a list view), but it means the
 *   pull sync — which needs to *learn about* deletions on other devices —
 *   would never see them. The RPC bypasses RLS via SECURITY DEFINER and
 *   re-checks `auth.uid() IS NOT NULL` inside the body.
 *
 * The returned rows are merged into Dexie by the sync engine (see
 * `lib/sync/pull.ts`). This module is just the network shim — it makes
 * no decisions about merge policy, cursor advancement, or conflict
 * detection. Pure data layer.
 *
 * Cursor contract (defined here, enforced by the pull engine):
 *
 *   - `since = null` → first sync; pull everything.
 *   - `since = "2026-05-22T10:00:00.000Z"` → strict greater-than. RPC
 *     orders by `updated_at ASC` so the caller takes the max of the
 *     returned set as the new cursor. Using `now()` instead would
 *     drop rows whose `updated_at` equals the boundary by exactly one
 *     row.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  Customer,
  Site,
  Job,
  Agreement,
  Task,
  BlockedPeriod,
} from "@/types/database";

/**
 * Generic plumbing — each entity's pull is the same shape varying only
 * by RPC name and return type. Keeping the per-entity exports below is
 * a deliberate ergonomic choice (better IDE jump-to-definition) but
 * the body is shared via this helper.
 */
async function pullEntity<T>(
  rpcName: string,
  since: string | null
): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(rpcName, { since });
  if (error) {
    console.error(`[${rpcName}]`, error.code, error.message);
    throw new Error(`Sync pull failed (${rpcName}): ${error.message}`);
  }
  return (data ?? []) as T[];
}

export async function pullCustomersSince(
  since: string | null
): Promise<Customer[]> {
  return pullEntity<Customer>("sync_pull_customers", since);
}

export async function pullSitesSince(
  since: string | null
): Promise<Site[]> {
  return pullEntity<Site>("sync_pull_sites", since);
}

export async function pullJobsSince(
  since: string | null
): Promise<Job[]> {
  return pullEntity<Job>("sync_pull_jobs", since);
}

export async function pullAgreementsSince(
  since: string | null
): Promise<Agreement[]> {
  return pullEntity<Agreement>("sync_pull_agreements", since);
}

export async function pullTasksSince(
  since: string | null
): Promise<Task[]> {
  return pullEntity<Task>("sync_pull_tasks", since);
}

export async function pullBlockedPeriodsSince(
  since: string | null
): Promise<BlockedPeriod[]> {
  return pullEntity<BlockedPeriod>("sync_pull_blocked_periods", since);
}
