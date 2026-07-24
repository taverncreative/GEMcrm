/**
 * Spotlight ingest — pushes a submitted feature request into the separate
 * "Spotlight" CRM so requests land in a triageable list instead of
 * scattered WhatsApps.
 *
 * BEST EFFORT, AND NEVER THROWS. By the time this runs, Nate's submit is
 * already complete: the feature_requests row is written and the email has
 * gone, and both remain the record of the request. So every failure path —
 * unset env, non-2xx, timeout, unreachable host, malformed response — is
 * swallowed here and logged server-side only, returning a result object
 * rather than raising.
 *
 * That is a correctness requirement, not politeness: if a Spotlight outage
 * surfaced to Nate as "Failed to submit request", he would resubmit a
 * request that HAD been logged, and Spotlight would end up with duplicates
 * the moment it came back. The row + email are the backstops; Spotlight is
 * the convenience.
 *
 * Skipped silently when SPOTLIGHT_INGEST_URL / SPOTLIGHT_INGEST_TOKEN are
 * unset — that is the pre-configuration state (and how this ships until the
 * Vercel env vars are added), not an error.
 *
 * `source_app` is deliberately NOT sent: Spotlight derives it from the
 * token, so the token IS the app identity. Don't add it.
 *
 * Env:
 *   SPOTLIGHT_INGEST_URL       — e.g. https://…/api/inbound/feedback
 *   SPOTLIGHT_PRINT_ORDER_URL  — e.g. https://…/api/inbound/print-order
 *   SPOTLIGHT_INGEST_TOKEN     — bearer token; also identifies the source app
 *                                (shared by BOTH endpoints — same app)
 */

/** A hanging Spotlight must not stall Nate's submit — the action awaits
 *  this, so the abort is what bounds the worst case. */
const TIMEOUT_MS = 5000;

/** Spotlight rejects bodies over 16KB (413). We guard before sending so an
 *  over-large basket fails locally with a clear reason rather than a 413. */
const MAX_BODY_BYTES = 16 * 1024;

export interface SpotlightFeedbackInput {
  /** The request body Nate typed. Required by Spotlight. */
  message: string;
  /** The feature_requests row id — Spotlight's idempotency key, so a
   *  retry can't duplicate. Required. */
  request_id: string;
  /** feature | bug | change. */
  type?: string;
  /** Who it came from, e.g. "Nate Green". */
  client_name?: string;
  /** Deep link back to the thing being discussed. Unused for now. */
  link?: string;
}

export interface SpotlightResult {
  delivered: boolean;
  /** Why it didn't land — for logs, never for the operator's screen. */
  reason?: string;
}

/**
 * POST a feature request to Spotlight. Resolves `{ delivered: false }`
 * rather than throwing on ANY failure.
 */
export async function sendFeedbackToSpotlight(
  input: SpotlightFeedbackInput
): Promise<SpotlightResult> {
  const url = process.env.SPOTLIGHT_INGEST_URL?.trim();
  const token = process.env.SPOTLIGHT_INGEST_TOKEN?.trim();
  if (!url || !token) {
    // Not wired up yet. Silent by design — the row + email still happened.
    return { delivered: false, reason: "not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      // Optional fields are omitted rather than sent null, so Spotlight's
      // validation sees a clean body. No source_app — see the header.
      body: JSON.stringify({
        message: input.message,
        request_id: input.request_id,
        ...(input.type ? { type: input.type } : {}),
        ...(input.client_name ? { client_name: input.client_name } : {}),
        ...(input.link ? { link: input.link } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(
        `[spotlight] ingest HTTP ${res.status} for request ${input.request_id}`
      );
      return { delivered: false, reason: `HTTP ${res.status}` };
    }
    return { delivered: true };
  } catch (err) {
    // Covers the abort (timeout), DNS/connection failures, and anything
    // else fetch can raise. Logged, never surfaced.
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[spotlight] ingest failed for request ${input.request_id}:`,
      reason
    );
    return { delivered: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Print orders ────────────────────────────────────────────────────────

/** One line of a print order — mirrors Spotlight's item contract exactly. */
export interface SpotlightPrintItem {
  /** Document name to print (1–300 chars). Spotlight validates the length. */
  name: string;
  /** How many copies (int, 1–10000). */
  quantity: number;
  /** Stable id of the source document, so the order stays correct if the
   *  document is later renamed. Optional per the contract, always sent here. */
  reference?: string;
}

export interface SpotlightPrintOrderInput {
  /** Client-generated order id — Spotlight's idempotency key. A retry with
   *  the same id returns `duplicate:true` rather than printing twice. */
  order_id: string;
  /** 1–100 items. */
  items: SpotlightPrintItem[];
  /** Who confirmed the order, e.g. "Nate Green". Optional (≤200). */
  submitter?: string;
  /** Free-text note. Optional (≤2000). */
  note?: string;
  /** ISO-8601 timestamp of the order. Optional. */
  ordered_at?: string;
}

/**
 * POST a confirmed print order to Spotlight. A verbatim sibling of
 * {@link sendFeedbackToSpotlight}: BEST EFFORT, NEVER THROWS, 5s abort,
 * bearer auth, optional fields omitted rather than sent null, and NO source
 * field (the token identifies the app). Resolves `{ delivered: false }` on
 * every failure path so a Spotlight outage can never fail Nate's basket
 * confirmation — the print_orders row is the record either way.
 *
 * Uses SPOTLIGHT_PRINT_ORDER_URL (the print-order endpoint) with the SAME
 * SPOTLIGHT_INGEST_TOKEN as feedback. Skipped silently when either is unset.
 */
export async function sendPrintOrderToSpotlight(
  input: SpotlightPrintOrderInput
): Promise<SpotlightResult> {
  const url = process.env.SPOTLIGHT_PRINT_ORDER_URL?.trim();
  const token = process.env.SPOTLIGHT_INGEST_TOKEN?.trim();
  if (!url || !token) {
    return { delivered: false, reason: "not configured" };
  }

  // Build the body first so we can enforce Spotlight's 16KB cap locally.
  const body = JSON.stringify({
    order_id: input.order_id,
    items: input.items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      ...(it.reference ? { reference: it.reference } : {}),
    })),
    ...(input.submitter ? { submitter: input.submitter } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.ordered_at ? { ordered_at: input.ordered_at } : {}),
  });
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    console.error(
      `[spotlight] print order ${input.order_id} body over 16KB, not sent`
    );
    return { delivered: false, reason: "body too large" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(
        `[spotlight] print order HTTP ${res.status} for order ${input.order_id}`
      );
      return { delivered: false, reason: `HTTP ${res.status}` };
    }
    return { delivered: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[spotlight] print order failed for order ${input.order_id}:`,
      reason
    );
    return { delivered: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
