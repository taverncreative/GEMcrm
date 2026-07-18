"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { runRenewalCheck } from "@/lib/services/agreement-renewal";
import { finishDay } from "@/lib/data/daily-stats";
import {
  clearFeatureRequests,
  createFeatureRequest,
  deleteFeatureRequest,
  type RequestType,
} from "@/lib/data/feature-requests";
import { sendEmail } from "@/lib/services/email";
import { sendFeedbackToSpotlight } from "@/lib/services/spotlight";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ChangePasswordSchema, InviteUserSchema } from "@/lib/validation/account";
import { ROUTES } from "@/lib/constants/routes";
import { BUSINESS } from "@/lib/constants/branding";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState, FeedbackActionState } from "@/types/actions";

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
  _prev: FeedbackActionState,
  formData: FormData
): Promise<FeedbackActionState> {
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
    // The row is the record of the request, and its id is Spotlight's
    // idempotency key below — so capture it rather than discarding it.
    const created = await createFeatureRequest({
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

    // Push into Spotlight so John gets a triageable list — but do NOT make
    // Nate wait for it. The Spotlight endpoint can be slow/unresponsive, and
    // the POST has a 5s timeout; awaiting it here made the whole submit hang
    // for up to 5s before "Thanks" returned. The row + email above are the
    // real record, so Spotlight is pure background work.
    //
    // after() runs the callback AFTER this response is sent to Nate, and the
    // platform keeps the function alive to finish it (up to the route's max
    // duration — well beyond the POST's 5s cap), so the submit is instant AND
    // the POST still actually goes out. sendFeedbackToSpotlight is fully
    // fenced and never throws (a throw/timeout/non-200 logs server-side
    // only); the try/catch is belt and braces so a future refactor can't
    // turn Spotlight into the reason a submit fails. No-ops silently until
    // the SPOTLIGHT_INGEST_* env vars are set.
    after(async () => {
      try {
        await sendFeedbackToSpotlight({
          message,
          request_id: created.id,
          type,
          client_name: BUSINESS.signoffName,
        });
      } catch (spotlightErr) {
        console.error("[submitFeatureRequestAction] spotlight:", spotlightErr);
      }
    });

    // Deliberately NO revalidatePath here. In this Next version a
    // revalidatePath from a server action purges the ENTIRE client router
    // cache, and in production that fires a re-prefetch stampede of every
    // link on whatever page the submit came from (~50 SSR invocations from
    // /jobs) — a second submit sent into that storm is what made repeat
    // submits feel ~5s slow. This action fires from the header sheet on
    // EVERY page, so it must not invalidate anything. The past-requests
    // list on Settings still updates: the form runs a scoped
    // router.refresh() on success when it's rendered there.
    return {
      success: true,
      errors: {},
      message: "Thanks, request logged.",
      submittedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error ? err.message : "Failed to submit request",
    };
  }
}

/**
 * HARD delete one past request (operator housekeeping on the Settings
 * list). Direct-call action — invoked from a button, not a form. No
 * revalidatePath (see submitFeatureRequestAction); the caller runs
 * router.refresh() so only the Settings page re-renders.
 */
export async function deleteFeatureRequestAction(
  id: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!id) return { success: false, message: "Missing request id" };
  try {
    await deleteFeatureRequest(id);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to delete request",
    };
  }
}

/**
 * HARD delete every past request ("Clear all"). Same shape and same
 * no-revalidate rule as the single delete.
 */
export async function clearFeatureRequestsAction(): Promise<{
  success: boolean;
  message?: string;
}> {
  await requireUser();
  try {
    const cleared = await clearFeatureRequests();
    return {
      success: true,
      message:
        cleared === 0
          ? "Nothing to clear."
          : `Cleared ${cleared} request${cleared === 1 ? "" : "s"}.`,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to clear requests",
    };
  }
}

// ─── Change password ─────────────────────────────────────────────────────

/**
 * Update the signed-in user's password.
 *
 * Flow: verify the current password by attempting a fresh sign-in (Supabase
 * has no dedicated "verify current password" endpoint), then update via
 * `auth.updateUser`. The verification step protects against an attacker
 * with a stolen session cookie silently changing the account password.
 *
 * Returns generic error messages on failure — never echo back the password
 * itself or whether the email is registered (the user is logged in, so
 * email enumeration isn't a concern here, but stay consistent).
 */
export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!user.email) {
    return {
      success: false,
      errors: {},
      message: "Your account has no email on file — contact the developer.",
    };
  }

  const raw = {
    currentPassword: (formData.get("current_password") as string) ?? "",
    newPassword: (formData.get("new_password") as string) ?? "",
    confirmPassword: (formData.get("confirm_password") as string) ?? "",
  };

  const parsed = ChangePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        // Map the camelCase schema keys to snake_case form field names so
        // errors render against the right inputs.
        const map: Record<string, string> = {
          currentPassword: "current_password",
          newPassword: "new_password",
          confirmPassword: "confirm_password",
        };
        errors[map[key] ?? key] = issue.message;
      }
    }
    return { success: false, errors, message: null };
  }

  const supabase = await createClient();

  // Verify the current password by attempting a sign-in. This re-issues
  // the session cookie which is fine — same user, same email.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (signInError) {
    return {
      success: false,
      errors: { current_password: "Current password is incorrect" },
      message: null,
    };
  }

  // Now update the password.
  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });
  if (updateError) {
    return {
      success: false,
      errors: {},
      message: updateError.message,
    };
  }

  return { success: true, errors: {}, message: "Password updated." };
}

// ─── Invite a new user ───────────────────────────────────────────────────

/**
 * Invite a new teammate by email.
 *
 * Supabase sends them a magic-link email; clicking it confirms the
 * account, signs them in, and lands them on the dashboard. They can
 * set their own password from this Settings page once signed in.
 *
 * Requires `SUPABASE_SERVICE_ROLE_KEY` — the admin client throws a clear
 * error if it's missing so the operator knows what to configure.
 *
 * Note: this is a single-tenant CRM with no role distinction — every
 * invited user gets full access. UI surfaces this clearly.
 */
export async function inviteUserAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();

  const raw = {
    email: ((formData.get("email") as string) ?? "").trim().toLowerCase(),
    fullName: ((formData.get("full_name") as string) ?? "").trim(),
  };

  const parsed = InviteUserSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        const map: Record<string, string> = { fullName: "full_name" };
        errors[map[key] ?? key] = issue.message;
      }
    }
    return { success: false, errors, message: null };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error
          ? err.message
          : "Admin client not configured — set SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: parsed.data.fullName ? { full_name: parsed.data.fullName } : undefined,
  });

  if (error) {
    // Common Supabase errors here: user already exists, or email
    // service not configured. Surface the underlying message — useful
    // for the operator to know whether they need to retry vs reconfigure.
    return {
      success: false,
      errors: {},
      message: error.message,
    };
  }

  revalidatePath(ROUTES.SETTINGS);
  return {
    success: true,
    errors: {},
    message: `Invitation sent to ${parsed.data.email}.`,
  };
}
