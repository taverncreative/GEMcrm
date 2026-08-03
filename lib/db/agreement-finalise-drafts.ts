"use client";

/**
 * Agreement-FINALISE draft persistence.
 *
 * Sibling of `lib/db/agreement-drafts.ts`, for the second place the
 * operator captures two signatures in front of a customer.
 *
 * The wizard draft covers an agreement that does not exist yet. This
 * covers the other half: a `draft`-status agreement already on the
 * server, being made live. The operator opens the finalise panel at the
 * customer's premises, captures the GEM signature and the client
 * signature, types the signee name — and until now all of that lived in
 * plain component state. Anything that unmounted the panel took both
 * signatures with it: a `router.refresh()` from elsewhere on the page, a
 * route error boundary, a back-swipe, a backgrounded tab reclaimed by
 * mobile Safari. The customer then has to sign again.
 *
 * Lifecycle:
 *   - Operator signs / types        → debounced 500ms → saveFinaliseDraft()
 *   - Agreement finalised OK        → clearFinaliseDraft()
 *   - Draft agreement discarded     → clearFinaliseDraft()
 *   - Operator reloads / re-enters  → loadFinaliseDraft() rehydrates,
 *                                     and the panel re-opens itself
 *
 * ── Key: agreement_id, NOT site_id ──
 *
 * The wizard keys by site_id because it is creating "the next agreement
 * for this site" and there can only be one of those in flight. Finalise
 * is different in two ways that both break that key:
 *
 *   1. It acts on ONE specific, already-persisted agreement. A site can
 *      hold several draft agreements at once (each "Save as draft" in the
 *      wizard makes another), so site_id does not identify which one is
 *      being signed.
 *   2. A site can legitimately have a wizard draft in flight AND a
 *      finalise in flight at the same time. Sharing site_id as the key
 *      would let one clobber the other, which is the exact class of loss
 *      this table exists to stop.
 *
 * A separate table rather than a namespaced key in `agreement_drafts`
 * because the two shapes have nothing in common: the wizard stores four
 * steps of fields, pest pills and a terms tick; this stores two
 * signatures, a name and a date. Sharing the row type would mean making
 * most of it optional and losing the type safety on both sides.
 *
 * Why Dexie and not localStorage: same reasoning as the wizard store —
 * two base64 PNGs run to tens of KB, and localStorage writes block the
 * main thread on every keystroke. Dexie is async, is already the app's
 * local store, and is wiped on user change by SyncBoot (which iterates
 * `db.tables`), so a draft cannot leak between signed-in users.
 */

import { db } from "@/lib/db";

export interface AgreementFinaliseDraft {
  /** Primary key — the agreement being finalised. */
  agreement_id: string;
  /** ISO timestamp of the last save. */
  updated_at: string;

  /** Signature data URLs. The whole reason this table exists. */
  gem_signature: string;
  client_signature: string;
  /** Name of the person signing, as typed. */
  signatory_name: string;
  /** The signed date (yyyy-mm-dd), as chosen. */
  signed_date: string;
}

/** Everything the panel writes; updated_at is stamped here. */
export type AgreementFinaliseDraftInput = Omit<
  AgreementFinaliseDraft,
  "updated_at"
>;

/**
 * Load an agreement's finalise draft. Returns `undefined` when there is
 * none — callers nullish-coalesce to the panel's own defaults.
 */
export async function loadFinaliseDraft(
  agreementId: string
): Promise<AgreementFinaliseDraft | undefined> {
  if (!agreementId) return undefined;
  try {
    return await db.agreement_finalise_drafts.get(agreementId);
  } catch (err) {
    // A draft read must never block the operator from finalising —
    // worst case they capture the signatures fresh.
    console.warn("[finaliseDraft] load failed:", err);
    return undefined;
  }
}

/** Save (upsert) an agreement's finalise draft. Stamps updated_at. */
export async function saveFinaliseDraft(
  input: AgreementFinaliseDraftInput
): Promise<void> {
  if (!input.agreement_id) return;
  try {
    await db.agreement_finalise_drafts.put({
      ...input,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[finaliseDraft] save failed:", err);
  }
}

/**
 * Delete an agreement's finalise draft. Called after a successful
 * finalise, and after the draft agreement is discarded (there is nothing
 * left to sign).
 */
export async function clearFinaliseDraft(agreementId: string): Promise<void> {
  if (!agreementId) return;
  try {
    await db.agreement_finalise_drafts.delete(agreementId);
  } catch (err) {
    console.warn("[finaliseDraft] clear failed:", err);
  }
}
