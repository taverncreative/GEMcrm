import { createClient } from "@/lib/supabase/server";
import { todayUk, dateUkOffset } from "@/lib/utils/today-uk";
import { newId } from "@/lib/utils/id";
import type { Job, Site, Customer, JobStatus } from "@/types/database";
import type { BookingCreateInput } from "@/lib/validation/booking";
import type { ServiceSheetInput } from "@/lib/validation/service-sheet";
import { uploadBase64Image } from "@/lib/storage/upload";
import {
  isPhotoClientId,
  photoStoragePath,
  PHOTO_BUCKET,
} from "@/lib/photos/path";
import { generateJobReference } from "@/lib/data/job-references";
import { callTypeOtherDescForStorage } from "@/lib/utils/call-type-other";
import { environmentalCommentsForStorage } from "@/lib/utils/environmental-comments";
import { storageObjectPath } from "@/lib/storage/asset-url";
import {
  LEGACY_AMEND_FIELDS,
  type SheetField,
} from "@/lib/data/sheet-fields";

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
    .is("deleted_at", null)
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
    .is("deleted_at", null)
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
    .is("deleted_at", null)
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
  // Overdue visits stay on the list until they're done. The lower bound is
  // 90 days back (not all-time) so genuinely abandoned old bookings don't
  // dredge up, while a missed visit from last week stays visible and red.
  // The list is now "things still on my plate": every scheduled/in_progress
  // job from 90 days ago onwards, most-overdue first (ascending date). A
  // finished job (completed) or an archived/deleted one never appears.
  const floor = dateUkOffset(-90);

  const { data, error } = await supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .is("deleted_at", null)
    .gte("job_date", floor)
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
    .is("deleted_at", null)
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
    .is("deleted_at", null)
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
    .is("deleted_at", null)
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
 * Soft-delete a job — sets `deleted_at = now()`. The job row + its
 * dependents (generated report, follow-up children, any legacy invoice) are
 * LEFT in place — soft delete doesn't cascade — but the job stops surfacing
 * everywhere the reads filter `deleted_at IS NULL` (the server reads above +
 * the Dexie reads).
 *
 * Goes through the soft_delete_job SECURITY DEFINER RPC (migration 038),
 * NOT a direct `.update()`: the jobs SELECT policy's `USING (deleted_at IS
 * NULL)` (migration 029) is enforced against the post-update row PostgREST
 * returns, so the very update that sets deleted_at is rejected with 42501
 * "new row violates row-level security policy for table jobs" for every
 * authenticated user — the same gap migration 032 fixed for customers (the
 * UPDATE policy is already `using(true) / with check(true)`, so it is NOT
 * the gate). The RPC is the narrowest bypass — read policies stay
 * untouched, deleted rows stay hidden.
 */
export async function deleteJob(jobId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_job", { p_id: jobId });
  if (error) {
    console.error("[deleteJob]", error.code, error.message);
    throw new Error(`Failed to delete job: ${error.message}`);
  }
}

/**
 * What a job delete leaves behind, for the confirm dialog: follow-up child
 * jobs keep their parent link, and a completed job's service sheet survives.
 * Any legacy invoice link also stands (soft-deleting a job never touches it)
 * but is no longer surfaced — the invoice UI is hidden as of slice 2b.
 */
export interface JobDeleteImpact {
  /** Count of still-live follow-up jobs whose parent is this job. */
  followUps: number;
  /**
   * The job is COMPLETED and has a generated service sheet — i.e. a signed
   * record of work performed. Deleting it is still ALLOWED (John's call),
   * but the dialog raises an extra warning so it can't happen by reflex.
   *
   * The sheet SURVIVES the delete: soft-deleting a job never cascades, and
   * `list_report_documents` (049) deliberately keeps an orphaned sheet
   * visible with all its detail. It has to be removed separately from
   * Documents — which the warning copy says outright.
   */
  completedWithServiceSheet: boolean;
  /** The sheet carries a client signature — sharpens the warning copy from
   *  "record of work" to "signed record of work". */
  clientSigned: boolean;
}

export async function getJobDeleteImpact(
  jobId: string
): Promise<JobDeleteImpact> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("parent_job_id", jobId)
    .is("deleted_at", null);

  // Signed-service-sheet check for the extra warning. "Has a sheet" means a
  // LIVE report row with a generated PDF — a sheet already deleted from
  // Documents shouldn't re-warn. The job must also be completed: a sheet on
  // a non-completed job isn't a finished record of work.
  const { data: job } = await supabase
    .from("jobs")
    .select("job_status, client_signature_url")
    .eq("id", jobId)
    .maybeSingle();

  const { count: reportCount } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .not("pdf_url", "is", null)
    .is("deleted_at", null);

  const completedWithServiceSheet =
    job?.job_status === "completed" && (reportCount ?? 0) > 0;

  return {
    followUps: count ?? 0,
    completedWithServiceSheet,
    clientSigned: Boolean(job?.client_signature_url),
  };
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

/**
 * Reschedule a job — change its date and time window only. A plain
 * last-write-wins field update (v1, single operator).
 *
 * Guarded with `neq('job_status', 'completed')` so a completed job is
 * never moved (mirrors {@link updateJobStatus}'s no-downgrade guard): a
 * stale offline reschedule replaying after the job completed matches zero
 * rows and no-ops instead of dragging a finished visit onto a new date.
 *
 * A move onto a slot already taken by the same site + call type raises the
 * partial-unique index (23505) → JobClashError, the same server-side
 * backstop `createBooking` relies on (the client runs findClashingJobLocal
 * first, so this is only the rare offline-race path). Not a self-hiding
 * write, so — unlike a soft-delete — the RETURNING row still passes the
 * read policy; no 42501.
 */
export async function rescheduleJob(
  jobId: string,
  input: { job_date: string; job_time: string; job_time_end: string }
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({
      job_date: input.job_date,
      job_time: emptyToNull(input.job_time),
      job_time_end: emptyToNull(input.job_time_end),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .neq("job_status", "completed");

  if (error) {
    if (error.code === "23505") {
      throw new JobClashError(
        "A booking of this call type already exists for this site on this date."
      );
    }
    console.error("[rescheduleJob]", error.code, error.message);
    throw new Error(`Failed to reschedule job: ${error.message}`);
  }
}

/**
 * Set the "Invoices required" checklist flag on a job (migration 041).
 * A plain field update — flagged from the job-detail toggle or ticked off
 * from the homepage checklist. Last-write-wins (single operator); not a
 * self-hiding write, so no 42501 concern.
 */
export async function setJobNeedsInvoice(
  jobId: string,
  needsInvoice: boolean
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({ needs_invoice: needsInvoice, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (error) {
    console.error("[setJobNeedsInvoice]", error.code, error.message);
    throw new Error(`Failed to update invoice flag: ${error.message}`);
  }
}

/**
 * Jobs flagged as "needs invoicing" (migration 041) — the homepage
 * "Invoices required" checklist. Non-archived, non-deleted; newest first.
 */
export async function getJobsNeedingInvoice(
  limit: number = 50
): Promise<JobWithContext[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .eq("needs_invoice", true)
    .eq("is_archived", false)
    .order("job_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[getJobsNeedingInvoice]", error.code, error.message);
    return [];
  }

  return (data ?? []) as unknown as JobWithContext[];
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
  // Accepts the lenient create input (call_type may be ""); the strict
  // BookingInput from other callers is assignable to it.
  input: BookingCreateInput,
  // `jobStatus` lets the service-sheet-from-scratch flow start the job as
  // "in_progress" (being worked on) instead of the default "scheduled".
  opts?: { id?: string; jobStatus?: "scheduled" | "in_progress" }
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
        // "" (quick add, no call type chosen) → null (the column's CHECK
        // allows null but rejects ""). Valid enum values pass through.
        call_type: input.call_type || null,
        // Only carried when the type is "other"; any stale description is
        // dropped to null otherwise, so it can never linger past a type change.
        call_type_other_desc: callTypeOtherDescForStorage(
          input.call_type,
          input.call_type_other_desc
        ),
        pest_species: input.pest_species,
        value: input.value ?? null,
        report_notes: emptyToNull(input.report_notes),
        job_status: opts?.jobStatus ?? "scheduled",
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
  input: ServiceSheetInput,
  opts: WriteSheetOptions = {}
): Promise<Job> {
  return writeServiceSheet(jobId, input, "in_progress", opts);
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
 * post-completion side-effects (review task, etc.)
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
 * Which columns a save is allowed to write.
 *
 * Only consulted on the AMEND path. A fresh fill starts from a blank job
 * and stays authoritative for the whole sheet, exactly as before.
 */
export interface WriteSheetOptions {
  /** True when editing an already-completed sheet. */
  amend?: boolean;
  /** Columns this submission actually loaded, so may overwrite. */
  fields?: readonly SheetField[];
}

/**
 * Internal writer — does the uploads + DB update in one transaction.
 */
async function writeServiceSheet(
  jobId: string,
  input: ServiceSheetInput,
  newStatus: JobStatus,
  opts: WriteSheetOptions = {}
): Promise<Job> {
  // On an amend, the submission only speaks for the columns it declares
  // (see lib/data/sheet-fields.ts). Everything else is left OUT of the
  // UPDATE, so it cannot change. A fill starts from a blank job, so it
  // stays authoritative for everything exactly as before.
  const authoritative: ReadonlySet<SheetField> | null = opts.amend
    ? new Set(
        opts.fields && opts.fields.length > 0
          ? opts.fields
          : LEGACY_AMEND_FIELDS
      )
    : null;
  const owns = (field: SheetField): boolean =>
    authoritative === null || authoritative.has(field);

  let techSigUrl: string | null = null;
  let clientSigUrl: string | null = null;

  // Only upload when this submission actually speaks for the signature.
  // A declared-but-empty value is a deliberate clear and writes null; an
  // UNdeclared signature never reaches the update object at all, which is
  // what keeps a failed signature fetch (offline, storage down) from
  // destroying the stored URL.
  if (
    owns("technician_signature_url") &&
    input.technician_signature?.startsWith("data:image")
  ) {
    techSigUrl = await uploadBase64Image(
      input.technician_signature,
      `signatures/${jobId}/technician.png`
    );
  }

  if (
    owns("client_signature_url") &&
    input.client_signature?.startsWith("data:image")
  ) {
    clientSigUrl = await uploadBase64Image(
      input.client_signature,
      `signatures/${jobId}/client.png`
    );
  }

  // Photos arrive here in one of three shapes:
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
  //   3. **An already-stored reports-bucket reference** — a photo the
  //      sheet already had, handed back by an AMEND. The blob is long
  //      gone from photos_pending by then, so the form carries the
  //      stored reference instead. We re-derive the URL from the object
  //      path rather than echoing the incoming string, so what lands in
  //      the column is always OUR bucket's canonical URL and an
  //      untouched photo round-trips byte-identical. This is what lets
  //      an amend REMOVE a photo (it drops out of the list) without
  //      being able to lose the ones it kept.
  //
  // Anything else is an error — silent fallthrough on unknown formats
  // would be a future-regression magnet (a malformed pull, a future
  // schema change). Reject loudly.
  const supabase = await createClient();
  const photoUrls: string[] = [];
  // Skipped entirely when this submission doesn't speak for the photos —
  // no uploads, no URL building, and the column stays out of the UPDATE.
  if (owns("photo_urls") && input.photo_data_urls.length > 0) {
    for (let idx = 0; idx < input.photo_data_urls.length; idx++) {
      const ref = input.photo_data_urls[idx];
      if (isPhotoClientId(ref)) {
        // Path 1: photos loop already uploaded. URL-build deterministically.
        const { data: urlData } = supabase.storage
          .from(PHOTO_BUCKET)
          .getPublicUrl(photoStoragePath(ref));
        photoUrls.push(urlData.publicUrl);
      } else if (storageObjectPath(ref)?.startsWith("photos/")) {
        // Path 3: a photo the sheet already had, returned by an amend.
        const { data: urlData } = supabase.storage
          .from(PHOTO_BUCKET)
          .getPublicUrl(storageObjectPath(ref)!);
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

  // Built per column so an UNOWNED one is absent from the statement
  // entirely. A column that isn't in the UPDATE cannot change — that is
  // the structural guarantee, rather than trusting a value comparison.
  const patch: Record<string, unknown> = {};
  const set = (field: SheetField, value: unknown) => {
    if (owns(field)) patch[field] = value;
  };

  set("call_type", input.call_type);
  // Cleared to null unless the type is "other", so a description never
  // lingers after the operator switches the call type on Step 1.
  set(
    "call_type_other_desc",
    callTypeOtherDescForStorage(input.call_type, input.call_type_other_desc)
  );
  set("pest_species", input.pest_species);
  set("findings", emptyToNull(input.findings));
  set("recommendations", emptyToNull(input.recommendations));
  set("method_used", input.method_used);
  // `treatment` is the legacy free-text mirror of method_used and always
  // travels with it, so it has no manifest key of its own.
  if (owns("method_used")) patch.treatment = input.method_used.join(", ");
  // Structured products (migration 047). Replaces the free-text
  // pesticides_used, which is now legacy/read-only — we no longer write it,
  // so old sheets keep their original free text and new sheets carry only
  // structured rows (empty [] is valid — a survey visit).
  set("products_used", input.products_used);
  set("risk_level", input.risk_level);
  set("risk_comments", emptyToNull(input.risk_comments));
  // ERA free text. Null unless the operator ticked the box, so abandoned
  // text never reaches the row (and so never reaches a customer PDF).
  set(
    "environmental_comments",
    environmentalCommentsForStorage(
      input.era_required,
      input.environmental_comments
    )
  );
  set("report_notes", emptyToNull(input.report_notes));
  set("photo_urls", photoUrls);
  set("client_present", input.client_present);
  set("client_name", emptyToNull(input.client_name));
  set("needs_invoice", input.invoice_required);
  set("technician_signature_url", techSigUrl);
  set("client_signature_url", clientSigUrl);
  // in_progress went through the guarded write above; only
  // non-downgrading statuses are written unconditionally.
  if (newStatus !== "in_progress") patch.job_status = newStatus;

  const { data, error } = await supabase
    .from("jobs")
    .update(patch)
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
    .is("deleted_at", null)
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
