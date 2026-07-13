"use client";

/**
 * Service-sheet draft persistence.
 *
 * The operator fills a multi-step service sheet over many minutes. If
 * their phone runs low on memory, they background the app, take a call,
 * or simply reload the page, every useState field would otherwise reset
 * to its defaults — a real field-loss risk.
 *
 * This module persists every field of the form into IndexedDB on every
 * change (debounced in the form's useEffect). On the next mount, the
 * form's outer wrapper reads the draft and uses its values as
 * useState initial values, so the form re-mounts with everything the
 * operator had typed.
 *
 * Lifecycle:
 *   - Operator edits any field          → debounced 500ms → saveDraft()
 *   - Operator approves successfully    → clearDraft()
 *   - Operator reloads / re-enters      → loadDraft() returns the saved
 *                                         state; form rehydrates
 *
 * Key: jobId. One draft per job (server-side completion uniqueness
 * matches). If two browser tabs are open on the same job, last-write
 * wins on the draft.
 *
 * On user-change wipe (SyncBoot), the drafts table is included in
 * `db.tables` and gets cleared along with everything else — so a
 * draft from a previous signed-in user doesn't leak.
 */

import { db } from "@/lib/db";

export interface ServiceSheetDraft {
  /** Primary key — one draft per job. */
  job_id: string;
  /** ISO timestamp of the last save. */
  updated_at: string;

  // ─── Form state mirror ─────────────────────────────────────────
  step: number;
  call_type: string;
  selected_pests: string[];
  selected_methods: string[];
  /** Free-text description captured when the "Other" pest pill is
   *  selected. Optional so drafts written before this field existed (and
   *  the test fixtures) load cleanly; folded into `pest_species` as
   *  "Other: <desc>" at submit. Not indexed → no Dexie version bump. */
  other_pest?: string;
  /** Same, for the "Other" treatment method → folded into `method_used`. */
  other_method?: string;
  findings: string;
  recommendations: string;
  pesticides_used: string;
  report_notes: string;
  risk_level: string;
  risk_comments: string;
  client_name: string;
  tech_sig: string;
  client_sig: string;
  customer_present: "" | "yes" | "no";
  photo_data_urls: string[];
  schedule_follow_up: boolean;
  follow_up_date: string;
}

/** Everything the form needs to write; updated_at is stamped here. */
export type ServiceSheetDraftInput = Omit<ServiceSheetDraft, "updated_at">;

/**
 * Load a draft. Returns `undefined` if no draft exists for the job —
 * callers use a nullish-coalesce to fall back to the job's saved state.
 *
 * The async-querier wrapper in the form's useLiveQuery returns
 * `undefined` for "still loading" and `null` for "confirmed missing",
 * matching the loading-vs-not-found convention used elsewhere in step
 * 7. This helper itself can't tell the difference — it just returns
 * `undefined` for both. The form layer maps undefined → null after
 * the query resolves.
 */
export async function loadDraft(
  jobId: string
): Promise<ServiceSheetDraft | undefined> {
  if (!jobId) return undefined;
  return db.service_sheet_drafts.get(jobId);
}

/**
 * Save a draft. Stamps updated_at on every save so list views could
 * surface "oldest draft" warnings later if useful.
 */
export async function saveDraft(input: ServiceSheetDraftInput): Promise<void> {
  if (!input.job_id) return;
  await db.service_sheet_drafts.put({
    ...input,
    updated_at: new Date().toISOString(),
  });
}

/** Delete a job's draft. Called after a successful Approve. */
export async function clearDraft(jobId: string): Promise<void> {
  if (!jobId) return;
  await db.service_sheet_drafts.delete(jobId);
}
