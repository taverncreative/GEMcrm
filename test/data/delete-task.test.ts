/**
 * Delete-a-task (soft delete) — data layer + action.
 *
 * A task delete is a soft delete: `deleteTask` sets `deleted_at = now()`
 * through the `soft_delete_task` SECURITY DEFINER RPC (migration 050), NOT
 * a direct `.update()`. The tasks SELECT policy (`USING (deleted_at IS
 * NULL)`, migration 029) is enforced against the post-update row PostgREST
 * returns, so a direct update that sets `deleted_at` is rejected with 42501
 * for every authenticated user — the same gap 032/038/043 fixed for
 * customers, jobs and agreements. The RPC runs as definer and bypasses it.
 *
 * Pinned here against an in-memory `tasks` table. The supabase stub honours
 * the eq/is/neq/lt read filters the real reads use, applies the RLS SELECT
 * policy itself (rows with a `deleted_at` are simply not visible), and
 * routes `rpc("soft_delete_task", { p_id })` through the same table,
 * mirroring the function body.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

let taskRows: Row[] = [];

// Read builder covering the chains the tasks reads use:
//   select("*").eq().neq().lt().order().order().limit()  → rows
// Filters are AND-ed. The RLS SELECT policy is modelled at the top of
// `matched()`: a soft-deleted row is invisible to every read, which is
// exactly what makes "disappears from its lists" true without any read
// having to filter deleted_at itself.
function makeQuery() {
  const filters: Array<(r: Row) => boolean> = [];

  const matched = () =>
    taskRows
      .filter((r) => r.deleted_at == null)
      .filter((r) => filters.every((f) => f(r)));

  const builder = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    neq(col: string, val: unknown) {
      filters.push((r) => r[col] !== val);
      return builder;
    },
    lt(col: string, val: unknown) {
      filters.push((r) => String(r[col]) < String(val));
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return Promise.resolve({ data: matched().map((r) => ({ ...r })), error: null });
    },
    then(resolve: (v: { data: Row[]; error: null }) => void) {
      return resolve({ data: matched().map((r) => ({ ...r })), error: null });
    },
  };
  return builder;
}

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => makeQuery(), rpc: rpcMock }),
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: requireUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { deleteTask, getTasksDueToday, getPendingTasks } from "@/lib/data/tasks";
import { deleteTaskAction } from "@/app/(app)/tasks/actions";
import { todayUk } from "@/lib/utils/today-uk";

const LIVE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "op" });
  vi.mocked(revalidatePath).mockClear();
  rpcMock.mockReset();
  rpcMock.mockImplementation(async (fn: string, params: { p_id: string }) => {
    if (fn === "soft_delete_task") {
      for (const r of taskRows) {
        if (r.id === params.p_id && r.deleted_at == null) {
          r.deleted_at = new Date().toISOString();
        }
      }
    }
    return { error: null };
  });
  const today = todayUk();
  taskRows = [
    {
      id: LIVE,
      title: "Test to-do",
      status: "pending",
      task_type: "todo",
      due_date: today,
      deleted_at: null,
    },
    {
      id: OTHER,
      title: "Keep me",
      status: "pending",
      task_type: "todo",
      due_date: today,
      deleted_at: null,
    },
    {
      id: GONE,
      title: "Already gone",
      status: "pending",
      task_type: "todo",
      due_date: today,
      deleted_at: "2026-01-01T00:00:00.000Z",
    },
  ];
});

describe("deleteTask — soft delete via RPC", () => {
  it("calls the soft_delete_task RPC (not a direct update)", async () => {
    await deleteTask(LIVE);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("soft_delete_task", { p_id: LIVE });
  });

  it("stamps deleted_at on the matching row", async () => {
    await deleteTask(LIVE);
    const row = taskRows.find((r) => r.id === LIVE)!;
    expect(typeof row.deleted_at).toBe("string");
  });

  it("touches only the targeted row", async () => {
    await deleteTask(LIVE);
    expect(taskRows.find((r) => r.id === OTHER)!.deleted_at).toBeNull();
    // An already-deleted row keeps its original stamp (the `and deleted_at
    // is null` predicate makes a replay a no-op).
    expect(taskRows.find((r) => r.id === GONE)!.deleted_at).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });

  it("surfaces an RPC error as a thrown failure", async () => {
    rpcMock.mockResolvedValueOnce({
      error: {
        code: "42501",
        message: "new row violates row-level security policy",
      },
    });
    await expect(deleteTask(LIVE)).rejects.toThrow("Failed to delete task");
  });
});

describe("a deleted task disappears from the task lists", () => {
  it("drops out of Tasks Due Today", async () => {
    expect((await getTasksDueToday()).map((t) => t.id)).toContain(LIVE);
    await deleteTask(LIVE);
    const after = (await getTasksDueToday()).map((t) => t.id);
    expect(after).not.toContain(LIVE);
    expect(after).toContain(OTHER);
  });

  it("drops out of the pending list", async () => {
    await deleteTask(LIVE);
    expect((await getPendingTasks()).map((t) => t.id)).not.toContain(LIVE);
  });

  it("an already-deleted task was never in the lists to begin with", async () => {
    expect((await getTasksDueToday()).map((t) => t.id)).not.toContain(GONE);
  });
});

describe("deleteTaskAction — auth gate + happy path", () => {
  it("requires auth — rejects and writes nothing when unauthenticated", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(deleteTaskAction(LIVE)).rejects.toThrow("Unauthorized");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(taskRows.find((r) => r.id === LIVE)!.deleted_at).toBeNull();
  });

  it("soft-deletes and returns success", async () => {
    const res = await deleteTaskAction(LIVE);
    expect(res).toEqual({ success: true });
    expect(taskRows.find((r) => r.id === LIVE)!.deleted_at).not.toBeNull();
  });

  it("returns an error for a missing id, without touching the table", async () => {
    const res = await deleteTaskAction("");
    expect(res.success).toBe(false);
    expect(res.message).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // Perf: the chip mirrors the delete into Dexie and runs a scoped
  // router.refresh(), so the action must not purge the client router cache.
  it("does NOT call revalidatePath", async () => {
    await deleteTaskAction(LIVE);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
