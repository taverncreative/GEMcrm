"use client";

/**
 * Photo upload loop.
 *
 * Reads `photos_pending` rows where `uploaded === false` AND
 * `next_attempt_at <= now()`, uploads each to `POST /api/photos/upload`
 * at concurrency 2, marks success/failure on the row.
 *
 * Path: photos always go to `photos/<photoId>.jpg` in the `reports`
 * bucket — the upload route enforces this via the photoId field. That
 * deterministic mapping is what lets the server-side action replay
 * compute `photo_urls` without coordinating with the photos loop.
 *
 * Concurrency: 2 simultaneous uploads. Engineers may have dozens of
 * photos per day; uploading them all in parallel would saturate the
 * link and starve push/pull. Two-at-a-time is a safe balance for 4G
 * conditions.
 *
 * Halting: on first auth-expired response, the loop bails entirely
 * (the remaining queue stays for after re-login). Other failures
 * scope to the single photo with backoff.
 *
 * Never abandoned. This loop used to DROP any row past
 * STUCK_THRESHOLD attempts, on the reasoning that it "needs manual
 * attention". Nothing ever gave it that attention, so the drop was
 * permanent: on 13 July an RLS failure burned all five attempts in a
 * couple of minutes (1s/2s/4s/8s/16s across 30-second ticks) and twelve
 * photos from four completed jobs were never tried again. They were
 * taken at customer premises and cannot be recreated.
 *
 * So the threshold no longer decides whether to retry, only how often
 * and how loudly:
 *   - under it, the normal fast backoff (~1s → ~16s);
 *   - at or over it, the photo is STUCK: retries continue for ever at
 *     STUCK_RETRY_MS, and it is surfaced as stuck (see below).
 * A transient cause therefore self-heals with no operator action, and a
 * permanent one gets a human without costing a request every tick.
 *
 * Where stuck photos surface (this list was previously a false claim
 * that "the conflict inbox surfaces them" — it did not read this table
 * at all):
 *   - /sync/conflicts, alongside stuck outbox entries, with a retry;
 *   - the <StuckSyncAlert> banner and toast, the moment one sticks;
 *   - the photo-recovery card in Settings, which lists everything
 *     pending whether stuck or not.
 *
 * Ordering: least-attempted first, so a freshly captured photo is never
 * queued behind a pile of long-stuck ones.
 *
 * Blob cleanup: after a successful upload, if the photo's `captured_at`
 * is more than 7 days old, the local blob is replaced with a zero-byte
 * Blob to reclaim IndexedDB space. The `server_url` field keeps the
 * photo viewable via `getPhotoSrcAsync`'s fallback. Photos still within
 * the 7-day window keep their blob — the operator may go offline shortly
 * after capture and want to re-view what they just took.
 *
 * Not in scope here:
 *   - Updating parent record's `photo_urls`. The action replay
 *     (writeServiceSheet) computes URLs deterministically from photo
 *     ids, so the parent record always has the right URL — it just
 *     temporarily points at a dead object between push completion and
 *     photo-upload completion (brief broken-image, then live).
 *   - Re-photo capture. Once uploaded:true the loop never re-uploads
 *     the same photo. To replace a photo the user captures a new one.
 */

import { db } from "@/lib/db";
import { nextAttemptAt } from "@/lib/sync/backoff";
import { classifyError, classifyHttpStatus } from "@/lib/sync/http-classify";
import { photoBlobSize } from "@/lib/photos/blob-size";

const CONCURRENCY = 2;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Attempts after which a photo counts as stuck: it keeps retrying, but
 * slowly, and it is surfaced to the operator as not-sent.
 */
export const STUCK_THRESHOLD = 5;

/**
 * Retry interval once stuck. Long enough that a permanently failing
 * photo costs roughly one request an hour rather than one every tick,
 * short enough that a fix deployed during the working day heals the
 * queue before the operator gets home.
 */
const STUCK_RETRY_MS = 30 * 60 * 1000;

/** Is this photo past the point where it needs a human to look at it? */
export function isPhotoStuck(photo: {
  uploaded: boolean;
  upload_attempts: number;
}): boolean {
  return !photo.uploaded && photo.upload_attempts >= STUCK_THRESHOLD;
}

export interface PhotoResult {
  attempted: number;
  succeeded: number;
  failed: number;
  halted: boolean;
  halt_reason?: string;
}

export async function drainPhotos(): Promise<PhotoResult> {
  const now = new Date().toISOString();
  // Dexie doesn't compose well across multiple where() conditions on
  // separate indexes, so we read the small "not yet uploaded" set and
  // filter ready-by-next_attempt in JS. Pending counts in practice are
  // small (one engineer's daily photos).
  const eligible = await db.photos_pending
    .filter((p) => !p.uploaded && (p.next_attempt_at ?? "") <= now)
    .toArray();

  // Every eligible row is attempted, including long-stuck ones. Nothing
  // is filtered out here: the ceiling that used to drop rows at five
  // attempts is what lost twelve photos on 13 July. A stuck row is
  // already rate-limited to STUCK_RETRY_MS by its own backoff, so
  // keeping it in the queue costs about one request an hour.
  //
  // Least-attempted first, so today's captures go before a backlog of
  // stuck ones rather than queueing behind them.
  const ready = [...eligible].sort(
    (a, b) => a.upload_attempts - b.upload_attempts
  );

  const result: PhotoResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    halted: false,
  };

  if (ready.length === 0) return result;

  // Simple worker-pool of CONCURRENCY workers consuming a shared
  // index. Each worker bails on halting failure; the outer code
  // checks `result.halted` after Promise.all to fold their state.
  let cursor = 0;
  let haltReason: string | null = null;

  async function worker(): Promise<void> {
    while (cursor < ready.length && !haltReason) {
      const idx = cursor++;
      const photo = ready[idx];
      result.attempted++;
      const outcome = await uploadOne(photo);

      if (outcome.kind === "ok") {
        result.succeeded++;
      } else if (outcome.kind === "auth-expired") {
        haltReason = outcome.message ?? "Auth expired";
        // Stop this worker; the other may still be mid-upload and
        // will check `haltReason` on its next iteration.
        return;
      } else {
        result.failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if (haltReason) {
    result.halted = true;
    result.halt_reason = haltReason;
  }

  // Blob cleanup pass — fold into the same drain so we don't need a
  // separate scheduler. Cheap (single Dexie query + few updates per day).
  await cleanupOldBlobs();

  return result;
}

export interface UploadOutcome {
  kind: "ok" | "client-error" | "auth-expired" | "server-error" | "network";
  message?: string;
}

/**
 * Upload ONE pending photo, ignoring both the attempt ceiling and the
 * backoff clock.
 *
 * `drainPhotos` no longer drops anything, but a stuck photo only comes
 * round every STUCK_RETRY_MS. This is the operator's way to say "try it
 * now" — from the conflict inbox or the Settings recovery card — without
 * waiting out the interval.
 *
 * It is also the route back in for the twelve photos abandoned on 13
 * July, before the ceiling was removed: an RLS failure (fixed hours
 * later) burned all five attempts in a couple of minutes, and the loop
 * skipped them permanently.
 *
 * Nothing else has to happen for the recovery to land. The object key is
 * derived from the photo id, and the job's `photo_urls` already holds the
 * URL for exactly that key, so a successful upload makes the existing
 * reference resolve with NO write to the jobs table at all.
 *
 * A zero-byte blob is refused rather than uploaded: the cleanup pass
 * blanks blobs for photos it believes are already uploaded, so an empty
 * one here means the bytes are genuinely gone and overwriting the key
 * with nothing would destroy the last evidence of what is missing.
 */
export async function retryPhotoUpload(
  photoId: string
): Promise<UploadOutcome> {
  const photo = await db.photos_pending.get(photoId);
  if (!photo) {
    return { kind: "client-error", message: "Photo not found on this device" };
  }
  if (photo.uploaded) {
    return { kind: "ok" };
  }
  if (photoBlobSize(photo.blob) === 0) {
    return {
      kind: "client-error",
      message: "The image data is no longer on this device",
    };
  }
  return uploadOne(photo);
}

async function uploadOne(photo: {
  id: string;
  blob: Blob;
  captured_at: string;
  upload_attempts: number;
}): Promise<UploadOutcome> {
  const fd = new FormData();
  fd.set("photoId", photo.id);
  fd.set("file", photo.blob);

  let response: Response;
  try {
    response = await fetch("/api/photos/upload", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    });
  } catch (err) {
    const cls = classifyError(err);
    await markFailed(photo.id, photo.upload_attempts + 1, cls.message ?? "Network error");
    return cls;
  }

  if (response.ok) {
    let body: { url?: string } = {};
    try {
      body = await response.json();
    } catch {
      // Empty body — shouldn't happen, but don't crash.
    }
    const serverUrl = body.url ?? null;
    if (!serverUrl) {
      await markFailed(
        photo.id,
        photo.upload_attempts + 1,
        "Upload OK but response missing url field"
      );
      return { kind: "server-error", message: "Missing url in response" };
    }
    await markUploaded(photo.id, serverUrl, photo.captured_at);
    return { kind: "ok" };
  }

  // Non-2xx — classify and persist.
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    // ignore
  }
  const cls = classifyHttpStatus(response.status, bodyText);
  // classifyHttpStatus can return {kind:"ok"} for 2xx, but we're inside
  // the `!response.ok` branch so it won't. Narrow defensively.
  if (cls.kind === "ok") {
    return cls;
  }
  if (cls.kind === "auth-expired") {
    // Record the error but don't bump attempts — wasn't this photo's fault.
    await db.photos_pending.update(photo.id, {
      last_upload_error: cls.message ?? `HTTP ${response.status}`,
    });
    return cls;
  }
  await markFailed(
    photo.id,
    photo.upload_attempts + 1,
    cls.message ?? `HTTP ${response.status}`
  );
  return cls;
}

async function markUploaded(
  photoId: string,
  serverUrl: string,
  capturedAt: string
): Promise<void> {
  const ageMs = Date.now() - new Date(capturedAt).getTime();
  const clearBlob = ageMs > SEVEN_DAYS_MS;

  const patch: Record<string, unknown> = {
    uploaded: true,
    server_url: serverUrl,
    upload_attempts: 0,
    last_upload_error: null,
    next_attempt_at: null,
  };
  if (clearBlob) {
    patch.blob = new Blob([], { type: "image/jpeg" });
  }

  await db.photos_pending.update(photoId, patch);
}

/**
 * When to try this photo again.
 *
 * Under the threshold, the shared fast backoff (~1s doubling to ~16s)
 * so a blip costs nothing. At or over it, a long fixed interval with
 * the same ±20% jitter: the photo is not given up on, it is simply no
 * longer worth a request every tick while a human is being asked to
 * look at it.
 */
function nextPhotoAttemptAt(attempts: number): string {
  if (attempts < STUCK_THRESHOLD) return nextAttemptAt(attempts);
  const jittered = STUCK_RETRY_MS * (0.8 + Math.random() * 0.4);
  return new Date(Date.now() + jittered).toISOString();
}

async function markFailed(
  photoId: string,
  attempts: number,
  errorMessage: string
): Promise<void> {
  await db.photos_pending.update(photoId, {
    upload_attempts: attempts,
    last_upload_error: errorMessage,
    next_attempt_at: nextPhotoAttemptAt(attempts),
  });
}

/**
 * Periodic cleanup: for uploaded photos older than 7 days that still
 * hold their original Blob, replace with a zero-byte placeholder. Runs
 * at the end of every drain — small enough to be a fold-in cost.
 */
async function cleanupOldBlobs(): Promise<void> {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const stale = await db.photos_pending
    .filter((p) => p.uploaded && p.captured_at < cutoff && photoBlobSize(p.blob) > 0)
    .toArray();
  for (const photo of stale) {
    await db.photos_pending.update(photo.id, {
      blob: new Blob([], { type: "image/jpeg" }),
    });
  }
}
