import { createAdminClient } from "@/lib/supabase/admin";
import { storageObjectPath } from "@/lib/storage/asset-url";

/**
 * Inline every reports-bucket `<img>` in an HTML string as a base64
 * `data:` URI, fetched server-side via the service role (H1).
 *
 * The PDF templates embed photos + signatures as `<img src="…">`.
 * Puppeteer fetches those over HTTP while rendering — impossible now the
 * bucket is private (it would 403 → blank images in the PDF). Resolving
 * the bytes here and inlining them means the renderer needs no bucket
 * access at all. `data:` URIs (logo, footer band) and any non-storage
 * src pass through untouched.
 *
 * ── When an object is missing ──
 *
 * This used to leave the original `src` on a failed download, on the
 * reasoning that one blank image beats a failed render. On a private
 * bucket that leftover src is unfetchable, so Puppeteer draws its
 * broken-image box instead: a grey placeholder with a torn-page icon,
 * printed on a report that goes to the customer.
 *
 * Four completed jobs currently carry twelve photo references whose
 * objects were never uploaded (a 13 July RLS failure exhausted the
 * photo loop's retry budget), so for those the entire "Additional
 * Photos" grid renders as broken boxes. A report with no photo section
 * reads as a report without photos; one with grey broken boxes reads as
 * a broken system.
 *
 * So a failed download now DROPS the `<img>` element entirely, and a
 * section wrapped in the drop-if-empty markers below is removed when
 * nothing inside it resolved. Dropping the reference from the DATABASE
 * is deliberately not done anywhere — the photo ids are the recovery
 * key if the blobs are still on the operator's device.
 */

/**
 * Wrap a block that should disappear when it ends up with no images.
 *
 * HTML comments rather than an attribute on the container: the photo
 * grid is several divs deep, and matching a specific nested element with
 * a regex is the kind of thing that works until a template gains one
 * more wrapper. A comment pair cannot nest with itself, so the match is
 * unambiguous.
 */
export const DROP_IF_EMPTY_OPEN = "<!--drop-if-no-img-->";
export const DROP_IF_EMPTY_CLOSE = "<!--/drop-if-no-img-->";

export function dropIfNoImages(html: string): string {
  return `${DROP_IF_EMPTY_OPEN}${html}${DROP_IF_EMPTY_CLOSE}`;
}

/** Remove any drop-if-empty block left with no `<img` inside, and strip
 *  the markers from the blocks that survive. */
function pruneEmptyBlocks(html: string): string {
  const blockRe = new RegExp(
    `${DROP_IF_EMPTY_OPEN}([\\s\\S]*?)${DROP_IF_EMPTY_CLOSE}`,
    "g"
  );
  return html.replace(blockRe, (_full, inner: string) =>
    inner.includes("<img") ? inner : ""
  );
}

export async function inlineStorageImages(html: string): Promise<string> {
  const imgRe = /<img\b[^>]*?\bsrc="([^"]+)"[^>]*>/gi;
  const srcs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const src = match[1];
    if (src.startsWith("data:")) continue;
    if (storageObjectPath(src)) srcs.add(src);
  }
  if (srcs.size === 0) return pruneEmptyBlocks(html);

  const admin = createAdminClient();
  const replacements = new Map<string, string>();
  /** Storage srcs whose bytes could not be fetched. */
  const missing = new Set<string>();

  await Promise.all(
    [...srcs].map(async (src) => {
      const path = storageObjectPath(src);
      if (!path) return;
      try {
        const { data, error } = await admin.storage
          .from("reports")
          .download(path);
        if (error || !data) {
          missing.add(src);
          return;
        }
        const buffer = Buffer.from(await data.arrayBuffer());
        const ext = path.split(".").pop()?.toLowerCase();
        const mime =
          ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg";
        replacements.set(
          src,
          `data:${mime};base64,${buffer.toString("base64")}`
        );
      } catch {
        // A thrown download (network, transport) is as missing as an
        // error result — never leave an unfetchable src in the HTML.
        missing.add(src);
      }
    })
  );

  if (missing.size > 0) {
    console.warn(
      `[inlineStorageImages] ${missing.size} storage object(s) missing; ` +
        `dropping their <img> elements: ${[...missing]
          .map((s) => storageObjectPath(s))
          .join(", ")}`
    );
  }

  let out = html;

  // Drop the whole element for anything that did not resolve. Done on
  // the tag, not the src, so no dead reference survives into the render.
  if (missing.size > 0) {
    out = out.replace(imgRe, (tag: string, src: string) =>
      missing.has(src) ? "" : tag
    );
  }

  for (const [src, dataUri] of replacements) {
    out = out.split(src).join(dataUri);
  }

  return pruneEmptyBlocks(out);
}
