/**
 * Manual to-do create schema (Tasks module v1).
 *
 * TaskCreateSchema backs the "New task" form and the server action. The
 * contract is deliberately narrow: a required title, an OPTIONAL date-only
 * due_date (YYYY-MM-DD, or "" when the field is cleared), and OPTIONAL
 * free-text notes. No time-of-day, no recurrence. These pin the boundaries
 * so a later widening of the form can't silently loosen the server guard.
 */
import { describe, it, expect } from "vitest";
import { TaskCreateSchema } from "@/lib/validation/task";

describe("TaskCreateSchema — title", () => {
  it("requires a non-empty title", () => {
    expect(TaskCreateSchema.safeParse({ title: "" }).success).toBe(false);
    expect(TaskCreateSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("accepts a plain title and trims it", () => {
    const res = TaskCreateSchema.safeParse({ title: "  Order bait  " });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.title).toBe("Order bait");
  });

  it("rejects a title over 200 chars", () => {
    expect(
      TaskCreateSchema.safeParse({ title: "x".repeat(201) }).success
    ).toBe(false);
    expect(
      TaskCreateSchema.safeParse({ title: "x".repeat(200) }).success
    ).toBe(true);
  });
});

describe("TaskCreateSchema — due_date (date-only, optional)", () => {
  const base = { title: "Task" };

  it("accepts a valid YYYY-MM-DD", () => {
    expect(
      TaskCreateSchema.safeParse({ ...base, due_date: "2026-07-01" }).success
    ).toBe(true);
  });

  it("accepts an empty string (no date)", () => {
    const res = TaskCreateSchema.safeParse({ ...base, due_date: "" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.due_date).toBe("");
  });

  it("defaults to '' when omitted", () => {
    const res = TaskCreateSchema.safeParse(base);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.due_date).toBe("");
  });

  it("rejects a malformed date (no time-of-day, no free text)", () => {
    expect(
      TaskCreateSchema.safeParse({ ...base, due_date: "01/07/2026" }).success
    ).toBe(false);
    expect(
      TaskCreateSchema.safeParse({ ...base, due_date: "2026-07-01T09:00" })
        .success
    ).toBe(false);
    expect(
      TaskCreateSchema.safeParse({ ...base, due_date: "tomorrow" }).success
    ).toBe(false);
  });
});

describe("TaskCreateSchema — notes (optional)", () => {
  const base = { title: "Task" };

  it("defaults to '' when omitted", () => {
    const res = TaskCreateSchema.safeParse(base);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.notes).toBe("");
  });

  it("accepts and trims free-text notes", () => {
    const res = TaskCreateSchema.safeParse({ ...base, notes: "  hi  " });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.notes).toBe("hi");
  });

  it("rejects notes over 2000 chars", () => {
    expect(
      TaskCreateSchema.safeParse({ ...base, notes: "x".repeat(2001) }).success
    ).toBe(false);
    expect(
      TaskCreateSchema.safeParse({ ...base, notes: "x".repeat(2000) }).success
    ).toBe(true);
  });
});
