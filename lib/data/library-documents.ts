import { createClient } from "@/lib/supabase/server";
import type { LibraryDocument } from "@/types/database";

/**
 * Data layer for the site-folder print library (migration 048).
 *
 * Online-only, server-side only — like feature_requests, there is no Dexie
 * mirror. Reads exclude soft-deleted rows in the query (`deleted_at is
 * null`) rather than via an RLS SELECT policy, so the soft-delete below is a
 * plain UPDATE with no SECURITY DEFINER RPC (see migration 048's header).
 */

export async function getLibraryDocuments(): Promise<LibraryDocument[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("library_documents")
    .select("*")
    .is("deleted_at", null)
    // Grouped by category in the UI; uncategorised (null) sorts last via the
    // nulls-last order, then newest-first within each group.
    .order("category", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getLibraryDocuments]", error.code, error.message);
    throw new Error(`Failed to fetch library documents: ${error.message}`);
  }
  return data;
}

export async function getLibraryDocumentById(
  id: string
): Promise<LibraryDocument | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("library_documents")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    console.error("[getLibraryDocumentById]", error.code, error.message);
    throw new Error(`Failed to fetch library document: ${error.message}`);
  }
  return data;
}

export async function createLibraryDocument(input: {
  id: string;
  label: string;
  category?: string | null;
  file_path: string;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploaded_by?: string | null;
}): Promise<LibraryDocument> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("library_documents")
    .insert({
      id: input.id,
      label: input.label.trim(),
      category: input.category?.trim() || null,
      file_path: input.file_path,
      file_name: input.file_name,
      mime_type: input.mime_type ?? null,
      size_bytes: input.size_bytes ?? null,
      uploaded_by: input.uploaded_by ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error("[createLibraryDocument]", error.code, error.message);
    throw new Error(`Failed to save document: ${error.message}`);
  }
  return data;
}

/**
 * Soft-delete a document. A plain `update({ deleted_at })` — safe here (no
 * 42501) because library_documents has NO self-hiding `deleted_at is null`
 * SELECT policy; reads filter it out in the query instead. The stored file
 * is left in the bucket (cheap, recoverable) — restoring the row restores
 * the document.
 */
export async function softDeleteLibraryDocument(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("library_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[softDeleteLibraryDocument]", error.code, error.message);
    throw new Error(`Failed to remove document: ${error.message}`);
  }
}
