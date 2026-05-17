"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runRenewalCheck } from "@/lib/services/agreement-renewal";
import { finishDay } from "@/lib/data/daily-stats";
import { createFeatureRequest, type RequestType } from "@/lib/data/feature-requests";
import { sendEmail } from "@/lib/services/email";
import { ROUTES } from "@/lib/constants/routes";
import { BUSINESS } from "@/lib/constants/branding";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

export async function runRenewalCheckAction(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  await requireUser();
  try {
    const created = await runRenewalCheck();
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return {
      success: true,
      errors: {},
      message:
        created === 0
          ? "No new renewal tasks needed."
          : `Created ${created} renewal task${created === 1 ? "" : "s"}.`,
    };
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error ? err.message : "Failed to run renewal check",
    };
  }
}

export async function finishDayAction(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  await requireUser();
  try {
    await finishDay();
    revalidatePath("/dashboard");
    revalidatePath("/reports");
    revalidatePath("/settings");
    return {
      success: true,
      errors: {},
      message: "Today's summary has been saved.",
    };
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to save summary",
    };
  }
}

// ─── Feature/Bug request submission ──────────────────────────────────────

const VALID_TYPES: RequestType[] = ["feature", "bug", "change"];

// Optional submitter email — accepts "" / null / a valid email; rejects garbage.
const submitterEmailSchema = z
  .union([z.string().email("Enter a valid email"), z.literal("")])
  .optional()
  .default("");

export async function submitFeatureRequestAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();

  const type = formData.get("request_type") as string;
  const message = ((formData.get("message") as string) ?? "").trim();
  const submitterEmailRaw = (formData.get("submitter_email") as string) ?? "";

  if (!VALID_TYPES.includes(type as RequestType)) {
    return {
      success: false,
      errors: { request_type: "Pick a type" },
      message: null,
    };
  }
  if (message.length < 5) {
    return {
      success: false,
      errors: { message: "Tell us a little more (min 5 chars)" },
      message: null,
    };
  }

  const emailParse = submitterEmailSchema.safeParse(submitterEmailRaw);
  if (!emailParse.success) {
    return {
      success: false,
      errors: { submitter_email: emailParse.error.issues[0]?.message ?? "Invalid email" },
      message: null,
    };
  }
  const submitterEmail = emailParse.data === "" ? null : emailParse.data;

  try {
    await createFeatureRequest({
      request_type: type as RequestType,
      message,
      submitter_email: submitterEmail,
    });

    // Notify the developer inbox. We send the email regardless of whether
    // RESEND_API_KEY is configured — in dev it falls back to console.
    await sendEmail({
      to: BUSINESS.supportEmail,
      subject: `[${BUSINESS.name} CRM] ${type} request`,
      text: [
        `Type: ${type}`,
        `From: ${submitterEmail ?? "anonymous (no email provided)"}`,
        "",
        message,
      ].join("\n"),
    });

    revalidatePath(ROUTES.SETTINGS);
    return { success: true, errors: {}, message: "Thanks — request logged." };
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error ? err.message : "Failed to submit request",
    };
  }
}
