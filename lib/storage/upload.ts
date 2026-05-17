import { createClient } from "@/lib/supabase/server";

const BUCKET = "reports";

export async function uploadBase64Image(
  dataUrl: string,
  path: string
): Promise<string> {
  const supabase = await createClient();

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
  const supabase = await createClient();

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
