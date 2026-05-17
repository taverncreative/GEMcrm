"use server";

import { revalidatePath } from "next/cache";
import { BookingSchema } from "@/lib/validation/booking";
import { createBooking, JobClashError } from "@/lib/data/jobs";
import { getSiteById } from "@/lib/data/sites";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
  } catch {
    return [];
  }
}

/**
 * Create a quick booking for a site. Minimal input — the service sheet
 * gets filled later from the calendar or job detail.
 */
export async function createBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const siteId = formData.get("site_id") as string;

  if (!siteId) {
    return { success: false, errors: {}, message: "Missing site ID" };
  }

  const site = await getSiteById(siteId);
  if (!site) {
    return { success: false, errors: {}, message: "Site not found" };
  }

  const pestSpecies = parseJsonArray(formData.get("pest_species") as string | null);

  const raw = {
    site_id: siteId,
    job_date: formData.get("job_date") as string,
    call_type: formData.get("call_type") as string,
    pest_species: pestSpecies,
    value: formData.get("value") as string,
    report_notes: formData.get("report_notes") as string,
    parent_job_id: (formData.get("parent_job_id") as string) ?? "",
  };

  const result = BookingSchema.safeParse(raw);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        errors[key] = issue.message;
      }
    }
    return { success: false, errors, message: null };
  }

  try {
    await createBooking(result.data);
  } catch (err) {
    if (err instanceof JobClashError) {
      return {
        success: false,
        errors: { job_date: err.message },
        message: err.message,
      };
    }
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to create booking",
    };
  }

  revalidatePath(ROUTES.siteDetail(siteId));
  revalidatePath(ROUTES.JOBS);
  revalidatePath(ROUTES.CALENDAR);
  revalidatePath(ROUTES.DASHBOARD);
  return { success: true, errors: {}, message: "Booking created" };
}
