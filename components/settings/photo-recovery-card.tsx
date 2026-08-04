"use client";

/**
 * Recover photos that never made it to the server.
 *
 * On 13 July an RLS failure made every photo upload fail. The loop's
 * five-attempt ceiling was burned in a couple of minutes, hours before
 * the fix shipped, and `drainPhotos` has skipped those rows ever since:
 * they are stuck by policy, not by any remaining fault. Twelve photos
 * across four completed jobs are in that state, and their bytes only
 * ever existed in this device's IndexedDB.
 *
 * ── Why this lives in Settings and not a dev route ──
 *
 * The blobs are on the OPERATOR's phone. A recovery tool he cannot reach
 * from the phone recovers nothing, so a desktop-only or hidden dev screen
 * would be the wrong shape entirely.
 *
 * It is also self-hiding: with nothing pending, the card renders nothing
 * at all, so Settings gains no permanent clutter. It appears exactly when
 * there is something to do, which is also what makes it useful beyond
 * this one incident — any future stuck photo surfaces here rather than
 * sitting invisible behind a count in the sync popover.
 *
 * ── Why no database write ──
 *
 * The Storage key is derived from the photo id, and the job's
 * `photo_urls` already contains the URL for that exact key (the
 * completion recorded it before the upload was attempted — that ordering
 * is the original bug). So a successful upload makes the existing
 * reference resolve on its own. This component never touches the jobs
 * table.
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
function ageLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
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

export function PhotoRecoveryCard() {
  const online = useIsOnline();
  const pending = useLiveQuery(
    () => db.photos_pending.filter((p) => !p.uploaded).toArray(),
    []
  );
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [busyAll, setBusyAll] = useState(false);
  // A row that uploads successfully leaves the live query immediately (it
  // is no longer pending), which would take the confirmation with it and
  // leave the operator staring at a shorter list wondering what happened.
  // Keep a snapshot of what we sent so the "Uploaded" line stays on screen
  // until he navigates away.
  const [sent, setSent] = useState<PendingPhoto[]>([]);

  // Job reference numbers for the rows on screen, so a photo can be
  // placed against a real visit rather than a UUID.
  const jobRefs = useLiveQuery(async () => {
    if (!pending || pending.length === 0) return {};
    const ids = [...new Set(pending.map((p) => p.parent_id))];
    const out: Record<string, string> = {};
    for (const id of ids) {
      const job = await db.jobs.get(id);
      if (job) out[id] = job.reference_number || job.job_date || id.slice(0, 8);
    }
    return out;
  }, [pending]);

  const recoverable = useMemo(
    () => (pending ?? []).filter((p) => photoBlobSize(p.blob) > 0),
    [pending]
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

  // Nothing pending and nothing sent this visit → render nothing. Settings
  // gains no clutter, and the card's presence is itself the signal that
  // something needs doing.
  if (!pending || (pending.length === 0 && sent.length === 0)) return null;

  const lost = (pending ?? []).length - recoverable.length;
  // Sent rows are appended so their confirmation survives leaving the
  // live query. De-duplicated by id rather than assumed disjoint: there
  // is a real window between the upload landing and the live query
  // re-running where a row is in BOTH lists, and it would render twice.
  const rows = [...(pending ?? []), ...sent].filter(
    (photo, i, all) => all.findIndex((p) => p.id === photo.id) === i
  );

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">
        Photos waiting to upload
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        These photos are still on this device but never reached the server.
        Retrying sends them now. Nothing else needs changing: each one goes
        back to the exact place its service sheet already points at.
      </p>

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
