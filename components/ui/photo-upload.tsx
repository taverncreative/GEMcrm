"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { capturePhoto, type PhotoParentType } from "@/lib/db/photos";
import { db } from "@/lib/db";

interface PhotoUploadProps {
  /** Where this photo set is attached — used by `capturePhoto` to
   *  tag the photos_pending row so the sync engine can group / clean
   *  up by parent. */
  parentType: PhotoParentType;
  /** Stable id of the parent record (jobId for a service sheet). */
  parentId: string;
  /** Called with the list of client UUIDs whenever the photo list
   *  changes. The form serialises these into the `photo_data_urls`
   *  hidden field — server-side `writeServiceSheet` resolves each
   *  UUID to a Storage URL via `getPublicUrl`. */
  onChange: (photoIds: string[]) => void;
}

const MAX_FILES = 10;
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB per file
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

interface QueuedPhoto {
  /** Client-generated UUID stored in photos_pending. Goes into the
   *  form's `photo_data_urls` hidden field. */
  id: string;
  /** Object URL minted from the compressed blob, for the preview tile.
   *  Revoked when the photo is removed or the component unmounts. */
  src: string;
  name: string;
  size: number;
}

/**
 * Photo picker for the service-sheet form.
 *
 * **Offline-first**: every file goes through `capturePhoto()` which
 *   1. compresses to 1600px JPEG q=0.82 (~16× smaller than a raw iPhone
 *      photo),
 *   2. stashes the resulting Blob in IndexedDB's `photos_pending`,
 *   3. returns a client-generated UUID.
 *
 * The UUID is what gets handed to the parent via `onChange` — the form
 * stores these in a hidden `photo_data_urls` field and submits them
 * through the wrapped action. The sync engine's photos loop uploads
 * the blob in parallel; the server-side action replay computes the
 * Storage URL from the UUID directly. End-to-end offline.
 *
 * Preview tiles use an Object URL minted from the compressed blob.
 * Object URLs are revoked on remove / unmount to avoid leaking memory.
 *
 * Removing a photo from the picker also deletes its photos_pending
 * row — there's no point letting the sync engine upload a blob the
 * user has explicitly discarded.
 */
export function PhotoUpload({
  parentType,
  parentId,
  onChange,
}: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Track all Object URLs we've minted so unmount can revoke them.
  // setPhotos handles the per-photo case; this handles tab close /
  // navigate-away.
  const ownedSrcsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const owned = ownedSrcsRef.current;
    return () => {
      for (const src of owned) URL.revokeObjectURL(src);
      owned.clear();
    };
  }, []);

  const publish = useCallback(
    (list: QueuedPhoto[]) => {
      setPhotos(list);
      onChange(list.map((p) => p.id));
    },
    [onChange]
  );

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const input = Array.from(files);
    const room = MAX_FILES - photos.length;
    if (room <= 0) {
      setError(`Maximum ${MAX_FILES} photos per job.`);
      return;
    }

    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of input.slice(0, room)) {
      if (!ACCEPTED.includes(f.type) && !f.type.startsWith("image/")) {
        rejected.push(`${f.name}: unsupported type`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        rejected.push(`${f.name}: over 8 MB`);
        continue;
      }
      accepted.push(f);
    }

    setIsBusy(true);
    try {
      const loaded: QueuedPhoto[] = [];
      for (const f of accepted) {
        // capturePhoto compresses + stores blob in photos_pending,
        // returns the client UUID. Sequential rather than Promise.all
        // because compression is canvas-bound and parallel work just
        // contends for the same main-thread canvas.
        const id = await capturePhoto(f, parentType, parentId);
        // Read back the freshly-stored blob to mint a preview URL.
        const row = await db.photos_pending.get(id);
        if (!row) {
          rejected.push(`${f.name}: capture failed`);
          continue;
        }
        const src = URL.createObjectURL(row.blob);
        ownedSrcsRef.current.add(src);
        loaded.push({ id, src, name: f.name, size: f.size });
      }
      publish([...photos, ...loaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to capture photos");
    } finally {
      setIsBusy(false);
    }

    if (rejected.length > 0) {
      setError((prev) =>
        [prev, rejected.join(" · ")].filter(Boolean).join(" · ")
      );
    }
  }

  async function removeAt(id: string) {
    const photo = photos.find((p) => p.id === id);
    if (photo) {
      URL.revokeObjectURL(photo.src);
      ownedSrcsRef.current.delete(photo.src);
      // Drop the photos_pending row too — the user has discarded this
      // photo, no point letting the sync engine upload it.
      try {
        await db.photos_pending.delete(id);
      } catch {
        // Non-fatal — the row may already be gone if sync raced us.
      }
    }
    publish(photos.filter((p) => p.id !== id));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      void addFiles(e.dataTransfer.files);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      void addFiles(e.target.files);
    }
    // reset so selecting the same file twice still triggers onChange
    e.target.value = "";
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        disabled={isBusy}
        className={`block w-full rounded-xl border-2 border-dashed p-8 text-center transition-colors disabled:cursor-wait disabled:opacity-70 ${
          isDragging
            ? "border-brand bg-brand-soft"
            : "border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
        }`}
      >
        <svg
          className="mx-auto h-10 w-10 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
          />
        </svg>
        <p className="mt-3 text-sm font-medium text-gray-700">
          {isBusy
            ? "Compressing…"
            : isDragging
            ? "Drop to add"
            : "Drag photos here, or click to browse"}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Up to {MAX_FILES} photos · 8 MB each · saved locally first
        </p>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onInputChange}
      />

      {error && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
          {error}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo) => (
            <li
              key={photo.id}
              className="group relative overflow-hidden rounded-lg border border-gray-200 bg-white"
            >
              <div className="relative aspect-square w-full">
                <Image
                  src={photo.src}
                  alt={photo.name}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <button
                type="button"
                onClick={() => void removeAt(photo.id)}
                aria-label={`Remove ${photo.name}`}
                className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
              <p className="truncate px-2 py-1 text-[11px] text-gray-500">
                {photo.name}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
