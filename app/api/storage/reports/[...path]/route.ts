import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Auth-gated proxy for the PRIVATE `reports` Storage bucket (H1).
 *
 * The bucket holds customer PII — service reports, signed agreements,
 * invoices, site photos, signatures. It is no longer public-read, so the
 * app streams objects through here: `requireUser()` gates access
 * (logged-out → redirect to /login), then the service-role client
 * downloads the object (bypassing Storage RLS) and we stream the bytes
 * back. Nothing signed is ever exposed to the browser — the object URL
 * stays server-side. Used as the `src`/`href` for every in-app photo,
 * signature, and PDF via `proxyAssetUrl()`.
 */

const BUCKET = "reports";

function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  await requireUser();

  const { path } = await params;
  const objectPath = (path ?? []).join("/");
  // Defence in depth — the service role can't traverse out of the bucket
  // anyway, but reject obviously malformed keys.
  if (!objectPath || objectPath.includes("..")) {
    return new Response("Bad request", { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(objectPath);
  if (error || !data) {
    return new Response("Not found", { status: 404 });
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentTypeFor(objectPath),
      // Private object: only the authenticated user's browser may cache,
      // and only briefly (the proxy re-checks auth on the next request).
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": "inline",
    },
  });
}
