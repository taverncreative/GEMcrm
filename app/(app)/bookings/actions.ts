"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createCustomer,
  getCustomerById,
  updateCustomerDocDetails,
} from "@/lib/data/customers";
import { createSite, getSiteById } from "@/lib/data/sites";
import { searchCustomers, getCustomers } from "@/lib/data/customers";
import { getSitesByCustomer } from "@/lib/data/sites";
import { createBooking, JobClashError } from "@/lib/data/jobs";
import { CustomerSchema } from "@/lib/validation/customer";
import { BookingCreateSchema } from "@/lib/validation/booking";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { Customer, Site } from "@/types/database";

// ─── Search helpers used by the booking modal ────────────────────────────

export async function searchCustomersAction(query: string): Promise<Customer[]> {
  await requireUser();
  if (!query || query.trim().length < 1) {
    return getCustomers({ limit: 10, offset: 0 });
  }
  return searchCustomers(query, { limit: 10 });
}

export async function getSitesForCustomerAction(
  customerId: string
): Promise<Site[]> {
  await requireUser();
  if (!customerId) return [];
  return getSitesByCustomer(customerId);
}

// ─── Atomic booking creation ─────────────────────────────────────────────

/**
 * Payload comes from a single modal and can contain any of:
 *   - existing customer + existing site
 *   - existing customer + new site
 *   - new customer + new site
 *
 * We never create a "new customer + pick existing site" because sites are
 * always owned by a customer — the flow wouldn't make sense.
 */
const BookingPayloadSchema = z.object({
  mode_customer: z.enum(["existing", "new"]),
  mode_site: z.enum(["existing", "new"]),

  customer_id: z.string().optional().default(""),
  customer_name: z.string().optional().default(""),
  customer_company: z.string().optional().default(""),
  customer_email: z.string().optional().default(""),
  customer_phone: z.string().optional().default(""),
  customer_type: z.enum(["commercial", "domestic"]).default("commercial"),

  site_id: z.string().optional().default(""),
  site_line1: z.string().optional().default(""),
  site_line2: z.string().optional().default(""),
  site_town: z.string().optional().default(""),
  site_county: z.string().optional().default(""),
  site_postcode: z.string().optional().default(""),

  job_date: z.string().min(1, "Date is required"),
  job_time: z.string().optional().default(""),
  job_time_end: z.string().optional().default(""),
  // Optional for a quick-add booking (Pass 1) — blank → null in createBooking.
  call_type: z
    .enum(["routine", "callout", "followup", "survey", "other"])
    .or(z.literal(""))
    .optional()
    .default(""),
  pest_species: z.array(z.string()).default([]),
  value: z.string().optional().default(""),
  report_notes: z.string().optional().default(""),
});

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

export async function createQuickBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const raw = {
    mode_customer: (formData.get("mode_customer") as string) || "existing",
    mode_site: (formData.get("mode_site") as string) || "existing",
    customer_id: (formData.get("customer_id") as string) ?? "",
    customer_name: (formData.get("customer_name") as string) ?? "",
    customer_company: (formData.get("customer_company") as string) ?? "",
    customer_email: (formData.get("customer_email") as string) ?? "",
    customer_phone: (formData.get("customer_phone") as string) ?? "",
    customer_type: ((formData.get("customer_type") as string) ||
      "commercial") as "commercial" | "domestic",
    site_id: (formData.get("site_id") as string) ?? "",
    site_line1: (formData.get("site_line1") as string) ?? "",
    site_line2: (formData.get("site_line2") as string) ?? "",
    site_town: (formData.get("site_town") as string) ?? "",
    site_county: (formData.get("site_county") as string) ?? "",
    site_postcode: (formData.get("site_postcode") as string) ?? "",
    job_date: (formData.get("job_date") as string) ?? "",
    job_time: (formData.get("job_time") as string) ?? "",
    job_time_end: (formData.get("job_time_end") as string) ?? "",
    call_type: (formData.get("call_type") as string) ?? "",
    pest_species: parseJsonArray(formData.get("pest_species") as string | null),
    value: (formData.get("value") as string) ?? "",
    report_notes: (formData.get("report_notes") as string) ?? "",
  };

  const parsed = BookingPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  const data = parsed.data;

  // Offline-first id-injection (step 8). When this action is invoked
  // via the local-first wrapper (online fast-path) OR replayed from the
  // outbox, these carry the client-generated UUIDs that applyLocal
  // already wrote to Dexie, so the server rows match the local rows
  // (no remapping). Plain callers that don't supply them get fresh
  // server-side UUIDs (the `?? newId()` default inside each data fn).
  const jobIdNew = (formData.get("job_id") as string) || undefined;
  const customerIdNew = (formData.get("customer_id_new") as string) || undefined;
  const siteIdNew = (formData.get("site_id_new") as string) || undefined;

  // Step 1 — resolve customer
  let customerId = data.customer_id;
  try {
    if (data.mode_customer === "new") {
      const customerResult = CustomerSchema.safeParse({
        name: data.customer_name,
        company_name: data.customer_company,
        email: data.customer_email,
        phone: data.customer_phone,
        customer_type: data.customer_type,
      });
      if (!customerResult.success) {
        const errors: Record<string, string> = {};
        for (const issue of customerResult.error.issues) {
          const key = issue.path[0];
          if (typeof key === "string") {
            errors[`customer_${key === "company_name" ? "company" : key}`] =
              issue.message;
          }
        }
        return { success: false, errors, message: null };
      }
      const created = await createCustomer(customerResult.data, [], {
        id: customerIdNew,
      });
      customerId = created.id;
    } else {
      if (!customerId) {
        return {
          success: false,
          errors: { customer_id: "Select a customer" },
          message: null,
        };
      }
      const exists = await getCustomerById(customerId);
      if (!exists) {
        return {
          success: false,
          errors: { customer_id: "Customer not found" },
          message: null,
        };
      }
    }
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error ? err.message : "Failed to create customer",
    };
  }

  // Step 2 — resolve site
  let siteId = data.site_id;
  try {
    // Create a (possibly bare) site when the operator added a new one OR
    // gave no site at all — a quick-add booking needs only customer_id, so
    // the job → site → customer chain still holds with a blank address.
    if (data.mode_site === "new" || !siteId) {
      // Lenient by design — this is the ONLY place a bare site is allowed.
      // No SiteSchema (strict) here: a quick-add booking needs only
      // customer_id, with a "—" county placeholder so the address still
      // reads sensibly on documents. createSite stores blank fields as null.
      const created = await createSite(
        customerId,
        {
          address_line_1: data.site_line1,
          address_line_2: data.site_line2,
          town: data.site_town,
          county: data.site_county || "—",
          postcode: data.site_postcode,
        },
        { id: siteIdNew }
      );
      siteId = created.id;
    } else {
      const exists = await getSiteById(siteId);
      if (!exists || exists.customer_id !== customerId) {
        return {
          success: false,
          errors: { site_id: "Site not found for this customer" },
          message: null,
        };
      }
    }
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to create site",
    };
  }

  // Keep a brand-new customer's registered address in sync with the site the
  // operator just entered. applyLocal already mirrored this to Dexie; without
  // persisting it here, the next pull would blank the customer address back
  // out (server row wins on updated_at). Best-effort, and never for an
  // existing customer (they keep their own address). Idempotent on replay.
  if (data.mode_customer === "new" && data.mode_site === "new") {
    const hasSiteAddress =
      data.site_line1.trim() ||
      data.site_town.trim() ||
      data.site_postcode.trim();
    if (hasSiteAddress) {
      try {
        await updateCustomerDocDetails(customerId, {
          address_line_1: data.site_line1,
          address_line_2: data.site_line2,
          town: data.site_town,
          // Raw county only — never the "—" bare-site placeholder.
          county: data.site_county,
          // Uppercased to match the site + applyLocal, so a later pull
          // doesn't leave customer and site postcodes out of sync.
          postcode: data.site_postcode.toUpperCase(),
        });
      } catch (err) {
        console.error(
          "[createQuickBookingAction] customer address copy-back failed",
          err
        );
      }
    }
  }

  // Step 3 — booking. Lenient create schema: call_type may be blank
  // (→ null in createBooking). Other fields keep their normal validation.
  const bookingResult = BookingCreateSchema.safeParse({
    site_id: siteId,
    job_date: data.job_date,
    job_time: data.job_time,
    job_time_end: data.job_time_end,
    call_type: data.call_type,
    pest_species: data.pest_species,
    value: data.value,
    report_notes: data.report_notes,
  });
  if (!bookingResult.success) {
    const errors: Record<string, string> = {};
    for (const issue of bookingResult.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  // The service-sheet-from-scratch flow starts its job "in_progress"; any
  // other value (or its absence) is the normal "scheduled" booking. Only
  // these two are ever accepted from this path — never completed/draft.
  const jobStatus =
    formData.get("job_status") === "in_progress" ? "in_progress" : "scheduled";

  try {
    await createBooking(bookingResult.data, { id: jobIdNew, jobStatus });
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

  // Freshen all the places this booking will show up.
  revalidatePath(ROUTES.DASHBOARD);
  revalidatePath(ROUTES.JOBS);
  revalidatePath(ROUTES.CALENDAR);
  revalidatePath(ROUTES.CUSTOMERS);
  revalidatePath(ROUTES.siteDetail(siteId));
  revalidatePath(ROUTES.customerDetail(customerId));

  return { success: true, errors: {}, message: "Booking created" };
}
