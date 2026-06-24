import { db } from "@/lib/db";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import {
  findClashingBookings,
  type BookingTimes,
} from "@/lib/scheduling/overlap";
import type { Customer, Job, Site } from "@/types/database";

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

/**
 * Offline clash check (Q3c) — the Dexie mirror of the server's partial
 * unique index `idx_jobs_site_date_unique`
 * (site_id, job_date, call_type WHERE is_archived=false AND
 * agreement_id IS NULL AND deleted_at IS NULL).
 *
 * The booking + upgrade modals call this against Dexie BEFORE the
 * optimistic write, so a duplicate is blocked inline (online AND offline)
 * instead of only surfacing later as a stuck outbox entry in the conflict
 * inbox (which stays as the server-side backstop). This honours the
 * "client-checkable from Dexie" rule — the operator learns about the
 * clash with no signal, not after a sync round-trip.
 *
 * Uses the compound `[site_id+job_date+call_type]` index, then filters
 * out the archived / soft-deleted / agreement rows the partial index
 * excludes. `excludeJobId` skips a row by id — the upgrade passes the
 * draft's own id so it can never clash with itself (a draft has a null
 * site_id and so isn't in this index anyway, but belt-and-braces).
 */
export async function findClashingJobLocal(
  siteId: string,
  jobDate: string,
  callType: string,
  excludeJobId?: string
): Promise<Job | undefined> {
  if (!siteId || !jobDate || !callType) return undefined;
  const candidates = await db.jobs
    .where("[site_id+job_date+call_type]")
    .equals([siteId, jobDate, callType])
    .toArray();
  return candidates.find(
    (j) =>
      j.id !== excludeJobId &&
      !j.is_archived &&
      !j.deleted_at &&
      !j.agreement_id
  );
}

/** One same-day booking that clashes with the candidate's time window —
 *  enough to NAME the conflict in the warning. */
export interface BookingClash {
  id: string;
  /** Headline customer name, or a neutral fallback if the chain can't
   *  resolve (e.g. a brand-new local site not yet linked). */
  customerName: string;
  /** Slot label for the copy: "10:00–11:00" or "10:00". */
  timeLabel: string;
}

/** "HH:MM:SS" / "HH:MM" → "HH:MM"; blank → "". */
function toHhMm(time: string | null): string {
  if (!time) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : time.trim();
}

/** "10:00–11:00" for a window, "10:00" for an instant, "" when untimed. */
function formatSlot(start: string | null, end: string | null): string {
  const s = toHhMm(start);
  if (!s) return "";
  const e = toHhMm(end);
  return e && e !== s ? `${s}–${e}` : s;
}

async function resolveCustomerName(siteId: string | null): Promise<string> {
  if (!siteId) return "another booking";
  const site = await db.sites.get(siteId);
  if (!site) return "another booking";
  const customer = await db.customers.get(site.customer_id);
  return customer ? customerDisplayName(customer) : "another booking";
}

/**
 * Same-day TIMED bookings that clash with a candidate booking's window —
 * the offline-first input to the non-blocking overlap WARNING on the New
 * Booking modal (Nate Q3).
 *
 * Reads Dexie (so it works online AND offline, like findClashingJobLocal),
 * scoped to the candidate's job_date via the standalone `job_date` index;
 * keeps live (not archived / soft-deleted) jobs that have a start time,
 * minus the booking being edited; then applies the pure half-open overlap
 * rule (lib/scheduling/overlap). Each clash is resolved to a customer name
 * + slot label so the warning can name what it conflicts with.
 *
 * Unlike findClashingJobLocal (a per-site duplicate guard), this spans ALL
 * sites: it's the operator's own diary being double-booked, regardless of
 * which customer each visit is for. Agreement-generated visits are included
 * — a recurring visit at a clashing time still double-books the day.
 *
 * Untimed candidate (job_time null) → returns [] (no clash), so the relaxed
 * flow never warns.
 */
export async function findOverlappingBookingsLocal(
  candidate: BookingTimes,
  excludeJobId?: string
): Promise<BookingClash[]> {
  if (!candidate.job_time || !candidate.job_date) return [];

  const sameDay = await db.jobs
    .where("job_date")
    .equals(candidate.job_date)
    .toArray();

  const live = sameDay.filter(
    (j) =>
      j.id !== excludeJobId &&
      !j.is_archived &&
      !j.deleted_at &&
      !!j.job_time
  );

  const clashes = findClashingBookings(candidate, live);

  // Same-day timed jobs are few (a single operator's diary), so the
  // per-row site→customer resolution is cheap.
  const out: BookingClash[] = [];
  for (const j of clashes) {
    out.push({
      id: j.id,
      customerName: await resolveCustomerName(j.site_id),
      timeLabel: formatSlot(j.job_time, j.job_time_end),
    });
  }
  return out;
}
