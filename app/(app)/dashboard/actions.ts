"use server";

import { revalidatePath } from "next/cache";
import { completeTask } from "@/lib/data/tasks";
import { finishDay } from "@/lib/data/daily-stats";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

export async function completeTaskAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const taskId = formData.get("task_id") as string;

  if (!taskId) {
    return { success: false, errors: {}, message: "Missing task ID" };
  }

  try {
    await completeTask(taskId);
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to complete task",
    };
  }

  revalidatePath("/dashboard");
  return { success: true, errors: {}, message: "Task completed" };
}

export async function bulkCompleteTasksAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const raw = formData.get("task_ids") as string;
  if (!raw) {
    return { success: false, errors: {}, message: "No tasks provided" };
  }

  let taskIds: string[];
  try {
    taskIds = JSON.parse(raw);
  } catch {
    return { success: false, errors: {}, message: "Invalid task data" };
  }

  try {
    await Promise.all(taskIds.map((id) => completeTask(id)));
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to complete tasks",
    };
  }

  revalidatePath("/dashboard");
  return { success: true, errors: {}, message: "All tasks completed" };
}

export async function finishDayAction(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  await requireUser();
  try {
    await finishDay();
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to finish day",
    };
  }

  revalidatePath("/dashboard");
  return { success: true, errors: {}, message: "Day completed" };
}
