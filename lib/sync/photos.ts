"use client";

/**
 * Photo upload loop — stub.
 *
 * Real implementation lands in commit 4b after the `/api/photos/upload`
 * endpoint and the capturePhoto path-determinism fix (commit 4a). The
 * stub exists now so `lib/sync/engine.ts` can statically import + call
 * `drainPhotos` without TypeScript complaining about a missing module.
 *
 * Behaviour of the stub: no-op. Returns immediately. Once commit 4b
 * lands this is replaced by the real concurrency-2 multipart uploader.
 */

export interface PhotoResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export async function drainPhotos(): Promise<PhotoResult> {
  return { attempted: 0, succeeded: 0, failed: 0 };
}
