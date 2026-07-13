import { z } from "zod";

/**
 * Multi-recipient email parsing + validation, shared by the client send
 * UI (immediate feedback) and the server send actions (authoritative
 * gate). One source of truth so the two never disagree.
 *
 * Model: recipients are entered as a comma / newline / semicolon
 * separated string, pre-filled with the customer's email. We split,
 * trim, validate each with the same email rule the customer form uses,
 * and dedupe case-insensitively. Any invalid address HARD-BLOCKS the
 * whole send (no warn-and-skip) so a typo can never silently drop a
 * recipient.
 */

const emailSchema = z.string().email();

/** Split a raw recipients string into trimmed, non-empty tokens. */
export function splitRecipients(raw: string): string[] {
  return raw
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type RecipientsResult =
  | { ok: true; emails: string[] }
  | { ok: false; error: string };

/**
 * Validate a list of recipient addresses. Returns the deduped, ordered
 * list on success, or an error naming the first bad address on failure.
 */
export function validateRecipients(list: string[]): RecipientsResult {
  if (list.length === 0) {
    return { ok: false, error: "Add at least one recipient email address." };
  }
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of list) {
    const addr = raw.trim();
    if (!emailSchema.safeParse(addr).success) {
      return { ok: false, error: `"${addr}" is not a valid email address.` };
    }
    const key = addr.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      emails.push(addr);
    }
  }
  return { ok: true, emails };
}

/** Convenience: parse a raw string straight to a validated result. */
export function parseAndValidateRecipients(raw: string): RecipientsResult {
  return validateRecipients(splitRecipients(raw));
}
