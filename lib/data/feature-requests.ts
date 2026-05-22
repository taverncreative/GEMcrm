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
