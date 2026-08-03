/**
 * Which sheet columns a submission is AUTHORITATIVE for.
 *
 * The problem this solves: `writeServiceSheet` builds one UPDATE covering
 * every service-sheet column, so whatever the form didn't send is written
 * as empty. On a fresh fill that is correct, because the job is blank. On
 * an AMEND it is destructive: the amend form loaded only part of the sheet,
 * so saving it wiped the rest. Proven against the database — a re-signed
 * amend that changed nothing else nulled the client signature, flipped
 * client_present to false, nulled client_name, cleared needs_invoice and
 * DELETED BOTH PHOTOS. Photos are captured in the field and cannot be
 * recreated.
 *
 * ── Why a manifest and not a magic value ──
 *
 * The ambiguity is "this field is empty because the operator cleared it"
 * versus "this field is empty because the form never loaded it". A
 * per-field sentinel string (`"__CLEARED__"`) resolves that but is a poor
 * fit here: it shares a channel with user data (findings and client_name
 * are free text), it needs a different spelling per type (string, string
 * array, boolean), and it says nothing about a column added to
 * writeServiceSheet next year that the form has never heard of.
 *
 * A manifest is a SEPARATE channel, so it cannot collide with anything the
 * operator types, and it is exhaustive by construction:
 *
 *   - field IS in the manifest, value empty  → the operator cleared it,
 *     write the empty value
 *   - field is NOT in the manifest           → the form had nothing to say,
 *     omit the column from the UPDATE entirely
 *
 * "Omit from the UPDATE" is the strong bit. A column that isn't in the
 * statement cannot change, so byte-identical is guaranteed structurally
 * rather than by getting a comparison right.
 *
 * It also handles the two failure modes that matter without extra code:
 * if the signature fetch fails (offline, storage down), the form simply
 * does not claim the signature and the stored URL is preserved; and a new
 * column added to the writer that nobody teaches the form about is
 * preserved on amend by default instead of being silently wiped.
 */

/**
 * Every column `writeServiceSheet` can write, as a manifest key. The names
 * are the DB column names so a reader can line them up against the UPDATE
 * without a translation step.
 *
 * `treatment` is deliberately absent: it is derived from `method_used` and
 * always travels with it.
 */
export const SHEET_FIELDS = [
  "call_type",
  "call_type_other_desc",
  "pest_species",
  "findings",
  "recommendations",
  "method_used",
  "products_used",
  "risk_level",
  "risk_comments",
  "environmental_comments",
  "report_notes",
  "photo_urls",
  "client_present",
  "client_name",
  "needs_invoice",
  "technician_signature_url",
  "client_signature_url",
] as const;

export type SheetField = (typeof SHEET_FIELDS)[number];

/**
 * The columns the amend form has always loaded correctly. Used ONLY as the
 * fallback for an amend that carries no manifest at all — an outbox entry
 * queued by the previous build and replayed after this one deploys. Those
 * entries genuinely only knew about these, so preserving the rest is both
 * correct for them and strictly safer than the behaviour they were queued
 * under.
 */
export const LEGACY_AMEND_FIELDS: readonly SheetField[] = [
  "call_type",
  "call_type_other_desc",
  "pest_species",
  "findings",
  "recommendations",
  "method_used",
  "products_used",
  "risk_level",
  "risk_comments",
  "environmental_comments",
  "report_notes",
];

/** Serialise a manifest for transport in FormData / an outbox entry. */
export function encodeSheetFields(fields: readonly SheetField[]): string {
  return fields.join(",");
}

/**
 * Parse a manifest off the wire. Unknown names are dropped rather than
 * trusted, so a malformed or hand-edited entry can never widen what a
 * submission is allowed to overwrite.
 */
export function parseSheetFields(raw: string | null | undefined): SheetField[] {
  if (!raw) return [];
  const known = new Set<string>(SHEET_FIELDS);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SheetField => known.has(s));
}
