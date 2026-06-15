import type { Customer } from "@/types/database";

/**
 * Document-completeness gate — THE single source of truth for what a
 * document action needs from a customer record.
 *
 * A document action needs only what that action actually requires:
 *
 *   - verb "send"               → emails the document to the customer, so it
 *                                 needs an email address.
 *   - verb "generate"/"download"→ only renders the PDF (or hands back the
 *                                 file). That needs only the customer's NAME,
 *                                 which a booking always has — so it never
 *                                 prompts.
 *
 * The postal ADDRESS is offered (while a prompt is already open for a
 * required field) but never required, and ONLY for the invoice — that's the
 * one document with a customer bill-to block. Reports and agreements show
 * the site address, so they never collect a customer address. The address
 * never gates an action.
 *
 * This module is pure — no IO, no React — so the rule can be unit-tested in
 * isolation and reused by the imperative prompt API and any call site.
 */

export type DocVerb = "send" | "generate" | "download";
export type DocType = "invoice" | "report" | "agreement";

/** A (verb, document-type) pair — what the call site is about to do. */
export interface DocTarget {
  verb: DocVerb;
  doc: DocType;
}

/** A field the readiness prompt can collect. */
export type DocField = "email" | "address";

export interface DocReadiness {
  /** No REQUIRED field is missing — the caller may proceed WITHOUT showing a
   *  prompt. True for every "generate"/"download", and for "send" when an
   *  email is already on file. */
  ready: boolean;
  /** Required-but-blank fields that MUST be collected before the action can
   *  proceed. ("send" → ["email"] when the email is absent; otherwise []). */
  required: DocField[];
  /** Skippable fields worth offering WHILE a prompt is already open — never
   *  gates the action, empty when `ready`. Only the INVOICE collects an
   *  address (its bill-to block); reports/agreements never do. */
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
 * Decide, for a (customer, target) pair, whether the completeness prompt is
 * needed and which fields it should collect.
 *
 * Send requires an email when absent; generate/download require nothing.
 * The address is never required — only offered, and only when prompting for
 * an invoice send whose customer has no address on file.
 */
export function customerDocReadiness(
  customer: CustomerDocFields | null,
  target: DocTarget
): DocReadiness {
  // Only sending reaches out to the customer, so only sending needs contact
  // details. Generating/downloading needs only the name (always present).
  const needsEmail = target.verb === "send" && isBlank(customer?.email);

  const required: DocField[] = needsEmail ? ["email"] : [];
  const ready = required.length === 0;

  // The address is only ever offered ALONGSIDE a prompt we're already
  // showing, only for the invoice (the one doc with a customer bill-to),
  // and only when there's no address on file to put in it.
  const offerAddress =
    !ready && target.doc === "invoice" && !hasAddress(customer);
  const optional: DocField[] = offerAddress ? ["address"] : [];

  return { ready, required, optional };
}

/** Convenience predicate: does this (customer, target) pair need the prompt? */
export function needsDocReadyPrompt(
  customer: CustomerDocFields | null,
  target: DocTarget
): boolean {
  return !customerDocReadiness(customer, target).ready;
}
