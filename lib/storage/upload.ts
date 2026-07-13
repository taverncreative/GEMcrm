import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "reports";

// Writes go through the service-role admin client, NOT the user-JWT SSR
// client. The `reports` bucket is private with an INSERT policy scoped to
// `authenticated` only (H1 moved reads to a service-role proxy to close a
// PII hole; the anon INSERT policy stays REMOVED). On the field
// sync-replay path the user token doesn't reliably reach the Storage API,
// so a user-client upload arrives as anon and is rejected with 42501
// "new row violates row-level security policy". Every caller here is
// already behind a requireUser()-gated server action/route, so using the
// admin client is safe and does not widen who can upload.

export async function uploadBase64Image(
  dataUrl: string,
  path: string
): Promise<string> {
  const supabase = createAdminClient();

  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    console.error("[uploadBase64Image]", error.message);
    throw new Error(`Failed to upload image: ${error.message}`);
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

export async function uploadPdf(
  buffer: Buffer,
  path: string
): Promise<string> {
  const supabase = createAdminClient();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    console.error("[uploadPdf]", error.message);
    throw new Error(`Failed to upload PDF: ${error.message}`);
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}
