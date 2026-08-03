"use client";

/**
 * Agreement-wizard draft persistence.
 *
 * Same idea as the service-sheet draft store (`lib/db/drafts.ts`), for
 * the same reason but with higher stakes: the operator fills a four-step
 * agreement in front of a customer and captures TWO signatures on the
 * last step. Before this existed, anything that unmounted the wizard —
 * a dropped connection hitting the route error boundary, a background
 * tab being reclaimed, an accidental back-swipe, an app restart — took
 * both signatures with it, and the customer has to sign again.
 *
 * So every field of the in-progress wizard, INCLUDING the two signature
 * data URLs, is mirrored into IndexedDB (debounced in the form). On the
 * next mount the wizard rehydrates from the draft.
 *
 * Lifecycle:
 *   - Operator edits any field       → debounced 500ms → saveAgreementDraft()
 *   - Agreement created successfully → clearAgreementDraft()
 *   - Operator reloads / re-enters   → loadAgreementDraft() rehydrates
 *
 * Key: siteId. One in-progress agreement per site, which matches the
 * wizard's entry points (the site page's Agreements card, and the
 * top-level New Agreement front door, which routes to a site).
 *
 * Why Dexie and not localStorage: two base64 PNG signatures plus ~6KB of
 * terms text runs to tens of KB per draft, against localStorage's ~5MB
 * shared quota — and localStorage writes are synchronous on the main
 * thread, which is exactly what we don't want on every keystroke of a
 * form the operator is filling live. Dexie is already the app's local
 * store, is async, and is wiped on user change by SyncBoot (`db.tables`
 * includes this table), so a draft can't leak between signed-in users.
 */

import { db } from "@/lib/db";

export interface AgreementDraft {
  /** Primary key — one in-progress agreement per site. */
  site_id: string;
  /** ISO timestamp of the last save. */
  updated_at: string;

  // ─── Wizard state mirror ───────────────────────────────────────
  /** Which of the four steps the operator was on. */
  step: number;
  /** The 14 controlled text/date/number fields, by form field name. */
  fields: Record<string, string>;
  selected_pests: string[];
  /** Free text captured when the "Other" pest pill is selected. */
  other_pest: string;
  /** The "I have read and agree to the terms" tick — restored so a
   *  rehydrated wizard can still reach step 4 without re-ticking. */
  terms_accepted: boolean;
  /** Signature data URLs. The whole reason this table exists. */
  gem_signature: string;
  client_signature: string;
}

/** Everything the form writes; updated_at is stamped here. */
export type AgreementDraftInput = Omit<AgreementDraft, "updated_at">;

/**
 * Load a site's draft. Returns `undefined` when there is none — callers
 * nullish-coalesce to the wizard's own defaults.
 */
export async function loadAgreementDraft(
  siteId: string
): Promise<AgreementDraft | undefined> {
  if (!siteId) return undefined;
  try {
    return await db.agreement_drafts.get(siteId);
  } catch (err) {
    // A draft read must never block the operator from starting a new
    // agreement — worst case they fill it fresh.
    console.warn("[agreementDraft] load failed:", err);
    return undefined;
  }
}

/** Save (upsert) a site's draft. Stamps updated_at on every save. */
export async function saveAgreementDraft(
  input: AgreementDraftInput
): Promise<void> {
  if (!input.site_id) return;
  try {
    await db.agreement_drafts.put({
      ...input,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[agreementDraft] save failed:", err);
  }
}

/** Delete a site's draft. Called after a successful create. */
export async function clearAgreementDraft(siteId: string): Promise<void> {
  if (!siteId) return;
  try {
    await db.agreement_drafts.delete(siteId);
  } catch (err) {
    console.warn("[agreementDraft] clear failed:", err);
  }
}
