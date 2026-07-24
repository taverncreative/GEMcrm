import { createAdminClient } from "@/lib/supabase/admin";
import { createLibraryDocument } from "@/lib/data/library-documents";
import { newId } from "@/lib/utils/id";
import {
  MAX_UPLOAD_BYTES,
  contentTypeForPath,
  isAllowedUpload,
  sanitizeFileName,
} from "@/lib/library/file-types";
import type { LibraryDocument } from "@/types/database";

const BUCKET = "reports";

/** Minimal structural view of an uploaded file — the fields we need from a
 *  DOM/undici File, so this core is unit-testable without a real Request. */
export interface UploadFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type LibraryUploadResult =
  | { ok: true; document: LibraryDocument }
  | { ok: false; status: number; error: string };

/**
 * Core of the library upload: validate, store the file in the private
 * `reports` bucket at library/<id>/<name>, and insert the library_documents
 * row. Factored out of the route so it can be tested directly (the route is
 * a thin multipart adapter, mirroring app/api/photos/upload).
 *
 * The document id is generated here and used BOTH as the row id and the
 * storage path segment, so a document's bytes and its record share one
 * stable id — the id later sent to Spotlight as each order line's
 * `reference` (stable across label renames).
 *
 * Order: upload first, then insert the row. If the insert fails after a
 * successful upload the file is a harmless orphan (invisible, overwritten on
 * a fresh upload) — acceptable for a low-frequency admin action, and far
 * better than a row pointing at a file that never landed.
 */
export async function handleLibraryUpload(input: {
  label: string;
  category?: string | null;
  file: UploadFile;
  uploadedBy?: string | null;
}): Promise<LibraryUploadResult> {
  const label = input.label.trim();
  if (!label) {
    return { ok: false, status: 400, error: "A label is required" };
  }
  if (!input.file || typeof input.file.arrayBuffer !== "function") {
    return { ok: false, status: 400, error: "No file provided" };
  }

  const fileName = sanitizeFileName(input.file.name);
  if (!isAllowedUpload(fileName)) {
    return {
      ok: false,
      status: 415,
      error: "Unsupported file type. Allowed: PDF, Word, Excel, images.",
    };
  }
  if (input.file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `File too large (max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB)`,
    };
  }

  const id = newId();
  const path = `library/${id}/${fileName}`;
  // Prefer the browser-reported type, but fall back to the extension-derived
  // MIME so a stored object always carries a sensible content type.
  const contentType = input.file.type || contentTypeForPath(fileName);

  const admin = createAdminClient();
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (uploadError) {
    console.error("[handleLibraryUpload] upload", uploadError.message);
    return { ok: false, status: 502, error: "Upload failed. Try again." };
  }

  try {
    const document = await createLibraryDocument({
      id,
      label,
      category: input.category ?? null,
      file_path: path,
      file_name: fileName,
      mime_type: contentType,
      size_bytes: input.file.size,
      uploaded_by: input.uploadedBy ?? null,
    });
    return { ok: true, document };
  } catch (err) {
    console.error("[handleLibraryUpload] insert", err);
    return {
      ok: false,
      status: 500,
      error: "Uploaded, but saving the record failed. Try again.",
    };
  }
}
