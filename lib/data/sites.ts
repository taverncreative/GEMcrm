import { createClient } from "@/lib/supabase/server";
import { newId } from "@/lib/utils/id";
import type { Site } from "@/types/database";
import type { SiteInput } from "@/lib/validation/site";

/** Convert empty strings to null for database storage. */
function emptyToNull(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

export async function getSitesByCustomer(customerId: string): Promise<Site[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getSitesByCustomer]", error.code, error.message);
    throw new Error(`Failed to fetch sites: ${error.message}`);
  }

  return data;
}

export async function getSiteById(
  id: string | null | undefined
): Promise<Site | null> {
  // A draft job (Q2) has no site — callers following job -> site pass a
  // null id; short-circuit rather than round-trip a guaranteed miss.
  if (!id) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("[getSiteById]", error.code, error.message);
    throw new Error(`Failed to fetch site: ${error.message}`);
  }

  return data;
}

export async function createSite(
  customerId: string,
  input: SiteInput,
  opts?: { id?: string }
): Promise<Site> {
  const supabase = await createClient();
  // `opts.id` from the offline-first path; upsert(onConflict:"id")
  // keeps a lost-ack replay re-run idempotent. Online callers omit it
  // → fresh UUID, behaves like an insert.
  const { data, error } = await supabase
    .from("sites")
    .upsert({
      id: opts?.id ?? newId(),
      customer_id: customerId,
      // Blank address fields → null (a bare site is just customer_id +
      // a blank address, created for a quick-add booking).
      address_line_1: emptyToNull(input.address_line_1),
      address_line_2: emptyToNull(input.address_line_2),
      town: emptyToNull(input.town),
      county: emptyToNull(input.county),
      postcode: input.postcode.trim()
        ? input.postcode.trim().toUpperCase()
        : null,
    })
    .select()
    .single();

  if (error) {
    console.error("[createSite]", error.code, error.message);
    throw new Error(`Failed to create site: ${error.message}`);
  }

  return data;
}

/**
 * Edit an existing site's address — a plain `.update().eq("id")`, ONLINE
 * ONLY (no RPC). A normal field update never touches `deleted_at`, so the
 * post-update RETURNING row still satisfies the SELECT policy
 * `USING (deleted_at IS NULL)` and there's no 42501 catch-22 — same as
 * {@link updateCustomer}. Sites were create-only until now; this is the
 * surface that lets an operator fix a bare/quick-add site's address.
 *
 * Field normalisation mirrors {@link createSite} (blank → null, postcode
 * uppercased). Returns the updated row so the caller can refresh the local
 * (Dexie) cache without waiting for the next sync pull.
 */
export async function updateSite(
  siteId: string,
  input: SiteInput
): Promise<Site> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .update({
      address_line_1: emptyToNull(input.address_line_1),
      address_line_2: emptyToNull(input.address_line_2),
      town: emptyToNull(input.town),
      county: emptyToNull(input.county),
      postcode: input.postcode.trim()
        ? input.postcode.trim().toUpperCase()
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId)
    .select()
    .single();

  if (error) {
    console.error("[updateSite]", error.code, error.message);
    throw new Error(`Failed to update site: ${error.message}`);
  }

  return data;
}

/**
 * What else goes when this site goes. Surfaced in the delete-confirm dialog
 * so the operator sees the blast radius before committing, and used as the
 * client-side mirror of the RPC's live-agreement guard.
 *
 * Counts are of LIVE rows only (RLS already hides soft-deleted ones), so a
 * second look after a delete reads zero rather than repeating itself.
 */
export interface SiteDeleteImpact {
  /** Live jobs at this site — all of them are soft-deleted with the site. */
  jobs: number;
  /** Of those jobs, how many are still scheduled/in progress (future work
   *  the operator is about to lose from the calendar). */
  upcomingJobs: number;
  /** Live jobs carrying a generated service sheet. The sheets SURVIVE and
   *  stay in Documents — the dialog says so. */
  serviceSheets: number;
  /** Draft + cancelled agreements — these go with the site. */
  deadAgreements: number;
  /** Active + paused agreements. Any of these BLOCKS the delete. */
  liveAgreements: number;
}

export async function getSiteDeleteImpact(
  siteId: string
): Promise<SiteDeleteImpact> {
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, job_status")
    .eq("site_id", siteId);

  const jobRows = (jobs ?? []) as { id: string; job_status: string }[];
  const upcomingJobs = jobRows.filter(
    (j) => j.job_status === "scheduled" || j.job_status === "in_progress"
  ).length;

  // Service sheets are counted through the jobs, not joined — `reports` has
  // no site_id. Skip the round trip when the site has no jobs at all.
  let serviceSheets = 0;
  if (jobRows.length > 0) {
    const { count } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .in(
        "job_id",
        jobRows.map((j) => j.id)
      )
      .not("pdf_url", "is", null)
      .is("deleted_at", null);
    serviceSheets = count ?? 0;
  }

  const { data: agreements } = await supabase
    .from("agreements")
    .select("status")
    .eq("site_id", siteId);

  const agreementRows = (agreements ?? []) as { status: string }[];

  return {
    jobs: jobRows.length,
    upcomingJobs,
    serviceSheets,
    deadAgreements: agreementRows.filter(
      (a) => a.status === "draft" || a.status === "cancelled"
    ).length,
    liveAgreements: agreementRows.filter(
      (a) => a.status === "active" || a.status === "paused"
    ).length,
  };
}

/**
 * Soft-delete a site, cascading to its jobs and its dead (draft/cancelled)
 * agreements in one transaction.
 *
 * Goes through the `soft_delete_site` SECURITY DEFINER RPC (migration 050),
 * NOT a direct `.update()`: the sites SELECT policy's `USING (deleted_at IS
 * NULL)` (029) is enforced against the post-update row PostgREST returns,
 * so the very update that sets deleted_at is rejected with 42501 — the same
 * catch-22 documented for customers (032), jobs (038) and agreements (043).
 *
 * The cascade is deliberate and lives in the RPC, not here: every jobs read
 * in the app embeds `sites!inner`, so hiding the site already makes its jobs
 * unreachable — leaving them undeleted would just leave zombie `scheduled`
 * rows behind. Service sheets survive (the reports FK is on job_id and jobs
 * are never hard-deleted, so `list_report_documents` keeps showing them);
 * any invoice stands.
 *
 * The RPC RAISES if the site has an active or paused agreement — a live
 * contract is never taken out by a site delete. Callers surface that as a
 * blocked message.
 */
export async function deleteSite(siteId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_site", { p_id: siteId });

  if (error) {
    console.error("[deleteSite]", error.code, error.message);
    throw new Error(`Failed to delete site: ${error.message}`);
  }
}
