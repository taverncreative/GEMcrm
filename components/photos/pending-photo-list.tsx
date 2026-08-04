"use client";

/**
 * The list of photos that are still only on this device, plus the
 * machinery to send them.
 *
 * Shared by the two surfaces that show pending photos, so they cannot
 * drift apart:
 *   - the recovery card in Settings, which lists everything pending;
 *   - the stuck section of /sync/conflicts, which lists only the ones
 *     that have given the operator a reason to worry.
 *
 * The framing copy lives with each caller; everything below the heading
 * is the same in both, because "retry this photo" means the same thing
 * wherever it is pressed.
 *
 * Retry goes through `retryPhotoUpload`, which ignores the backoff
 * clock. The upload key is derived from the photo id and the parent
 * record's `photo_urls` already holds the URL for that key, so a
 * success makes the existing reference resolve with no database write.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type PendingPhoto } from "@/lib/db";
import { retryPhotoUpload } from "@/lib/sync/photos";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { photoBlobSize } from "@/lib/photos/blob-size";

type RowState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "failed"; message: string };

/** "3 weeks ago" — coarse is fine, this is orientation not precision. */
export function ageLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/**
 * Job reference numbers for the rows on screen, so a photo can be placed
 * against a real visit rather than a UUID.
 */
export function useJobRefs(
  photos: PendingPhoto[] | undefined
): Record<string, string> | undefined {
  return useLiveQuery(async () => {
    if (!photos || photos.length === 0) return {};
    const ids = [...new Set(photos.map((p) => p.parent_id))];
    const out: Record<string, string> = {};
    for (const id of ids) {
      const job = await db.jobs.get(id);
      if (job) out[id] = job.reference_number || job.job_date || id.slice(0, 8);
    }
    return out;
  }, [photos]);
}

function PhotoThumb({ photo }: { photo: PendingPhoto }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (photoBlobSize(photo.blob) === 0) return;
    let url: string;
    try {
      url = URL.createObjectURL(photo.blob);
    } catch {
      // Not a usable Blob — show the "no data" tile instead of crashing.
      return;
    }
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (!src) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-center text-[10px] leading-tight text-gray-400">
        no data
      </div>
    );
  }
  return (
    // The whole point of the preview is to prove the bytes are still
    // here, so it renders straight from the local blob.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Photo waiting to upload"
      className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover"
    />
  );
}

export interface PendingPhotoListProps {
  photos: PendingPhoto[];
  /** Heading for this surface. The framing differs; the rows do not. */
  title: string;
  /** The honest sentence under the heading, in the caller's own terms. */
  intro: React.ReactNode;
  /** Red border when the photos are stuck, neutral when merely queued. */
  tone?: "neutral" | "alarm";
}

/**
 * Renders nothing when there is nothing to show. That decision lives
 * here rather than in the callers because `sent` lives here: a caller
 * that unmounted the list as soon as its live query emptied would take
 * the "Uploaded" confirmation down with it, which is the bug this
 * component's `sent` snapshot exists to prevent.
 */
export function PendingPhotoList({
  photos,
  title,
  intro,
  tone = "neutral",
}: PendingPhotoListProps) {
  const online = useIsOnline();
  const jobRefs = useJobRefs(photos);
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [busyAll, setBusyAll] = useState(false);
  // A row that uploads successfully leaves its caller's live query
  // immediately (it is no longer pending), which would take the
  // confirmation with it and leave the operator staring at a shorter
  // list wondering what happened. Keep a snapshot of what we sent so the
  // "Uploaded" line stays on screen until he navigates away.
  const [sent, setSent] = useState<PendingPhoto[]>([]);

  const recoverable = useMemo(
    () => photos.filter((p) => photoBlobSize(p.blob) > 0),
    [photos]
  );

  const retryOne = useCallback(async (photo: PendingPhoto) => {
    setStates((s) => ({ ...s, [photo.id]: { kind: "working" } }));
    const res = await retryPhotoUpload(photo.id);
    setStates((s) => ({
      ...s,
      [photo.id]:
        res.kind === "ok"
          ? { kind: "done" }
          : { kind: "failed", message: res.message ?? "Upload failed" },
    }));
    if (res.kind === "ok") {
      setSent((prev) =>
        prev.some((p) => p.id === photo.id) ? prev : [...prev, photo]
      );
    }
    return res.kind === "ok";
  }, []);

  const retryAll = useCallback(async () => {
    setBusyAll(true);
    // Sequential on purpose: this runs on a phone on mobile data, and
    // the operator wants to watch each one land.
    for (const photo of recoverable) {
      await retryOne(photo);
    }
    setBusyAll(false);
  }, [recoverable, retryOne]);

  const lost = photos.length - recoverable.length;
  // Sent rows are appended so their confirmation survives leaving the
  // live query. De-duplicated by id rather than assumed disjoint: there
  // is a real window between the upload landing and the live query
  // re-running where a row is in BOTH lists, and it would render twice.
  const rows = [...photos, ...sent].filter(
    (photo, i, all) => all.findIndex((p) => p.id === photo.id) === i
  );

  if (rows.length === 0) return null;

  return (
    <div
      className={`rounded-xl bg-white p-5 shadow-sm${
        tone === "alarm" ? " border border-red-200" : ""
      }`}
    >
      <h2
        className={`text-sm font-semibold${
          tone === "alarm" ? " text-red-900" : " text-gray-900"
        }`}
      >
        {title}
      </h2>
      <p className="mt-1 text-sm text-gray-500">{intro}</p>

      {!online && (
        <p className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          You&rsquo;re offline, so uploading needs a connection. The photos
          stay safely on this device until you&rsquo;re back online.
        </p>
      )}

      {lost > 0 && (
        <p className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          {lost === 1
            ? "One photo below no longer has its image data on this device and cannot be recovered."
            : `${lost} photos below no longer have their image data on this device and cannot be recovered.`}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {rows.map((photo) => {
          const state = states[photo.id] ?? { kind: "idle" };
          const empty = photoBlobSize(photo.blob) === 0;
          return (
            <li
              key={photo.id}
              className="flex items-center gap-3 rounded-lg border border-gray-100 p-3"
            >
              <PhotoThumb photo={photo} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {jobRefs?.[photo.parent_id]
                    ? `Job ${jobRefs[photo.parent_id]}`
                    : "Photo"}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Taken {ageLabel(photo.captured_at)}
                  {photo.upload_attempts > 0
                    ? ` · ${photo.upload_attempts} failed attempt${
                        photo.upload_attempts === 1 ? "" : "s"
                      }`
                    : ""}
                </p>
                {state.kind === "done" && (
                  <p className="mt-1 text-xs font-medium text-brand-darker">
                    Uploaded. The service sheet shows it now.
                  </p>
                )}
                {state.kind === "failed" && (
                  <p className="mt-1 text-xs text-red-600">{state.message}</p>
                )}
                {state.kind !== "failed" &&
                  state.kind !== "done" &&
                  photo.last_upload_error && (
                    <p className="mt-1 truncate text-xs text-gray-400">
                      Last error: {photo.last_upload_error}
                    </p>
                  )}
              </div>
              <button
                type="button"
                onClick={() => void retryOne(photo)}
                disabled={
                  empty ||
                  !online ||
                  busyAll ||
                  state.kind === "working" ||
                  state.kind === "done"
                }
                className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state.kind === "working"
                  ? "Sending…"
                  : state.kind === "done"
                    ? "Done"
                    : "Retry"}
              </button>
            </li>
          );
        })}
      </ul>

      {recoverable.length > 1 && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void retryAll()}
            disabled={!online || busyAll}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAll ? "Sending…" : `Retry all ${recoverable.length}`}
          </button>
        </div>
      )}
    </div>
  );
}
