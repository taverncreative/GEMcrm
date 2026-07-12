import { z } from "zod";

/**
 * Manual to-do create schema (Tasks module v1). Date-only: a `due_date`
 * (YYYY-MM-DD from <input type="date">) with no time-of-day and no
 * recurrence. Notes are optional free-text. The created task is written
 * with task_type 'todo'.
 */
export const TaskCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  // <input type="date"> yields YYYY-MM-DD (or "" when cleared).
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
    .or(z.literal(""))
    .optional()
    .default(""),
  notes: z.string().trim().max(2000, "Notes are too long").optional().default(""),
});

export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;
