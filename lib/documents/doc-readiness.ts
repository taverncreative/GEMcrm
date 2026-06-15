import type { Customer } from "@/types/database";

/**
 * Document-completeness gate — THE single source of truth for what a
 * document action needs from a customer record.
 *
 * A document action needs only what that action actually requires:
 *
 *   - "send"               → emails the document to the customer, so it
 *                            needs an email address.
 *   - "generate"/"download"→ only renders the PDF (or hands back the file).
 *                            That needs only the customer's NAME, which a
 *                            booking always has — so it never prompts.
 *
 * The postal ADDRESS is always optional: it's offered (while a prompt is
 * already open for a required field) but never required, and the document
 * templates omit a blank address line. The address never gates an action.
 *
 * This module is pure — no IO, no React — so the rule can be unit-tested in
 * isolation and reused by the imperative prompt API and any call site.
 */

export type DocAction = "send" | "generate" | "download";

/** A field the readiness prompt can collect. */
export type DocField = "email" | "address";

export interface DocReadiness {
  /** No REQUIRED field is missing — the caller may proceed WITHOUT showing a
   *  prompt. True for every "generate"/"download", and for "send" when an
   *  email is already on file. */
  ready: boolean;
  /** Required-but-blank fields that MUST be collected before the action can
   *  proceed. ("send" → ["email"] when the email is absent;
   *  "generate"/"download" → always []). */
  required: DocField[];
  /** Skippable fields worth offering WHILE a prompt is already open for a
   *  required field — never gates the action, and empty when `ready` (since
   *  no prompt is shown). ("address" when the customer has none on file). */
  optional: DocField[];
}

type CustomerDocFields = Pick<
  Customer,
  "email" | "address_line_1" | "town" | "postcode"
>;

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}

/** True when the customer has any postal-address line on file. */
function hasAddress(customer: CustomerDocFields | null): boolean {
  if (!customer) return false;
  return (
    !isBlank(customer.address_line_1) ||
    !isBlank(customer.town) ||
    !isBlank(customer.postcode)
  );
}

/**
 * Decide, for a (customer, action) pair, whether the completeness prompt is
 * needed and which fields it should collect.
 *
 * Send requires an email when absent; generate/download require nothing;
 * the address is never required (only offered).
 */
export function customerDocReadiness(
  customer: CustomerDocFields | null,
  action: DocAction
): DocReadiness {
  // Only sending reaches out to the customer, so only sending needs contact
  // details. Generating/downloading needs only the name (always present).
  const needsEmail = action === "send" && isBlank(customer?.email);

  const required: DocField[] = needsEmail ? ["email"] : [];
  const ready = required.length === 0;

  // The address is only ever offered ALONGSIDE a prompt we're already
  // showing — never on its own, and never once the action is ready.
  const optional: DocField[] =
    !ready && !hasAddress(customer) ? ["address"] : [];

  return { ready, required, optional };
}

/** Convenience predicate: does this (customer, action) pair need the prompt? */
export function needsDocReadyPrompt(
  customer: CustomerDocFields | null,
  action: DocAction
): boolean {
  return !customerDocReadiness(customer, action).ready;
}
