"use server";

import {
  ServiceSheetSchema,
  isServiceSheetFilled,
} from "@/lib/validation/service-sheet";
import {
  saveServiceSheet,
  finalizeServiceSheet,
  createBooking,
  getJobById,
  markReportEmailed,
  JobClashError,
} from "@/lib/data/jobs";
import { hasPendingEmailReportTask, createTask } from "@/lib/data/tasks";
import { todayUk } from "@/lib/utils/today-uk";
import { getSiteById } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { siteHasUsableAddress } from "@/lib/documents/resolve-sheet-address";
import { getReportByJobId, createReport } from "@/lib/data/reports";
import { generateJobReport } from "@/lib/pdf/generate-job-report";
import { uploadPdf } from "@/lib/storage/upload";
import { sendServiceReport } from "@/lib/services/email";
import { onJobCompleted } from "@/lib/services/job-events";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
  } catch {
    return [];
  }
}

// Structured "Products Used" rows arrive as a JSON string of objects (the form
// serialises its React rows). Parse to a raw array and let ProductUsedSchema
// (inside ServiceSheetSchema) validate/coerce each row's shape.
function parseJsonObjectArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Result of the save-draft step — note we return pdfUrl so the form can
// pop the approval modal with a live preview.
export interface SaveServiceSheetResult extends ActionState {
  pdfUrl?: string | null;
  jobId?: string;
  /** True when the combined path (finalize="true") completed the job. */
  finalized?: boolean;
  /** Best-effort side effects that were skipped (e.g. a follow-up or
   *  routine booking that clashed with an existing visit). The completion
   *  itself still succeeded; these name what did NOT happen and why. */
  warnings?: string[];
}

/**
 * Step 1 of two: save the Service Sheet data + generate the report PDF,
 * but leave the job in `in_progress` until the user approves it via the
 * follow-up modal.
 *
 * If the PDF generation fails (e.g. storage bucket missing) we still
 * return success with a null pdfUrl — the user can still approve, the
 * approval action will retry the PDF.
 *
 * Combined path (offline-pwa pass A): when FormData carries
 * finalize="true" (plus optional send_email / schedule_follow_up /
 * follow_up_date), the same invocation also runs the approval sequence
 * (finalizeServiceSheet + onJobCompleted + email + follow-up) via
 * {@link approveServiceSheetAction}. One action means ONE outbox entry,
 * so an offline completion replays save + side effects exactly once —
 * no compaction trap, no ordering dependency between two queued
 * entries. Without `finalize`, behaviour is unchanged.
 */
export async function completeServiceSheetAction(
  _prev: SaveServiceSheetResult,
  formData: FormData
): Promise<SaveServiceSheetResult> {
  await requireUser();
  const jobId = formData.get("job_id") as string;

  if (!jobId) {
    return { success: false, errors: {}, message: "Missing job ID" };
  }

  const existing = await getJobById(jobId);
  if (!existing) {
    return { success: false, errors: {}, message: "Job not found" };
  }

  const pestSpecies = parseJsonArray(formData.get("pest_species") as string | null);
  const methodUsed = parseJsonArray(formData.get("method_used") as string | null);
  const photoDataUrls = parseJsonArray(
    formData.get("photo_data_urls") as string | null
  );

  // Defensive: formData.get() returns null when a field is missing.
  // Casting to string is a TypeScript lie — at runtime the value is
  // still null, and Zod's `z.string().optional().default("")` rejects
  // null because optional() accepts undefined only, not null.
  //
  // This bit when Customer Present = No: the visible <input
  // name="client_name"> lives inside the `{clientPresent && ...}`
  // conditional in the form, so the field isn't in FormData at all.
  // formData.get("client_name") → null → Zod failure → action returns
  // { success: false, errors: { client_name: "Expected string..." } }
  // → outbox retries 4x → stuck in the conflict inbox.
  //
  // Fix: coerce null → "" for every field before Zod sees it.
  // Mirrors the same pattern from createCustomerAction (where the
  // domestic-customer save was silently failing for the same reason).
  const str = (key: string): string =>
    (formData.get(key) as string | null) ?? "";

  const raw = {
    job_id: jobId,
    call_type: str("call_type"),
    call_type_other_desc: str("call_type_other_desc"),
    pest_species: pestSpecies,
    findings: str("findings"),
    recommendations: str("recommendations"),
    report_notes: str("report_notes"),
    method_used: methodUsed,
    products_used: parseJsonObjectArray(
      formData.get("products_used") as string | null
    ),
    risk_level: str("risk_level"),
    risk_comments: str("risk_comments"),
    photo_data_urls: photoDataUrls,
    technician_signature: str("technician_signature"),
    client_present: str("client_present"),
    client_signature: str("client_signature"),
    client_name: str("client_name"),
    invoice_required: str("invoice_required"),
  };

  const result = ServiceSheetSchema.safeParse(raw);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  let updated;
  try {
    updated = await saveServiceSheet(jobId, result.data);
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error ? err.message : "Failed to save service sheet",
    };
  }

  // Generate PDF (best-effort). Failures here are non-fatal — the data is
  // already saved and the user can retry from the approval modal.
  let pdfUrl: string | null = null;
  try {
    const site = await getSiteById(updated.site_id);
    const customer = site ? await getCustomerById(site.customer_id) : null;
    if (site && customer) {
      const buf = await generateJobReport({ job: updated, site, customer });
      pdfUrl = await uploadPdf(buf, `reports/${jobId}/service-sheet.pdf`);
      // Update or create the reports row pointing at the latest PDF.
      const existingReport = await getReportByJobId(jobId);
      if (!existingReport || existingReport.pdf_url !== pdfUrl) {
        await createReport(jobId, pdfUrl);
      }
    }
  } catch (pdfErr) {
    console.error("[completeServiceSheetAction] PDF gen failed:", pdfErr);
  }

  // ─── Amend (L2): edit an already-completed sheet ────────────────────
  // The field save above already ran (writeServiceSheet's guarded
  // in_progress write no-ops on completed jobs, so job_status is
  // untouched) and the PDF block regenerated service-sheet.pdf in
  // place. NO finalize sequence — onJobCompleted's side effects fired
  // at the original completion and must stay single-fire. Email goes
  // out only on the explicit "Save & Email" choice (default off). It
  // runs LAST, so a failed-then-retried amend entry can't have sent
  // before the failure — replays don't double-send.
  if (str("amend") === "true") {
    if (str("send_email") === "true") {
      const site = await getSiteById(updated.site_id);
      const customer = site ? await getCustomerById(site.customer_id) : null;
      const report = await getReportByJobId(jobId);
      if (customer?.email && report?.pdf_url) {
        const sendRes = await sendServiceReport(
          customer,
          report.pdf_url,
          undefined,
          updated.job_date
        );
        // L3 truth: record only an ACTUAL send — never intent.
        if (sendRes.success) {
          await markReportEmailed(jobId, customer.email);
        }
      }
    }

    // No revalidatePath — the service-sheet form's applyLocal wrote the
    // amended fields to Dexie; the Dexie-live job detail/list re-render off
    // that. (approveServiceSheetAction keeps its own revalidate — Slice 4.)
    return {
      success: true,
      errors: {},
      message: null,
      pdfUrl,
      jobId,
      finalized: false,
    };
  }

  // ─── Optional in-action finalize (offline-pwa pass A) ──────────────
  let finalized = false;
  let warnings: string[] | undefined;
  if (str("finalize") === "true") {
    if (existing.job_status === "completed") {
      // Re-drain of an already-finalized completion (the outbox entry
      // is crash recovery and may replay after the first run landed).
      // Pass 0's guard protects job_status; skipping the sequence here
      // keeps the side effects single-fire — finalizeServiceSheet would
      // be harmless, but onJobCompleted's review task + report email,
      // the send_email dispatch, and the follow-up booking would all
      // repeat. `existing` was captured before saveServiceSheet, so
      // "completed" can only mean a previous invocation finished the
      // job — no legitimate flow re-submits a completed sheet (the UI
      // renders them view-only).
      finalized = true;
    } else {
      const approveRes = await approveServiceSheetAction(jobId, {
        sendEmail: str("send_email") === "true",
        scheduleFollowUp: str("schedule_follow_up") === "true",
        followUpDate: str("follow_up_date") || null,
        scheduleRoutine: str("schedule_routine") === "true",
        routineDate: str("routine_date") || null,
      });
      warnings = approveRes.warnings;
      if (!approveRes.success) {
        // Sheet data is saved; finalize failed. Returning failure keeps
        // the outbox entry alive — the retry re-runs save (idempotent,
        // Pass 0 guards status) and attempts finalize again.
        return {
          success: false,
          errors: {},
          message:
            approveRes.message ?? "Failed to finalise service sheet",
          pdfUrl,
          jobId,
        };
      }
      finalized = true;
    }
  }

  // No revalidatePath here. The job detail/list are Dexie-live and the form
  // navigates to the job detail on success. On the finalize path,
  // approveServiceSheetAction still revalidates /calendar + /dashboard for the
  // server-rendered surfaces its new follow-up/routine visits feed (Slice 4).
  return {
    success: true,
    errors: {},
    message: pdfUrl ? null : "Service sheet saved. PDF generation failed — bucket missing?",
    pdfUrl,
    jobId,
    finalized,
    warnings,
  };
}

// ─── Step 2 of two: approve (with or without email) ─────────────────────

export interface ApproveResult {
  success: boolean;
  message?: string;
  /** L3: set iff the report email actually sent (recorded on the job). */
  emailedTo?: string | null;
  /** Best-effort bookings that were skipped (clash or error), named. */
  warnings?: string[];
}

interface ApproveOptions {
  sendEmail?: boolean;
  scheduleFollowUp?: boolean;
  followUpDate?: string | null;
  scheduleRoutine?: boolean;
  routineDate?: string | null;
}

export async function approveServiceSheetAction(
  jobId: string,
  options: ApproveOptions = {}
): Promise<ApproveResult> {
  await requireUser();
  if (!jobId) return { success: false, message: "Missing job ID" };

  // L0 server invariant: a job can only become completed with a filled
  // sheet. This is THE choke point — every completion route funnels
  // through here (combined path validates via Zod first, but standalone
  // calls and replays of stale entries don't), so completed × unfilled
  // is unreachable no matter who calls. Same predicate as the client
  // gates — single source, Dexie-checkable offline.
  const job = await getJobById(jobId);
  if (!job) return { success: false, message: "Job not found" };
  if (!isServiceSheetFilled(job)) {
    return {
      success: false,
      message:
        "Service sheet not filled in — complete the sheet before finalising the job.",
    };
  }

  // L0 server invariant (site address): the sheet's site address must be
  // real — the SITE row itself must carry line 1 + town. The
  // customer-address fallback prefills the header for UX but CANNOT satisfy
  // completion, or a bare quick-add site would finalise with the customer's
  // address (or nothing) printed as the site where the work was done —
  // exactly the "sheet with no site address" Nate reported. Same pure rule
  // as the client gate. This is THE choke point, so an offline replay that
  // reaches the server without a site address is rejected here: the caller
  // (completeServiceSheetAction) returns failure, the outbox entry stays
  // alive and, after retries, lands in the conflicts inbox — identical
  // handling to a stale unfilled-sheet replay. Never silently completes.
  const guardSite = job.site_id ? await getSiteById(job.site_id) : null;
  if (!siteHasUsableAddress(guardSite)) {
    return {
      success: false,
      message:
        "This job's site has no address. Add the site address before completing the sheet.",
    };
  }

  let emailedTo: string | null = null;
  try {
    const updated = await finalizeServiceSheet(jobId);

    const site = await getSiteById(updated.site_id);
    const customer = site ? await getCustomerById(site.customer_id) : null;
    if (site) {
      // sendReportEmail: false — the operator's explicit sendEmail
      // choice below is the single owner of report dispatch. Without
      // this, onJobCompleted's auto-send double-emailed the customer
      // whenever a PDF existed (and emailed once even with the option
      // off). sendEmail: true ⇒ exactly one email; false ⇒ none.
      await onJobCompleted(
        updated,
        {
          customerId: site.customer_id,
          // site is non-null here (guarded); use its id rather than the
          // now-nullable job.site_id (draft jobs never reach completion).
          siteId: site.id,
        },
        { sendReportEmail: false }
      );
    }

    // ─── L3 email truthfulness ──────────────────────────────────────
    // Nothing here may fail the completion: sends return result
    // objects (never throw), and the task block is fenced — an offline
    // replay must not strand on email problems.
    if (options.sendEmail && customer?.email) {
      const report = await getReportByJobId(jobId);
      if (report?.pdf_url) {
        const sendRes = await sendServiceReport(
          customer,
          report.pdf_url,
          undefined,
          updated.job_date
        );
        if (sendRes.success) {
          await markReportEmailed(jobId, customer.email);
          emailedTo = customer.email;
        }
      }
    }

    // No address on file → the report can't be emailed at all. Surface
    // it in the operator's task queue instead of vanishing silently —
    // exactly once per job (title-prefix dedupe; the booking flow's
    // generic follow_up task is unrelated).
    if (customer && !customer.email) {
      try {
        if (!(await hasPendingEmailReportTask(jobId))) {
          await createTask({
            title: `Email service report to ${customer.name} — no email address on file`,
            due_date: todayUk(),
            task_type: "follow_up",
            priority: "medium",
            related_job_id: jobId,
            related_customer_id: customer.id,
            site_id: updated.site_id,
          });
        }
      } catch (taskErr) {
        console.error(
          "[approveServiceSheetAction] no-address task failed:",
          taskErr
        );
      }
    }

    // Post-completion bookings — best-effort, NEVER fail the completion.
    // A clash (same site + date + visit type already booked) or any other
    // booking error is collected as a named warning instead of the old
    // silent console swallow, so the operator learns what did not happen.
    const warnings: string[] = [];
    const bookVisit = async (
      label: string,
      jobDate: string,
      callType: "followup" | "routine",
      parentJobId: string
    ) => {
      try {
        await createBooking({
          site_id: site!.id,
          job_date: jobDate,
          // No time/window inherited — the operator can edit the booking
          // afterwards to add one.
          job_time: "",
          job_time_end: "",
          call_type: callType,
          // Follow-up/routine bookings are never "other", so no description.
          call_type_other_desc: "",
          pest_species: updated.pest_species ?? [],
          report_notes: "",
          parent_job_id: parentJobId,
        });
      } catch (err) {
        console.error(`[approveServiceSheetAction] ${label} booking:`, err);
        warnings.push(
          err instanceof JobClashError
            ? `${label} on ${jobDate} was not booked: this site already has a ${
                callType === "routine" ? "routine" : "follow-up"
              } visit that day.`
            : `${label} on ${jobDate} could not be booked.`
        );
      }
    };

    if (options.scheduleFollowUp && options.followUpDate && site) {
      // Chained to the completed job (parent_job_id → <parent-ref>-N).
      await bookVisit(
        "Follow-up visit",
        options.followUpDate,
        "followup",
        updated.id
      );
    }
    if (options.scheduleRoutine && options.routineDate && site) {
      // A fresh top-level visit, NOT chained: a routine isn't remedial,
      // so it gets its own reference (no parent_job_id).
      await bookVisit("Routine visit", options.routineDate, "routine", "");
    }

    // No revalidatePath. The follow-up/routine visits this action creates are
    // server-only (createBooking mints its own ids), but they reach the
    // Dexie-live jobs list via the PULL half of the same sync run that
    // replayed this completion (runSync = drain-then-pull), so useLiveQuery
    // surfaces them there automatically; the server-rendered calendar/dashboard
    // refetch them on forward navigation (pages aren't cached). A revalidatePath
    // here purged the whole client router cache and stampeded a re-prefetch of
    // every link on every completion — for freshness the pull + forward-nav
    // already provide. (The completed job's own status is in Dexie via the
    // form's applyLocal.)
    return {
      success: true,
      emailedTo,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "Failed to finalise service sheet",
    };
  }
}
