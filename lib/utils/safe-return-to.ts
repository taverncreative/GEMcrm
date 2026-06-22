/**
 * Validate a `returnTo` redirect target to an internal, same-origin path —
 * the guard against open redirects when an edit form honours a caller's
 * "send me back here after save" param.
 *
 * Safe = an absolute path that starts with a single "/", is NOT
 * protocol-relative ("//evil.com"), and contains no backslash (some
 * browsers normalise "\" to "/", which can smuggle a host past a naive
 * check). Returns the path when safe, else null so the caller falls back to
 * its own default destination.
 */
export function safeInternalPath(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  return raw;
}
