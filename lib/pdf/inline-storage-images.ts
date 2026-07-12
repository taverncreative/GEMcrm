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
 * src pass through untouched; a download failure leaves the original src
 * so the render still succeeds (that one image is blank, not fatal).
 */
export async function inlineStorageImages(html: string): Promise<string> {
  const imgRe = /<img\b[^>]*?\bsrc="([^"]+)"[^>]*>/gi;
  const srcs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const src = match[1];
    if (src.startsWith("data:")) continue;
    if (storageObjectPath(src)) srcs.add(src);
  }
  if (srcs.size === 0) return html;

  const admin = createAdminClient();
  const replacements = new Map<string, string>();
  await Promise.all(
    [...srcs].map(async (src) => {
      const path = storageObjectPath(src);
      if (!path) return;
      const { data, error } = await admin.storage
        .from("reports")
        .download(path);
      if (error || !data) return; // leave src as-is; blank image, not fatal
      const buffer = Buffer.from(await data.arrayBuffer());
      const ext = path.split(".").pop()?.toLowerCase();
      const mime =
        ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";
      replacements.set(src, `data:${mime};base64,${buffer.toString("base64")}`);
    })
  );

  let out = html;
  for (const [src, dataUri] of replacements) {
    out = out.split(src).join(dataUri);
  }
  return out;
}
