"use client";

/**
 * Photo capture for offline-first.
 *
 * `capturePhoto(file, parentType, parentId)` compresses the image
 * (max 1600px, JPEG 0.82) and stashes the resulting Blob in
 * `photos_pending`. Returns the client-generated photo id, which the
 * caller appends to the parent row's photo refs (e.g. a job's
 * `photo_urls` array).
 *
 * Step 6's sync engine reads `photos_pending` and uploads each row's
 * blob to Supabase Storage, then swaps the local id for the resulting
 * public URL in the parent's photo refs.
 *
 * Compression rationale: pest-control service-sheet photos are
 * documentary, not artistic — 1600px max dimension + JPEG 0.82 is
 * indistinguishable to a customer reading the report PDF, drops the
 * average file size from ~4 MB (modern iPhone photo) to ~250 KB, and
 * makes the offline outbox + Supabase upload both ~16× cheaper. Keeps
 * a day-in-the-van's photos comfortably in IndexedDB.
 */

import { db } from "@/lib/db";
import { newId } from "@/lib/utils/id";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

export type PhotoParentType = "job" | "service_sheet" | "agreement_signature";

/**
 * Capture a photo File into local storage. Returns the photo id.
 *
 * Use the returned id as the photo reference on the parent row
 * (e.g. `job.photo_urls = [...existing, photoId]`). The local UI can
 * render the blob via `getPhotoSrc()` from `lib/photos/src.ts`; once
 * the sync engine uploads the blob, the id gets swapped for the
 * Storage URL transparently.
 */
export async function capturePhoto(
  file: File,
  parentType: PhotoParentType,
  parentId: string
): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("capturePhoto must be called client-side");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error(`Expected image file, got ${file.type}`);
  }

  const compressed = await compressImage(file);
  const id = newId();
  const now = new Date().toISOString();

  await db.photos_pending.add({
    id,
    parent_type: parentType,
    parent_id: parentId,
    blob: compressed.blob,
    mime: compressed.mime,
    width: compressed.width,
    height: compressed.height,
    captured_at: now,
    uploaded: false,
    upload_attempts: 0,
    last_upload_error: null,
    created_at: now,
  });

  return id;
}

interface CompressedImage {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
}

/**
 * Resize → re-encode as JPEG. Uses an offscreen canvas to keep the
 * full-resolution image out of the main thread for as little time as
 * possible (the actual drawImage call is sync, but it's quick at
 * 1600px target).
 *
 * If the image is already smaller than MAX_DIMENSION we still re-encode
 * to JPEG 0.82 — most input is HEIC/PNG/raw-iPhone-JPEG-at-max-quality,
 * none of which are storage-efficient.
 */
async function compressImage(file: File): Promise<CompressedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(
      MAX_DIMENSION / img.naturalWidth,
      MAX_DIMENSION / img.naturalHeight,
      1
    );
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not obtain 2D canvas context");
    }
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) {
      throw new Error("canvas.toBlob returned null");
    }

    return { blob, mime: "image/jpeg", width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
