import { db } from "@/lib/db";
import type { Customer, Site } from "@/types/database";

/**
 * Local (Dexie) lookups for the booking / invoice customer + site
 * pickers — the offline-safe mirror of `searchCustomersAction` and
 * `getSitesForCustomerAction` (app/(app)/bookings/actions.ts).
 *
 * Those server actions hit Supabase, so offline they hang forever
 * ("Searching…" / "Loading sites…"). customers + sites are already
 * synced into Dexie, so reading locally makes the pickers behave
 * identically online and offline. Online they now reflect the last
 * sync rather than a live server query — consistent with the customers
 * list page, which is already a local `useLiveQuery` read.
 *
 * Predicate parity with the server actions:
 *   - customers: empty query → all; else case-insensitive substring on
 *     name OR company_name; newest first (created_at desc); limit 10.
 *   - sites: scoped to customer_id; newest first (created_at desc).
 * Both additionally exclude soft-deleted rows (`deleted_at`) — the
 * server *read* path doesn't, but the list UI does, and we don't want a
 * deleted customer/site to be re-bookable. created_at isn't a Dexie
 * index, so the sort happens in JS; these tables are small (a
 * single-business CRM) so the full scan + sort is trivial.
 *
 * Kept general (not booking-specific) so the invoice creator modal —
 * which uses the same customer picker — can reuse `searchCustomersLocal`
 * in a later pass.
 */

const DEFAULT_LIMIT = 10;

/** Newest-first by ISO `created_at` string (desc). */
function byCreatedAtDesc<T extends { created_at: string }>(a: T, b: T): number {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

export async function searchCustomersLocal(
  query: string,
  limit: number = DEFAULT_LIMIT
): Promise<Customer[]> {
  const all = await db.customers.toArray();
  const q = query.trim().toLowerCase();
  const matched = all.filter((c) => {
    if (c.deleted_at) return false;
    if (!q) return true;
    const name = (c.name ?? "").toLowerCase();
    const company = (c.company_name ?? "").toLowerCase();
    return name.includes(q) || company.includes(q);
  });
  matched.sort(byCreatedAtDesc);
  return matched.slice(0, limit);
}

export async function getSitesForCustomerLocal(
  customerId: string
): Promise<Site[]> {
  if (!customerId) return [];
  const sites = await db.sites
    .where("customer_id")
    .equals(customerId)
    .toArray();
  return sites.filter((s) => !s.deleted_at).sort(byCreatedAtDesc);
}
