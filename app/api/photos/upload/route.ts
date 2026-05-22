/**
 * POST /api/photos/upload
 *
 * Photo upload endpoint for the offline sync engine's photos loop.
 * Accepts multipart form-data containing `photoId` + `file`, uploads
 * the blob to Supabase Storage at the deterministic path
 * `photos/<photoId>.jpg`, and returns the public URL.
 *
 * Auth: requireUser() — only authenticated callers. Photos go into the
 * public `reports` bucket so the resulting URL is readable without a
 * signed link (matches the PDF + signature upload pattern in
 * lib/storage/upload.ts).
 *
 * Why a route rather than a server action for this?
 *
 *   - Server actions can't receive raw Blobs cleanly — they go through
 *     React's RSC serialisation, which doesn't preserve File metadata
 *     correctly for opaque binary blobs.
 *   - The photos loop is a pure-network transport — it wants
 *     fetch+multipart, not the action calling convention.
 *   - Concurrency-2 throttling at the loop side is straightforward
 *     with fetch promises.
 *
 * Idempotency: the upload is `upsert: true` so retries after a partial
 * failure (e.g. timeout mid-upload) overwrite cleanly. Photo id is
 * stable across retries (it's the client-generated UUID stored in
 * photos_pending), so a re-attempt always lands at the same path.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import {
  isPhotoClientId,
  photoStoragePath,
  PHOTO_BUCKET,
} from "@/lib/photos/path";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  // Auth: throws on no session; catches surface as 401.
  try {
    await requireUser();
  } catch {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid multipart body",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }

  const photoIdRaw = formData.get("photoId");
  const fileRaw = formData.get("file");

  if (typeof photoIdRaw !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'photoId' field" },
      { status: 400 }
    );
  }
  if (!isPhotoClientId(photoIdRaw)) {
    return NextResponse.json(
      { error: "photoId must be a UUID" },
      { status: 400 }
    );
  }
  if (!(fileRaw instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing or invalid 'file' field" },
      { status: 400 }
    );
  }

  // Reasonable upper bound — capturePhoto compresses to ~250KB-1MB for
  // most phones; ~10MB caps any pathological input. Storage will reject
  // very large uploads anyway but rejecting here surfaces a clear error.
  const MAX_BYTES = 10 * 1024 * 1024;
  if (fileRaw.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large: ${fileRaw.size} bytes (max ${MAX_BYTES})` },
      { status: 413 }
    );
  }

  const path = photoStoragePath(photoIdRaw);
  const supabase = await createClient();

  // Convert Blob → ArrayBuffer for the Supabase upload (the Node-side
  // SDK accepts Buffer or Uint8Array).
  const buffer = Buffer.from(await fileRaw.arrayBuffer());

  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, buffer, {
      contentType: fileRaw.type || "image/jpeg",
      upsert: true,
    });

  if (error) {
    console.error("[POST /api/photos/upload]", error.message);
    return NextResponse.json(
      { error: `Upload failed: ${error.message}` },
      { status: 502 }
    );
  }

  const { data: urlData } = supabase.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(path);

  return NextResponse.json({
    photoId: photoIdRaw,
    path,
    url: urlData.publicUrl,
  });
}
