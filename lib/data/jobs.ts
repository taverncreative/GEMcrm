import { createClient } from "@/lib/supabase/server";
import { todayUk } from "@/lib/utils/today-uk";
import { newId } from "@/lib/utils/id";
import type { Job, Site, Customer, JobStatus } from "@/types/database";
import type { BookingInput } from "@/lib/validation/booking";
import type { ServiceSheetInput } from "@/lib/validation/service-sheet";
import { uploadBase64Image } from "@/lib/storage/upload";
import {
  isPhotoClientId,
  photoStoragePath,
  PHOTO_BUCKET,
} from "@/lib/photos/path";
import { generateJobReference } from "@/lib/data/job-references";

function emptyToNull(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

export interface JobWithContext extends Job {
  site: Site & { customer: Customer };
}

interface GetAllJobsOptions {
  filter?: "today" | "upcoming" | "all";
  callType?: string;
  /** Status tab filter — "all" (default) or one of the status enum values. */
  status?: "all" | "scheduled" | "in_progress" | "completed";
  search?: string;
}

export async function getAllJobs(
  options: GetAllJobsOptions = {}
): Promise<JobWithContext[]> {
  const { filter = "all", callType, status = "all", search } = options;
  const supabase = await createClient();
  const today = todayUk();

  // When searching, find matching site IDs first at DB level
  let siteIds: string[] | null = null;
  if (search) {
    const pattern = `%${search}%`;

    // Find sites matching address
    const { data: matchingSites } = await supabase
      .from("sites")
      .select("id")
      .or(`address_line_1.ilike.${pattern},postcode.ilike.${pattern}`);

    // Find customers matching name/company, then their sites
    const { data: matchingCustomers } = await supabase
      .from("customers")
      .select("id")
      .or(`name.ilike.${pattern},company_name.ilike.${pattern}`);

    const customerIds = (matchingCustomers ?? []).map((c) => c.id);
    let customerSiteIds: string[] = [];
    if (customerIds.length > 0) {
      const { data: customerSites } = await supabase
        .from("sites")
        .select("id")
        .in("customer_id", customerIds);
      customerSiteIds = (customerSites ?? []).map((s) => s.id);
    }

    siteIds = [
      ...(matchingSites ?? []).map((s) => s.id),
      ...customerSiteIds,
    ];
    // Deduplicate
    siteIds = [...new Set(siteIds)];

    if (siteIds.length === 0) {
      return [];
    }
  }

  let query = supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .order("job_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (filter === "today") {
    query = query.eq("job_date", today);
  } else if (filter === "upcoming") {
    query = query.gte("job_date", today);
  }

  if (callType) {
    query = query.eq("call_type", callType);
  }

  if (status !== "all") {
    query = query.eq("job_status", status);
  }

  if (siteIds) {
    query = query.in("site_id", siteIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[getAllJobs]", error.code, error.message);
    throw new Error(`Failed to fetch jobs: ${error.message}`);
  }

  return (data ?? []) as unknown as JobWithContext[];
}

export async function getOverdueJobs(
  limit: number = 10
): Promise<JobWithContext[]> {
  const supabase = await createClient();
  const today = todayUk();

  const { data, error } = await supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .lt("job_date", today)
    .in("job_status", ["scheduled", "in_progress"])
    .order("job_date", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[getOverdueJobs]", error.code, error.message);
    throw new Error(`Failed to fetch overdue jobs: ${error.message}`);
  }

  return (data ?? []) as unknown as JobWithContext[];
}

export async function getJobsToday(
  limit: number = 20
): Promise<JobWithContext[]> {
  const supabase = await createClient();
  const today = todayUk();

  const { data, error } = await supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .eq("job_date", today)
    .in("job_status", ["scheduled", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[getJobsToday]", error.code, error.message);
    throw new Error(`Failed to fetch today's jobs: ${error.message}`);
  }

  return (data ?? []) as unknown as JobWithContext[];
}

export async function getUpcomingJobs(
  limit: number = 5
): Promise<JobWithContext[]> {
  const supabase = await createClient();
  const today = todayUk();

  // "Upcoming" = anything from today onwards that hasn't been finished yet.
  // Previously this used `.gt("job_date", today)` which skipped today's
  // bookings AND made no status filter, so a completed job still appeared
  // and a fresh booking for today/tomorrow didn't. Users expect this to
  // mean "things still on my plate from now on".
  const { data, error } = await supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .gte("job_date", today)
    .in("job_status", ["scheduled", "in_progress"])
    .eq("is_archived", false)
    .order("job_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[getUpcomingJobs]", error.code, error.message);
    throw new Error(`Failed to fetch upcoming jobs: ${error.message}`);
  }

  return (data ?? []) as unknown as JobWithContext[];
}

export async function getRecentJobs(
  limit: number = 5
): Promise<JobWithContext[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[getRecentJobs]", error.code, error.message);
    throw new Error(`Failed to fetch recent jobs: ${error.message}`);
  }

  return (data ?? []) as unknown as JobWithContext[];
}

export async function getJobsBySite(siteId: string): Promise<Job[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("site_id", siteId)
    .order("job_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getJobsBySite]", error.code, error.message);
    throw new Error(`Failed to fetch jobs: ${error.message}`);
  }

  return data;
}

export async function getJobById(id: string): Promise<Job | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("[getJobById]", error.code, error.message);
    throw new Error(`Failed to fetch job: ${error.message}`);
  }

  return data;
}

/**
 * L1: the only status transition left outside the service-sheet flow is
 * → in_progress (Start). The `neq` makes the no-downgrade rule atomic
 * server-side (same shape as writeServiceSheet's Pass-0 guard): a stale
 * offline "Start" replay that drains AFTER the job completed matches
 * zero rows and no-ops instead of regressing a completed job.
 */
export async function updateJobStatus(
  jobId: string,
  status: JobStatus
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({ job_status: status })
    .eq("id", jobId)
    .neq("job_status", "completed");

  if (error) {
    console.error("[updateJobStatus]", error.code, error.message);
    throw new Error(`Failed to update job status: ${error.message}`);
  }
}

export async function hasJobForSiteOnDate(
  siteId: string,
  jobDate: string,
  callType: string
): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("job_date", jobDate)
    .eq("call_type", callType)
    .eq("is_archived", false);

  if (error) {
    console.error("[hasJobForSiteOnDate]", error.code, error.message);
    return false;
  }

  return (count ?? 0) > 0;
}

export class JobClashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobClashError";
  }
}

/**
 * Create a BOOKING — minimal data, status=scheduled, no uploads.
 * This is the "phone call" pipeline: customer rings, we jot down date +
 * call type, move on. Service Sheet gets filled later via
 * {@link completeServiceSheet}.
 */
export async function createBooking(
  input: BookingInput,
  opts?: { id?: string }
): Promise<Job> {
  const supabase = await createClient();

  // We need the customer's type + company_name to compute the reference.
  // Get them via the site → customer chain in a single embedded select.
  const { data: siteRow, error: siteErr } = await supabase
    .from("sites")
    .select("customer:customers!inner(customer_type, company_name, name)")
    .eq("id", input.site_id)
    .single();
  if (siteErr || !siteRow) {
    throw new Error("Site not found for booking");
  }
  const customer = (siteRow as unknown as {
    customer: Pick<Customer, "customer_type" | "company_name" | "name">;
  }).customer;

  const parentJobId = input.parent_job_id?.trim() || null;
  const referenceNumber = await generateJobReference({
    customer,
    parentJobId,
  });

  // `opts.id` is supplied by the offline-first path: applyLocal already
  // wrote the job to Dexie with this client UUID, and the outbox replay
  // passes the same id so the server row matches — no remapping. Plain
  // online callers omit it and get a fresh server-side UUID.
  //
  // upsert(onConflict:"id") makes a replay RE-run idempotent on a lost
  // response (the entry didn't get deleted, retries, the row already
  // exists → DO UPDATE rewrites the same payload rather than 23505-ing
  // a false conflict). Critically, ON CONFLICT (id) only handles the
  // PK; a violation of the partial-unique index
  // idx_jobs_site_date_unique still raises 23505 → JobClashError, which
  // is the REAL conflict we want surfaced. (Edge: a true re-run
  // recomputes reference_number; harmless — still valid, and only
  // happens on the rare lost-ack retry.)
  const { data, error } = await supabase
    .from("jobs")
    .upsert(
      {
        id: opts?.id ?? newId(),
        site_id: input.site_id,
        job_date: input.job_date,
        job_time: emptyToNull(input.job_time),
        job_time_end: emptyToNull(input.job_time_end),
        call_type: input.call_type,
        pest_species: input.pest_species,
        value: input.value ?? null,
        report_notes: emptyToNull(input.report_notes),
        job_status: "scheduled",
        reference_number: referenceNumber,
        parent_job_id: parentJobId,
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new JobClashError(
        "A booking of this call type already exists for this site on this date."
      );
    }
    console.error("[createBooking]", error.code, error.message);
    throw new Error(`Failed to create booking: ${error.message}`);
  }

  return data;
}

export interface DraftJobInput {
  /** The captured phrase, e.g. "Sarah, Wasps, Folkestone". */
  capture_note: string;
  job_date: string;
  /** Arrival-window start / end (Q1 picker). Empty string = unset. */
  job_time?: string;
  job_time_end?: string;
}

/**
 * Create a DRAFT job from quick capture (Q2): a phrase + date + arrival
 * window, with NO customer/site/details. `job_status='draft'` lets the
 * row carry a null site_id (DB CHECK), keeps it out of every active
 * surface (each status filter enumerates only the statuses it wants),
 * and out of the completion/invoice gates (drafts aren't fillable). No
 * reference_number — that needs a customer and is generated at upgrade
 * (Q3).
 *
 * `opts.id` is the offline-first client UUID: applyLocal already wrote
 * the draft to Dexie with this id, and the outbox replay passes it so
 * server == local. upsert(onConflict:"id") makes a lost-ack replay
 * idempotent. There is no partial-unique clash to fear — that index is
 * scoped to non-null site_id rows.
 */
export async function createDraftJob(
  input: DraftJobInput,
  opts?: { id?: string }
): Promise<Job> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .upsert(
      {
        id: opts?.id ?? newId(),
        site_id: null,
        job_status: "draft" as JobStatus,
        capture_note: emptyToNull(input.capture_note),
        job_date: input.job_date,
        job_time: emptyToNull(input.job_time),
        job_time_end: emptyToNull(input.job_time_end),
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[createDraftJob]", error.code, error.message);
    throw new Error(`Failed to capture draft job: ${error.message}`);
  }

  return data;
}

/**
 * Save Service Sheet data + uploads but DON'T finalise.
 * Returns the updated job (status moves to in_progress so the user can see
 * it's mid-flow). The approval step calls {@link finalizeServiceSheet}
 * once the user has reviewed the generated PDF.
 *
 * Same body as the old completeServiceSheet — we just don't flip status
 * to completed here.
 */
export async function saveServiceSheet(
  jobId: string,
  input: ServiceSheetInput
): Promise<Job> {
  return writeServiceSheet(jobId, input, "in_progress");
}

/**
 * Legacy alias retained for any existing callers. Marks complete immediately,
 * skipping the approval step.
 */
export async function completeServiceSheet(
  jobId: string,
  input: ServiceSheetInput
): Promise<Job> {
  return writeServiceSheet(jobId, input, "completed");
}

/**
 * L3 email truth: record that the job's report email actually SENT.
 * Called only after a successful sendServiceReport — never on intent.
 * The view-only sheet renders "Report emailed to …" from these columns
 * and "Send report now" single-fires by checking them first.
 */
export async function markReportEmailed(
  jobId: string,
  email: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({
      report_emailed_to: email,
      report_emailed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) {
    // Best-effort: the email DID send — a failed mark must not fail the
    // completion. Log and move on; "Send report now" stays visible and
    // its pre-send check makes a re-send an explicit operator choice.
    console.error("[markReportEmailed]", error.code, error.message);
  }
}

/**
 * Move a saved Service Sheet from in_progress → completed. Runs the
 * post-completion side-effects (review task, invoice auto-create, etc.)
 * are still wired up by the action layer.
 */
export async function finalizeServiceSheet(jobId: string): Promise<Job> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .update({ job_status: "completed" as JobStatus })
    .eq("id", jobId)
    .select()
    .single();
  if (error) {
    console.error("[finalizeServiceSheet]", error.code, error.message);
    throw new Error(`Failed to finalise service sheet: ${error.message}`);
  }
  return data;
}

/**
 * Internal writer — does the uploads + DB update in one transaction.
 */
async function writeServiceSheet(
  jobId: string,
  input: ServiceSheetInput,
  newStatus: JobStatus
): Promise<Job> {
  let techSigUrl: string | null = null;
  let clientSigUrl: string | null = null;

  if (input.technician_signature?.startsWith("data:image")) {
    techSigUrl = await uploadBase64Image(
      input.technician_signature,
      `signatures/${jobId}/technician.png`
    );
  }

  if (input.client_signature?.startsWith("data:image")) {
    clientSigUrl = await uploadBase64Image(
      input.client_signature,
      `signatures/${jobId}/client.png`
    );
  }

  // Photos arrive here in one of two shapes:
  //
  //   1. **Client photo id (UUID)** — the offline-sync path. The
  //      photos loop already uploaded the blob to
  //      `photos/<id>.jpg` via /api/photos/upload. We just compute
  //      the public URL — no re-upload, no work to do here.
  //
  //   2. **`data:image/...` base64 data URL** — the online
  //      direct-submit path (form action invoked while online, no
  //      photos loop involved). Upload via the existing helper.
  //
  // Anything else is an error — silent fallthrough on unknown formats
  // would be a future-regression magnet (a malformed pull, a future
  // schema change). Reject loudly.
  const supabase = await createClient();
  const photoUrls: string[] = [];
  if (input.photo_data_urls.length > 0) {
    for (let idx = 0; idx < input.photo_data_urls.length; idx++) {
      const ref = input.photo_data_urls[idx];
      if (isPhotoClientId(ref)) {
        // Path 1: photos loop already uploaded. URL-build deterministically.
        const { data: urlData } = supabase.storage
          .from(PHOTO_BUCKET)
          .getPublicUrl(photoStoragePath(ref));
        photoUrls.push(urlData.publicUrl);
      } else if (ref.startsWith("data:image")) {
        // Path 2: online direct submit. Upload the legacy way.
        const ext = ref.match(/data:image\/(\w+);/)?.[1] ?? "png";
        const url = await uploadBase64Image(
          ref,
          `photos/${jobId}/${idx}.${ext}`
        );
        photoUrls.push(url);
      } else {
        throw new Error(
          `writeServiceSheet: unknown photo reference format at index ${idx}` +
            ` (expected UUID or data:image/* prefix, got: "${ref.slice(0, 40)}")`
        );
      }
    }
  }

  // Status guard (offline-pwa pass 0): drainOutbox replays
  // completeServiceSheetAction even after the approval step has moved
  // the job to completed — the submit-time outbox entry is deliberately
  // left queued as crash recovery, and the engine clears entries BY
  // replaying them. An unconditional `job_status: "in_progress"` here
  // regressed completed jobs back to in_progress on the next drain
  // (30s tick / focus / any runSync). Guard: in_progress is written via
  // a separate conditional UPDATE whose `neq` filter makes the
  // no-downgrade rule atomic server-side (no fetch-then-write race).
  // Other statuses ("completed" via the legacy completeServiceSheet
  // alias) still write through the main update — upgrades are fine.
  if (newStatus === "in_progress") {
    const { error: statusErr } = await supabase
      .from("jobs")
      .update({ job_status: "in_progress" as JobStatus })
      .eq("id", jobId)
      .neq("job_status", "completed");
    if (statusErr) {
      console.error(
        "[writeServiceSheet] status:",
        statusErr.code,
        statusErr.message
      );
      throw new Error(`Failed to save service sheet: ${statusErr.message}`);
    }
  }

  const { data, error } = await supabase
    .from("jobs")
    .update({
      call_type: input.call_type,
      pest_species: input.pest_species,
      findings: emptyToNull(input.findings),
      recommendations: emptyToNull(input.recommendations),
      treatment: input.method_used.join(", "),
      method_used: input.method_used,
      pesticides_used: emptyToNull(input.pesticides_used),
      risk_level: input.risk_level,
      risk_comments: emptyToNull(input.risk_comments),
      report_notes: emptyToNull(input.report_notes),
      photo_urls: photoUrls,
      client_present: input.client_present,
      client_name: emptyToNull(input.client_name),
      technician_signature_url: techSigUrl,
      client_signature_url: clientSigUrl,
      // in_progress went through the guarded write above; only
      // non-downgrading statuses are written unconditionally.
      ...(newStatus !== "in_progress" ? { job_status: newStatus } : {}),
    })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    console.error("[writeServiceSheet]", error.code, error.message);
    throw new Error(`Failed to save service sheet: ${error.message}`);
  }

  return data;
}

/**
 * Bookings that are past their scheduled date AND have no completed
 * service sheet (still scheduled or in_progress). These are the rows the
 * user sees on the dashboard as "service sheets to fill".
 */
export async function getBookingsMissingServiceSheet(
  limit: number = 20
): Promise<JobWithContext[]> {
  const supabase = await createClient();
  const today = todayUk();

  const { data, error } = await supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .lte("job_date", today)
    .in("job_status", ["scheduled", "in_progress"])
    .eq("is_archived", false)
    .order("job_date", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[getBookingsMissingServiceSheet]", error.code, error.message);
    return [];
  }

  return (data ?? []) as unknown as JobWithContext[];
}

/**
 * Count non-archived, non-agreement jobs on a given site + date. Used by the
 * action layer to warn the user *before* they submit.
 */
export async function countJobsOnDate(
  siteId: string,
  jobDate: string
): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId)
    .eq("job_date", jobDate)
    .eq("is_archived", false);

  if (error) {
    console.error("[countJobsOnDate]", error.code, error.message);
    return 0;
  }
  return count ?? 0;
}

export async function getLastJobForSite(siteId: string): Promise<Job | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("site_id", siteId)
    .eq("is_archived", false)
    .eq("job_status", "completed")
    .order("job_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[getLastJobForSite]", error.code, error.message);
    return null;
  }

  return data;
}
