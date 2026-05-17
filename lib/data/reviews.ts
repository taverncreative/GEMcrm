import { createClient } from "@/lib/supabase/server";
import { todayUk, dateUkOffset } from "@/lib/utils/today-uk";
import type { Customer, CustomerType } from "@/types/database";

export interface ReviewCandidate {
  customer: Customer;
  lastJob: {
    id: string;
    job_date: string;
    call_type: string | null;
    site_address: string | null;
  } | null;
}

/**
 * Customers that should be asked for a Google review.
 *
 * Filter:
 *   - Not already received (`google_review_received = false`)
 *   - Have an email on file
 *   - Have at least one completed job
 *   - Not snoozed (snoozed_until null OR in the past)
 *
 * The "last job" is attached for context in the dashboard widget.
 */
export async function getReviewRequestCandidates(
  limit: number = 10
): Promise<ReviewCandidate[]> {
  const supabase = await createClient();
  const today = todayUk();

  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .eq("google_review_received", false)
    .not("email", "is", null)
    .or(
      `review_request_snoozed_until.is.null,review_request_snoozed_until.lt.${today}`
    )
    .order("created_at", { ascending: false })
    .limit(limit * 4); // over-fetch; we'll filter to those with completed jobs

  if (error) {
    console.error("[getReviewRequestCandidates]", error.code, error.message);
    return [];
  }
  if (!customers || customers.length === 0) return [];

  // Pull last completed job per customer in one batched query.
  const ids = customers.map((c) => c.id);
  const { data: sites } = await supabase
    .from("sites")
    .select("id, customer_id, address_line_1, town, postcode")
    .in("customer_id", ids);

  const siteToCustomer = new Map<string, string>();
  const siteMeta = new Map<
    string,
    { address: string }
  >();
  for (const s of sites ?? []) {
    siteToCustomer.set(s.id, s.customer_id);
    siteMeta.set(s.id, {
      address: [s.address_line_1, s.town, s.postcode]
        .filter(Boolean)
        .join(", "),
    });
  }

  const siteIds = (sites ?? []).map((s) => s.id);
  let jobs: Array<{
    id: string;
    site_id: string;
    job_date: string;
    call_type: string | null;
  }> = [];
  if (siteIds.length > 0) {
    const { data } = await supabase
      .from("jobs")
      .select("id, site_id, job_date, call_type")
      .in("site_id", siteIds)
      .eq("job_status", "completed")
      .order("job_date", { ascending: false });
    jobs = data ?? [];
  }

  // Last completed job per customer.
  const lastJobByCustomer = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) {
    const cid = siteToCustomer.get(j.site_id);
    if (!cid) continue;
    if (!lastJobByCustomer.has(cid)) lastJobByCustomer.set(cid, j);
  }

  const candidates: ReviewCandidate[] = [];
  for (const c of customers) {
    const last = lastJobByCustomer.get(c.id);
    if (!last) continue; // never had a completed job — skip
    candidates.push({
      customer: c as Customer,
      lastJob: {
        id: last.id,
        job_date: last.job_date,
        call_type: last.call_type,
        site_address: siteMeta.get(last.site_id)?.address ?? null,
      },
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

/**
 * Snooze the review prompt for N days (defaults to 7).
 */
export async function snoozeReviewRequest(
  customerId: string,
  days: number = 7
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({
      review_request_snoozed_until: dateUkOffset(days),
    })
    .eq("id", customerId);
  if (error) {
    console.error("[snoozeReviewRequest]", error.code, error.message);
    throw new Error(`Failed to snooze: ${error.message}`);
  }
}

/**
 * Auto-trigger: for each domestic customer whose most recent completed job
 * was at least one day ago, no review received, no email sent yet — send the
 * review email and mark the customer.
 *
 * Runs each time the dashboard loads. Idempotent — guarded by
 * `review_email_sent_at`. Email service is a stub today; switching to a
 * real provider does not require changing this code.
 */
export async function processDomesticReviewSends(): Promise<number> {
  // Lazy import to avoid pulling the email module into every server bundle.
  const { sendReviewRequest } = await import("@/lib/services/review-email");

  const supabase = await createClient();
  const cutoff = dateUkOffset(-1);

  // Domestic customers with no review and no prior email.
  const { data: customers } = await supabase
    .from("customers")
    .select("*")
    .eq("customer_type", "domestic" satisfies CustomerType)
    .eq("google_review_received", false)
    .is("review_email_sent_at", null)
    .not("email", "is", null);

  if (!customers || customers.length === 0) return 0;

  // Get their latest completed job (we only send if at least one is >= 1 day old).
  const ids = customers.map((c) => c.id);
  const { data: sites } = await supabase
    .from("sites")
    .select("id, customer_id")
    .in("customer_id", ids);
  const siteToCustomer = new Map<string, string>();
  for (const s of sites ?? []) siteToCustomer.set(s.id, s.customer_id);

  const siteIds = (sites ?? []).map((s) => s.id);
  if (siteIds.length === 0) return 0;

  const { data: jobs } = await supabase
    .from("jobs")
    .select("site_id, job_date")
    .in("site_id", siteIds)
    .eq("job_status", "completed")
    .lte("job_date", cutoff)
    .order("job_date", { ascending: false });

  const customersDue = new Set<string>();
  for (const j of jobs ?? []) {
    const cid = siteToCustomer.get(j.site_id);
    if (cid) customersDue.add(cid);
  }

  let sentCount = 0;
  for (const c of customers) {
    if (!customersDue.has(c.id)) continue;
    try {
      await sendReviewRequest(c as Customer);
      await supabase
        .from("customers")
        .update({ review_email_sent_at: new Date().toISOString() })
        .eq("id", c.id);
      sentCount++;
    } catch (err) {
      console.error("[processDomesticReviewSends]", c.id, err);
    }
  }
  return sentCount;
}
