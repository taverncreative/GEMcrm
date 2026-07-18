import { createClient } from "@/lib/supabase/server";
import { newId } from "@/lib/utils/id";

export type RequestType = "feature" | "bug" | "change";
export type RequestStatus = "pending" | "addressed" | "declined";

export interface FeatureRequest {
  id: string;
  created_at: string;
  request_type: RequestType;
  message: string;
  status: RequestStatus;
  submitter_email: string | null;
}

export async function createFeatureRequest(input: {
  request_type: RequestType;
  message: string;
  submitter_email?: string | null;
}): Promise<FeatureRequest> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feature_requests")
    .insert({
      id: newId(),
      request_type: input.request_type,
      message: input.message.trim(),
      submitter_email: input.submitter_email ?? null,
    })
    .select()
    .single();
  if (error) {
    console.error("[createFeatureRequest]", error.code, error.message);
    throw new Error(`Failed to log request: ${error.message}`);
  }
  return data;
}

/**
 * HARD delete one request. Unlike the five syncable tables, feature_requests
 * has no deleted_at column and a single permissive RLS policy (setup.sql
 * §022: `for all to authenticated using(true) with check(true)`), so a plain
 * authenticated delete works — no SECURITY DEFINER RPC needed. The row is
 * the operator's own feedback and the request already lives on in Spotlight
 * and the developer inbox, so losing the local copy loses nothing.
 */
export async function deleteFeatureRequest(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("feature_requests")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[deleteFeatureRequest]", error.code, error.message);
    throw new Error(`Failed to delete request: ${error.message}`);
  }
}

/**
 * HARD delete every request (the "Clear all" action). PostgREST refuses an
 * unfiltered DELETE, so filter on the primary key being present — true for
 * every row. Returns how many rows went, for the confirmation message.
 */
export async function clearFeatureRequests(): Promise<number> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("feature_requests")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (error) {
    console.error("[clearFeatureRequests]", error.code, error.message);
    throw new Error(`Failed to clear requests: ${error.message}`);
  }
  return count ?? 0;
}

export async function getRecentFeatureRequests(
  limit: number = 20
): Promise<FeatureRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feature_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[getRecentFeatureRequests]", error.code, error.message);
    return [];
  }
  return data;
}
