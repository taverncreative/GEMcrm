/**
 * Site-folder print library — file-type rules, shared by the upload route
 * (what may be uploaded), the storage proxy (how a stored object is served),
 * and the library UI (a human label per document).
 *
 * PURE and dependency-free so both a route and a "use client" component can
 * import it. Site folders realistically hold PDFs, Word (.doc/.docx), Excel
 * (.xls/.xlsx), and images, so those are the allowed set.
 */

/** Extension to MIME. Superset of the reports proxy's original pdf/image map,
 *  extended with the Office types the library accepts. */
const EXT_CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** The upload allow-list (by lower-case extension). */
export const ALLOWED_EXTENSIONS = Object.keys(EXT_CONTENT_TYPE);

/**
 * Upload size cap: 25 MB. Site-folder documents are often image-heavy PDFs
 * (scanned safety data sheets, method statements), which run larger than a
 * single service-report PDF, so the photo route's 10 MB is too tight; 25 MB
 * comfortably covers a real site folder while still rejecting pathological
 * input. Storage would reject a truly huge upload anyway; this surfaces a
 * clear error first.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Lower-case extension of a filename (no dot), or "" if none. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/** MIME type for a stored object path/filename. Unknown maps to octet-stream. */
export function contentTypeForPath(path: string): string {
  return EXT_CONTENT_TYPE[extensionOf(path)] ?? "application/octet-stream";
}

/** Is this filename an allowed library upload (by extension)? */
export function isAllowedUpload(fileName: string): boolean {
  return ALLOWED_EXTENSIONS.includes(extensionOf(fileName));
}

/**
 * Make a filename safe to use as a Storage object name and as an email /
 * download filename: strip any path, keep letters/digits/space and a
 * readable punctuation set, and drop everything else (control characters,
 * quotes, and the filesystem-hostile characters that would break a Storage
 * object name). Falls back to "document" if nothing usable remains.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base
    .replace(/[^A-Za-z0-9 ._()-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "document";
}

/** Short human label for a document's kind, for the list UI. */
export function prettyType(fileName: string): string {
  const ext = extensionOf(fileName);
  switch (ext) {
    case "pdf":
      return "PDF";
    case "doc":
    case "docx":
      return "Word";
    case "xls":
    case "xlsx":
      return "Excel";
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "gif":
      return "Image";
    default:
      return ext ? ext.toUpperCase() : "File";
  }
}
