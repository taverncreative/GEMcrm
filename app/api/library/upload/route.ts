/**
 * POST /api/library/upload
 *
 * Multipart upload endpoint for the site-folder print library. Accepts
 * `label`, optional `category`, and `file`; validates + stores the file in
 * the private `reports` bucket at library/<id>/<name> and inserts the
 * library_documents row. Returns the created row.
 *
 * A route rather than a server action for the same reason as the photos
 * upload: a raw File can't cross React's RSC serialisation cleanly. The
 * upload + insert core lives in lib/library/upload.ts (unit-tested there);
 * this is the thin auth + multipart adapter.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { handleLibraryUpload } from "@/lib/library/upload";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart body" },
      { status: 400 }
    );
  }

  const label = (formData.get("label") as string) ?? "";
  const categoryRaw = formData.get("category");
  const category = typeof categoryRaw === "string" ? categoryRaw : null;
  const fileRaw = formData.get("file");
  if (!(fileRaw instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing or invalid 'file' field" },
      { status: 400 }
    );
  }

  // A FormData File is a Blob with name/type; give a sane fallback name.
  const file = fileRaw as File;
  const result = await handleLibraryUpload({
    label,
    category,
    file: {
      name: file.name || "document",
      type: file.type,
      size: file.size,
      arrayBuffer: () => file.arrayBuffer(),
    },
    uploadedBy: user.email ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ document: result.document });
}
