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

  // No revalidatePath. The dashboard task tiles and the calendar are
  // server-rendered, so the completion is surfaced by a SCOPED
  // router.refresh() in the caller (CompleteTaskButton / CalendarTaskChip)
  // that re-fetches only the current route. The old revalidatePath here
  // purged the whole client router cache and stampeded a re-prefetch of
  // every link on the page (the app-wide sluggishness).
  return { success: true, errors: {}, message: "Task completed" };
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
