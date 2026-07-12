/**
 * Tasks module v1 — data layer.
 *
 * Two contracts pinned against an in-memory `tasks` table:
 *
 *   1. getOverdueTasks EXCLUDES task_type 'todo'. The overdue alert is an
 *      auto-follow-up customer surface, so a missed personal to-do must not
 *      raise a customer-follow-up alarm. The query adds `.neq("task_type",
 *      "todo")`; every other overdue task still surfaces.
 *
 *   2. createTask upserts on `id`. The offline-first path writes the row to
 *      Dexie with a client-generated id, then replays the SAME id online; a
 *      lost-ack replay must not duplicate the row. Plain server callers omit
 *      `id` → a fresh UUID is minted, behaving like an insert.
 *
 * The supabase stub honours the exact chains the data layer uses:
 *   read:   select("*").eq().neq().lt().order().order().limit()
 *   write:  upsert({...}, { onConflict:"id" }).select().single()
 * Filters are AND-ed; orders are applied in call order; limit resolves.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

// Shared in-memory `tasks` table. Reset per test in beforeEach.
let taskRows: Row[] = [];

// todayUk() is mocked to a fixed date so "overdue" (< today) is deterministic.
vi.mock("@/lib/utils/today-uk", () => ({ todayUk: () => "2026-07-12" }));

function makeQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  const orders: Array<{ col: string; ascending: boolean }> = [];
  let upserted: Row | null = null;

  const matched = () => {
    let rows = taskRows.filter((r) => filters.every((f) => f(r)));
    for (const o of [...orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = a[o.col] as string | number;
        const bv = b[o.col] as string | number;
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return o.ascending ? cmp : -cmp;
      });
    }
    return rows;
  };

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
      filters.push((r) => (r[col] as string) < (val as string));
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orders.push({ col, ascending: opts?.ascending ?? true });
      return builder;
    },
    // Terminal for reads: resolves the filtered + ordered + limited rows.
    limit(n: number) {
      return Promise.resolve({ data: matched().slice(0, n), error: null });
    },
    // upsert({...}, { onConflict:"id" }) — replace the row with a matching id
    // in place, else append. Mirrors PostgREST upsert-on-id.
    upsert(obj: Row) {
      const idx = taskRows.findIndex((r) => r.id === obj.id);
      if (idx >= 0) {
        taskRows[idx] = { ...taskRows[idx], ...obj };
        upserted = taskRows[idx];
      } else {
        taskRows.push({ ...obj });
        upserted = taskRows[taskRows.length - 1];
      }
      return builder;
    },
    async single() {
      return { data: upserted ? { ...upserted } : null, error: null };
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => makeQuery() }),
}));

import { getOverdueTasks, getTasksDueToday, createTask } from "@/lib/data/tasks";

beforeEach(() => {
  taskRows = [];
});

describe("getOverdueTasks — excludes 'todo'", () => {
  beforeEach(() => {
    // All pending + overdue (due before 2026-07-12). Only task_type varies.
    taskRows = [
      { id: "t1", status: "pending", task_type: "follow_up", due_date: "2026-07-01", priority_order: 2 },
      { id: "t2", status: "pending", task_type: "review_request", due_date: "2026-07-02", priority_order: 3 },
      { id: "t3", status: "pending", task_type: "contract_renewal", due_date: "2026-07-03", priority_order: 1 },
      { id: "t4", status: "pending", task_type: "general", due_date: "2026-07-04", priority_order: 2 },
      { id: "t5", status: "pending", task_type: "todo", due_date: "2026-07-05", priority_order: 2 },
    ];
  });

  it("omits every 'todo' row", async () => {
    const rows = await getOverdueTasks();
    expect(rows.map((r) => r.id)).not.toContain("t5");
    expect(rows.every((r) => r.task_type !== "todo")).toBe(true);
  });

  it("still returns the non-todo overdue tasks", async () => {
    const rows = await getOverdueTasks();
    expect(rows.map((r) => r.id).sort()).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("a lone overdue 'todo' yields nothing (no false customer-follow-up alarm)", async () => {
    taskRows = [
      { id: "only-todo", status: "pending", task_type: "todo", due_date: "2026-07-01", priority_order: 2 },
    ];
    expect(await getOverdueTasks()).toEqual([]);
  });

  it("does not surface a pending non-overdue todo either (due filter still applies)", async () => {
    taskRows = [
      { id: "future", status: "pending", task_type: "follow_up", due_date: "2026-07-20", priority_order: 2 },
    ];
    expect(await getOverdueTasks()).toEqual([]);
  });
});

describe("getTasksDueToday — INCLUDES 'todo' (unlike overdue)", () => {
  beforeEach(() => {
    // Mixed types + statuses + dates. today is mocked to 2026-07-12.
    taskRows = [
      { id: "d1", status: "pending", task_type: "todo", due_date: "2026-07-12", priority_order: 2, created_at: "2026-07-01T00:00:00Z" },
      { id: "d2", status: "pending", task_type: "follow_up", due_date: "2026-07-12", priority_order: 3, created_at: "2026-07-02T00:00:00Z" },
      { id: "d3", status: "pending", task_type: "general", due_date: "2026-07-12", priority_order: 2, created_at: "2026-07-03T00:00:00Z" },
      // due tomorrow — must be excluded (due_date filter)
      { id: "d4", status: "pending", task_type: "todo", due_date: "2026-07-13", priority_order: 2, created_at: "2026-07-04T00:00:00Z" },
      // due today but already complete — must be excluded (status filter)
      { id: "d5", status: "complete", task_type: "todo", due_date: "2026-07-12", priority_order: 2, created_at: "2026-07-05T00:00:00Z" },
    ];
  });

  it("includes a 'todo' due today (todos belong on this card)", async () => {
    const rows = await getTasksDueToday();
    expect(rows.map((r) => r.id)).toContain("d1");
  });

  it("also includes follow-up and system tasks due today", async () => {
    const rows = await getTasksDueToday();
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["d2", "d3"]));
  });

  it("returns every pending task due today regardless of type", async () => {
    const rows = await getTasksDueToday();
    expect(rows.map((r) => r.id).sort()).toEqual(["d1", "d2", "d3"]);
  });

  it("excludes tasks not due today, and completed tasks", async () => {
    const rows = await getTasksDueToday();
    expect(rows.map((r) => r.id)).not.toContain("d4"); // due tomorrow
    expect(rows.map((r) => r.id)).not.toContain("d5"); // already complete
  });

  it("a lone 'todo' due today still surfaces (no todo-exclusion here)", async () => {
    taskRows = [
      { id: "only", status: "pending", task_type: "todo", due_date: "2026-07-12", priority_order: 2, created_at: "2026-07-01T00:00:00Z" },
    ];
    const rows = await getTasksDueToday();
    expect(rows.map((r) => r.id)).toEqual(["only"]);
  });
});

describe("createTask — upsert-on-id idempotency", () => {
  it("a replayed create with the same id does NOT duplicate the row", async () => {
    const id = "client-generated-id";
    await createTask({ id, title: "Order bait", task_type: "todo", due_date: "2026-07-20", notes: "10 boxes" });
    expect(taskRows).toHaveLength(1);

    // Lost-ack replay: identical id + args re-run.
    await createTask({ id, title: "Order bait", task_type: "todo", due_date: "2026-07-20", notes: "10 boxes" });
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0].id).toBe(id);
    expect(taskRows[0].title).toBe("Order bait");
    expect(taskRows[0].notes).toBe("10 boxes");
    expect(taskRows[0].task_type).toBe("todo");
  });

  it("returns the persisted row from the upsert", async () => {
    const row = await createTask({ id: "abc", title: "Task", task_type: "todo" });
    expect(row.id).toBe("abc");
    expect(row.status).toBe("pending");
    // Manual to-dos carry no urgency ranking — default medium (order 2).
    expect(row.priority).toBe("medium");
    expect(row.priority_order).toBe(2);
  });

  it("an omitted id mints a fresh one and behaves like an insert", async () => {
    const a = await createTask({ title: "Auto task one" });
    const b = await createTask({ title: "Auto task two" });
    expect(taskRows).toHaveLength(2);
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    // Server-side callers that omit task_type keep the 'general' default.
    expect(a.task_type).toBe("general");
    expect(a.notes).toBeNull();
  });

  it("two DIFFERENT ids create two distinct rows", async () => {
    await createTask({ id: "one", title: "A", task_type: "todo" });
    await createTask({ id: "two", title: "B", task_type: "todo" });
    expect(taskRows.map((r) => r.id).sort()).toEqual(["one", "two"]);
  });
});
