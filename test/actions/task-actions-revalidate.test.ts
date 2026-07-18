/**
 * Perf (revalidatePath slice 2 — tasks): the task actions must NOT call
 * revalidatePath. Their consumers are SERVER-RENDERED (dashboard tiles +
 * calendar), so — unlike Slice 1's Dexie-live removals — the completion /
 * creation is surfaced by a SCOPED router.refresh() in the client callers
 * (CompleteTaskButton, BulkCompleteButton, CalendarTaskChip, NewTaskModal).
 * A revalidatePath here would purge the whole client router cache and
 * stampede a re-prefetch of every link on the page. These pin that the
 * server side no longer revalidates, plus the basic success behaviour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const completeTaskMock = vi.fn(async () => undefined);
const createTaskMock = vi.fn(async (input: Record<string, unknown>) => ({
  id: (input.id as string) ?? "generated-id",
  ...input,
}));
vi.mock("@/lib/data/tasks", () => ({
  completeTask: (...a: unknown[]) =>
    (completeTaskMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
  createTask: (...a: unknown[]) =>
    (createTaskMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

// dashboard/actions.ts also imports finishDay — stub so nothing pulls in
// the real supabase-backed data layer.
vi.mock("@/lib/data/daily-stats", () => ({ finishDay: vi.fn(async () => undefined) }));

const requireUserMock = vi.fn(async () => ({ id: "op" }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: (...a: unknown[]) =>
    (requireUserMock as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import {
  completeTaskAction,
  bulkCompleteTasksAction,
} from "@/app/(app)/dashboard/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";

const initial = { success: false, errors: {}, message: null };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue({ id: "op" });
  completeTaskMock.mockResolvedValue(undefined);
});

describe("completeTaskAction", () => {
  it("completes the task and reports success", async () => {
    const res = await completeTaskAction(initial, fd({ task_id: "t1" }));
    expect(completeTaskMock).toHaveBeenCalledWith("t1");
    expect(res.success).toBe(true);
  });

  it("does NOT call revalidatePath (scoped router.refresh in the caller)", async () => {
    await completeTaskAction(initial, fd({ task_id: "t1" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a missing task id without completing anything", async () => {
    const res = await completeTaskAction(initial, fd({}));
    expect(res.success).toBe(false);
    expect(completeTaskMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("bulkCompleteTasksAction", () => {
  it("completes every task and reports success", async () => {
    const res = await bulkCompleteTasksAction(
      initial,
      fd({ task_ids: JSON.stringify(["a", "b", "c"]) })
    );
    expect(completeTaskMock).toHaveBeenCalledTimes(3);
    expect(res.success).toBe(true);
  });

  it("does NOT call revalidatePath", async () => {
    await bulkCompleteTasksAction(
      initial,
      fd({ task_ids: JSON.stringify(["a", "b"]) })
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid task data", async () => {
    const res = await bulkCompleteTasksAction(initial, fd({ task_ids: "not-json" }));
    expect(res.success).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createTaskAction", () => {
  it("creates the to-do and reports success", async () => {
    const res = await createTaskAction(
      initial,
      fd({ id: "todo-1", title: "Order more bait", due_date: "2026-07-20", notes: "" })
    );
    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  it("does NOT call revalidatePath (NewTaskModal refreshes on success)", async () => {
    await createTaskAction(
      initial,
      fd({ id: "todo-1", title: "Order more bait", due_date: "", notes: "" })
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an empty title without creating anything", async () => {
    const res = await createTaskAction(initial, fd({ title: "" }));
    expect(res.success).toBe(false);
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
