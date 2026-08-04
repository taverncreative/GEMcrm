/**
 * Recovering photos the upload loop abandoned.
 *
 * `drainPhotos` drops any row past STUCK_THRESHOLD, so once the 13 July
 * RLS failure burned five attempts those photos were skipped forever.
 * The bytes are still in IndexedDB; the only thing missing is a way to
 * ask again.
 *
 * ── A note on how these are wired ──
 *
 * fake-indexeddb under jsdom does not survive a structured clone of a
 * Blob: a row written with one reads back as `{}`. So a blob-bearing row
 * CANNOT be seeded through Dexie here, and pretending otherwise would
 * make every assertion about "are the bytes still there" meaningless.
 * The two layers are therefore tested at their own boundaries:
 *
 *   - `retryPhotoUpload` against a stubbed table read, so the row it sees
 *     holds a real Blob (as it does in a browser);
 *   - the card (in photo-recovery-card.test.tsx) against a stubbed
 *     `retryPhotoUpload` and live query, so it is judged on what it
 *     renders and calls.
 *
 * The jobs table round-trips fine, so the no-database-write proof below
 * uses the real Dexie table.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { db, type PendingPhoto } from "@/lib/db";
import { retryPhotoUpload, drainPhotos } from "@/lib/sync/photos";
import { photoStoragePath } from "@/lib/photos/path";
import { photoBlobSize } from "@/lib/photos/blob-size";
import type { Job } from "@/types/database";

const P1 = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const BASE = "https://x.supabase.co/storage/v1/object/public/reports";

/** A photo abandoned by the loop: five failed attempts, still un-uploaded,
 *  bytes present. This is the shape of the twelve real ones. */
function stuckRow(id: string, over: Partial<PendingPhoto> = {}): PendingPhoto {
  return {
    id,
    parent_type: "job",
    parent_id: JOB_ID,
    blob: new Blob([new Uint8Array(4).fill(7)], { type: "image/jpeg" }),
    mime: "image/jpeg",
    width: 8,
    height: 8,
    captured_at: "2026-07-10T09:00:00.000Z",
    uploaded: false,
    upload_attempts: 5,
    last_upload_error:
      "HTTP 502: new row violates row-level security policy",
    created_at: "2026-07-10T09:00:00.000Z",
    // Far-future backoff: the loop would not touch this even if the
    // attempt ceiling were raised.
    next_attempt_at: "2099-01-01T00:00:00.000Z",
    server_url: null,
    ...over,
  } as PendingPhoto;
}

const fetchMock = vi.fn();

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.photos_pending.clear();
  await db.jobs.clear();
  await db.jobs.add({
    id: JOB_ID,
    reference_number: "00085",
    job_date: "2026-07-10",
    // The reference the completion recorded BEFORE the upload was tried.
    // That ordering is the original bug, and it is also what makes the
    // recovery free: this URL already points at where the retry will put
    // the bytes.
    photo_urls: [`${BASE}/${photoStoragePath(P1)}`],
  } as unknown as Job);

  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ url: `${BASE}/${photoStoragePath(P1)}` }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("the loop will not pick these up on its own", () => {
  it("drainPhotos skips a row past the attempt ceiling", async () => {
    // Seeded without a blob, which is all Dexie can hold here — the
    // ceiling filter runs before anything reads the bytes.
    await db.photos_pending.add({
      ...stuckRow(P1),
      blob: new Blob(),
      next_attempt_at: null,
    } as never);

    const res = await drainPhotos();
    expect(res.attempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("retryPhotoUpload bypasses what blocks the loop", () => {
  function stubRead(row: PendingPhoto | undefined) {
    vi.spyOn(db.photos_pending, "get").mockResolvedValue(
      row as PendingPhoto | undefined
    );
    return vi
      .spyOn(db.photos_pending, "update")
      .mockResolvedValue(1 as unknown as number);
  }

  it("uploads despite five attempts AND a future backoff time", async () => {
    stubRead(stuckRow(P1));
    const res = await retryPhotoUpload(P1);

    expect(res.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/photos/upload");
    // The photoId is what makes the destination key deterministic, and
    // therefore what makes the existing reference resolve.
    expect((init.body as FormData).get("photoId")).toBe(P1);
  });

  it("marks the row uploaded so the loop stops considering it", async () => {
    const update = stubRead(stuckRow(P1));
    await retryPhotoUpload(P1);

    const patch = update.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(patch.uploaded).toBe(true);
    expect(String(patch.server_url)).toContain(photoStoragePath(P1));
  });

  it("needs NO write to the jobs table for the reference to resolve", async () => {
    const before = await db.jobs.get(JOB_ID);
    const jobUpdate = vi.spyOn(db.jobs, "update");
    const jobPut = vi.spyOn(db.jobs, "put");
    stubRead(stuckRow(P1));

    await retryPhotoUpload(P1);

    // Nothing touched the job...
    expect(jobUpdate).not.toHaveBeenCalled();
    expect(jobPut).not.toHaveBeenCalled();
    expect(await db.jobs.get(JOB_ID)).toEqual(before);

    // ...and the key the upload targeted is the one the job already
    // references, which is exactly why no write is needed.
    const uploadedKey = (
      fetchMock.mock.calls[0][1].body as FormData
    ).get("photoId") as string;
    expect(before!.photo_urls[0]).toContain(photoStoragePath(uploadedKey));
  });

  it("refuses a zero-byte blob rather than overwriting the key with nothing", async () => {
    stubRead(stuckRow(P1, { blob: new Blob() }));
    const res = await retryPhotoUpload(P1);

    expect(res.kind).toBe("client-error");
    expect(res.message).toMatch(/no longer on this device/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing row rather than throwing", async () => {
    stubRead(undefined);
    const res = await retryPhotoUpload(P1);
    expect(res.kind).toBe("client-error");
    expect(res.message).toMatch(/not found/i);
  });

  it("leaves the row un-uploaded after a failure, so it stays retryable", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "boom",
    });
    const update = stubRead(stuckRow(P1));
    const res = await retryPhotoUpload(P1);

    expect(res.kind).not.toBe("ok");
    const patch = update.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(patch.uploaded).toBeUndefined();
    expect(patch.last_upload_error).toBeTruthy();
  });
});

describe("photoBlobSize", () => {
  it("counts a real blob and treats anything else as empty", () => {
    expect(photoBlobSize(new Blob([new Uint8Array(3)]))).toBe(3);
    expect(photoBlobSize(new Blob())).toBe(0);
    // The shape fake-indexeddb hands back, and the shape a pre-schema row
    // could hold. Counting these as "present" would let an empty upload
    // overwrite the only key still pointing at the missing photo.
    expect(photoBlobSize({})).toBe(0);
    expect(photoBlobSize(undefined)).toBe(0);
    expect(photoBlobSize(null)).toBe(0);
  });
});

