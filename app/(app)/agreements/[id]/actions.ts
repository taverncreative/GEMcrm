"use server";

import { revalidatePath } from "next/cache";
import { updateAgreementStatus } from "@/lib/data/agreements";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { AgreementStatus } from "@/types/database";

const VALID: AgreementStatus[] = ["active", "paused", "cancelled"];

export async function updateAgreementStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const id = formData.get("agreement_id") as string;
  const status = formData.get("status") as string;

  if (!id) {
    return { success: false, errors: {}, message: "Missing agreement ID" };
  }
  if (!VALID.includes(status as AgreementStatus)) {
    return { success: false, errors: {}, message: "Invalid status" };
  }

  try {
    await updateAgreementStatus(id, status as AgreementStatus);
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to update status",
    };
  }

  revalidatePath(`${ROUTES.AGREEMENTS}/${id}`);
  revalidatePath(ROUTES.AGREEMENTS);
  revalidatePath(ROUTES.DASHBOARD);
  return { success: true, errors: {}, message: null };
}
