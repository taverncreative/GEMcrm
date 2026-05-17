"use server";

import { revalidatePath } from "next/cache";
import { getJobById } from "@/lib/data/jobs";
import { getCustomerById } from "@/lib/data/customers";
import { completeTask } from "@/lib/data/tasks";
import {
  generateSMS,
  generateEmail,
  sendSMS,
  sendEmail,
} from "@/lib/services/review-message";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

export async function sendReviewSMSAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const jobId = formData.get("job_id") as string;
  const customerId = formData.get("customer_id") as string;
  const taskId = formData.get("task_id") as string;

  if (!jobId || !customerId) {
    return { success: false, errors: {}, message: "Missing job or customer" };
  }

  try {
    const [job, customer] = await Promise.all([
      getJobById(jobId),
      getCustomerById(customerId),
    ]);

    if (!job || !customer) {
      return { success: false, errors: {}, message: "Job or customer not found" };
    }

    const message = generateSMS(customer, job);
    if (!message) {
      return { success: false, errors: {}, message: "Customer has no phone number" };
    }

    await sendSMS(message);

    // Auto-complete the review task
    if (taskId) {
      try {
        await completeTask(taskId);
      } catch {
        // Non-critical — task may already be complete
      }
    }

    revalidatePath(ROUTES.DASHBOARD);
    return { success: true, errors: {}, message: "SMS sent" };
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to send SMS",
    };
  }
}

export async function sendReviewEmailAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const jobId = formData.get("job_id") as string;
  const customerId = formData.get("customer_id") as string;
  const taskId = formData.get("task_id") as string;

  if (!jobId || !customerId) {
    return { success: false, errors: {}, message: "Missing job or customer" };
  }

  try {
    const [job, customer] = await Promise.all([
      getJobById(jobId),
      getCustomerById(customerId),
    ]);

    if (!job || !customer) {
      return { success: false, errors: {}, message: "Job or customer not found" };
    }

    const message = generateEmail(customer, job);
    if (!message) {
      return { success: false, errors: {}, message: "Customer has no email address" };
    }

    await sendEmail(message);

    // Auto-complete the review task
    if (taskId) {
      try {
        await completeTask(taskId);
      } catch {
        // Non-critical
      }
    }

    revalidatePath(ROUTES.DASHBOARD);
    return { success: true, errors: {}, message: "Email sent" };
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}
