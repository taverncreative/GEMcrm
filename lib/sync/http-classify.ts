/**
 * Classify the outcome of a sync invocation (server-action call or fetch).
 *
 * The push loop calls server actions via direct imports; the photos loop
 * calls a fetch endpoint. Both can fail in similar shapes — this module
 * is the shared classifier so the loop's retry policy stays in one place.
 *
 *   ok            → 2xx / action returned {success:true} → delete entry
 *   client-error  → 4xx-ish / action returned {success:false} → retry with backoff, mark stuck after 5
 *   auth-expired  → 401/403 / detected redirect-to-login → stop sync, surface banner
 *   server-error  → 5xx / opaque server failure → retry with backoff, leave in queue
 *   network       → fetch failed / TypeError on connection → retry with backoff, leave in queue
 *
 * Notes:
 *
 *   - We can't always tell apart 4xx and 5xx for server-action calls
 *     because Next.js doesn't surface the HTTP status to the client — the
 *     thrown error message is all we have. Heuristics are intentional;
 *     wrong classification at the edges costs at most one extra retry.
 *
 *   - For wrapped server actions whose declared return type is
 *     `{ success: boolean; ... }`, the loop calls `classifyActionResult`
 *     on the resolved value. For fetch-based calls (photos), the loop
 *     calls `classifyHttpStatus` on `response.status`. Both produce the
 *     same `SyncResultClass` so the retry policy is uniform.
 */

export type SyncResultClass =
  | { kind: "ok" }
  | { kind: "client-error"; message: string }
  | { kind: "auth-expired"; message: string }
  | { kind: "server-error"; message: string }
  | { kind: "network"; message: string };

/**
 * Classify a thrown error from an action invocation or fetch.
 *
 * Heuristics on the message string. Browsers / Node have surprisingly
 * consistent text for the obvious cases (`Failed to fetch`, `NetworkError`),
 * but anything ambiguous falls into "server-error" so the entry stays in
 * the queue rather than getting marked client-error and counted towards
 * the stuck threshold.
 */
export function classifyError(
  err: unknown
): Exclude<SyncResultClass, { kind: "ok" }> {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : "Unknown error";
  const lower = message.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("err_internet_disconnected") ||
    lower.includes("load failed")
  ) {
    return { kind: "network", message };
  }

  if (
    lower.includes("not authenticated") ||
    lower.includes("unauthorized") ||
    lower.includes("unauthenticated") ||
    lower.includes("session expired") ||
    lower.includes("invalid jwt") ||
    lower.includes("jwt expired")
  ) {
    return { kind: "auth-expired", message };
  }

  // Fall back to server-error — keeps the entry retryable rather than
  // sending it down the "mark stuck after 5" path on the first weird
  // error. We'd rather over-retry than over-eagerly conclude a bug.
  return { kind: "server-error", message };
}

/**
 * Classify the resolved value of a wrapped server-action call. The
 * actions return `{success, message, errors?}` or `{success, error?}` —
 * both flavours are handled.
 *
 * `void` resolves to `ok` (a few direct-call helpers return nothing on
 * success). Anything else without an explicit `success` flag is treated
 * as `ok` defensively — the worst case is we delete an outbox entry
 * that should have been retried, which the sync engine catches on the
 * next pull when the server state differs.
 */
export function classifyActionResult(result: unknown): SyncResultClass {
  if (result === undefined || result === null) {
    return { kind: "ok" };
  }
  if (typeof result === "object" && "success" in result) {
    const r = result as {
      success: boolean;
      message?: string | null;
      error?: string | null;
      errors?: Record<string, string>;
    };
    if (r.success) return { kind: "ok" };

    // Surface the actual reason in last_error / the conflict inbox.
    // Order of preference: explicit message > explicit error > the
    // field-by-field errors object (which most server actions populate
    // for validation failures). Without this fallback the inbox just
    // showed "Action reported failure" which buried the cause — the
    // null-vs-undefined Zod failure on client_name took several rounds
    // to find precisely because the actual error never reached the UI.
    let message = r.message ?? r.error ?? null;
    if (!message && r.errors && typeof r.errors === "object") {
      const entries = Object.entries(r.errors).filter(
        ([, v]) => typeof v === "string" && v.length > 0
      );
      if (entries.length > 0) {
        message = entries.map(([k, v]) => `${k}: ${v}`).join("; ");
      }
    }
    return {
      kind: "client-error",
      message: message ?? "Action reported failure",
    };
  }
  return { kind: "ok" };
}

/**
 * Classify an HTTP response status — used by the photos loop's fetch
 * calls. Mirrors the same SyncResultClass so the retry policy applies.
 */
export function classifyHttpStatus(
  status: number,
  body?: string
): SyncResultClass {
  if (status >= 200 && status < 300) return { kind: "ok" };
  if (status === 401 || status === 403) {
    return { kind: "auth-expired", message: body ?? `HTTP ${status}` };
  }
  if (status >= 400 && status < 500) {
    return { kind: "client-error", message: body ?? `HTTP ${status}` };
  }
  return { kind: "server-error", message: body ?? `HTTP ${status}` };
}

/**
 * Should an entry's `attempts` counter be the only retry mechanism, or
 * should the loop stop entirely? Auth expiry stops everything; other
 * failures stay scoped to the single entry.
 */
export function isHaltingFailure(c: SyncResultClass): boolean {
  return c.kind === "auth-expired";
}
