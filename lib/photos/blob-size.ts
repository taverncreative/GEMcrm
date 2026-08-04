/**
 * Byte count for a stored photo blob, defensively.
 *
 * `photos_pending.blob` is a Blob in the browser, but a row can come back
 * as a plain object after a structured clone in some environments (and a
 * row written by an older schema may not hold a Blob at all). Both the
 * recovery UI and the retry path branch on "are the bytes still here", so
 * a thrown property access there would either crash the card or, worse,
 * let an empty upload overwrite the one key that still points at the
 * missing photo. Unknown shapes count as zero, which is the safe answer.
 */
export function photoBlobSize(blob: unknown): number {
  if (typeof Blob !== "undefined" && blob instanceof Blob) return blob.size;
  if (blob && typeof (blob as { size?: unknown }).size === "number") {
    return (blob as { size: number }).size;
  }
  return 0;
}
