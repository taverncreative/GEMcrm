/**
 * App feature toggles — flip a single constant to enable/disable a
 * behaviour, no other change needed.
 */

/**
 * Review-request task auto-creation.
 *
 * OFF at the client's request (2026-06): completing a job no longer
 * spawns a "Send review request" task. The creation logic in
 * onJobCompleted (lib/services/job-events.ts) is intact behind this
 * gate — flip to `true` to restore the original behaviour byte-for-byte
 * (including its dedup early-return). The dashboard "Request review"
 * widget reads customer review-state separately and is unaffected.
 */
export const REVIEW_REQUESTS_ENABLED = false;
