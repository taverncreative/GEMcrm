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
 * The postal ADDRESS is never collected here. It used to be offered (while
 * a prompt was already open) for the INVOICE alone, that being the one
 * document with a customer bill-to block; reports and agreements show the
 * site address instead. The invoice surface was removed in slice 2b and its
 * code in 2c, so nothing offers it any more and `optional` is always empty.
 *
 * This module is pure — no IO, no React — so the rule can be unit-tested in
 * isolation and reused by the imperative prompt API and any call site.
 */

export type DocVerb = "send" | "generate" | "download";
export type DocType = "report" | "agreement";

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
   *  gates the action. ALWAYS EMPTY since the invoice (the only document
   *  that collected an address) was removed. Kept on the shape because the
   *  prompt component still reads it and its address-capture path is shared;
   *  retiring the concept is a separate tidy, not part of the invoice work. */
  optional: DocField[];
}

type CustomerDocFields = Pick<
  Customer,
  "email" | "address_line_1" | "town" | "postcode"
>;

/** True for null/undefined/whitespace-only. Shared with the
 *  service-sheet readiness rule. */
export function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}

/**
 * Decide, for a (customer, target) pair, whether the completeness prompt is
 * needed and which fields it should collect.
 *
 * Send requires an email when absent; generate/download require nothing.
 * Nothing is optional any more — see the note on DocReadiness.optional.
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

  // No optional field is offered: the invoice was the only document that
  // collected a postal address, and it is gone.
  return { ready, required, optional: [] };
}

/** Convenience predicate: does this (customer, target) pair need the prompt? */
export function needsDocReadyPrompt(
  customer: CustomerDocFields | null,
  target: DocTarget
): boolean {
  return !customerDocReadiness(customer, target).ready;
}
