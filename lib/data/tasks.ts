import { createClient } from "@/lib/supabase/server";
import { todayUk } from "@/lib/utils/today-uk";
import { newId } from "@/lib/utils/id";
import type { Task, TaskType, TaskPriority } from "@/types/database";

const PRIORITY_TO_ORDER: Record<TaskPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

interface CreateTaskInput {
  /** Client-generated UUID from the offline-first path (applyLocal wrote
   *  this id locally; the outbox replay passes it so server == local).
   *  Omitted by plain server-side callers (job-events, agreement-renewal)
   *  → a fresh UUID is minted, behaving like an insert. */
  id?: string;
  title: string;
  due_date?: string | null;
  notes?: string | null;
  task_type?: TaskType;
  priority?: TaskPriority;
  related_job_id?: string | null;
  related_customer_id?: string | null;
  agreement_id?: string | null;
  site_id?: string | null;
}

/**
 * Tasks due today, ordered by priority_order DESC, then created_at ASC.
 */
export async function getTasksDueToday(
  limit: number = 20
): Promise<Task[]> {
  const supabase = await createClient();
  const today = todayUk();

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("due_date", today)
    .eq("status", "pending")
    .order("priority_order", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[getTasksDueToday]", error.code, error.message);
    throw new Error(`Failed to fetch tasks: ${error.message}`);
  }

  return data;
}

/**
 * Tasks where due_date < today and still pending.
 */
export async function getOverdueTasks(
  limit: number = 20
): Promise<Task[]> {
  const supabase = await createClient();
  const today = todayUk();

  // Personal to-dos ('todo') are deliberately excluded — this is an
  // auto-follow-up customer surface (the red "overdue tasks" alert), so a
  // missed personal to-do must not raise a customer-follow-up alarm. They
  // still live on the calendar and in "Tasks Due Today". ("Customers to
  // contact" already excludes 'todo' via its task_type allowlist.)
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("status", "pending")
    .neq("task_type", "todo")
    .lt("due_date", today)
    .order("priority_order", { ascending: false })
    .order("due_date", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[getOverdueTasks]", error.code, error.message);
    throw new Error(`Failed to fetch overdue tasks: ${error.message}`);
  }

  return data;
}

export async function getPendingTasks(limit: number = 10): Promise<Task[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("status", "pending")
    .order("priority_order", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error("[getPendingTasks]", error.code, error.message);
    throw new Error(`Failed to fetch pending tasks: ${error.message}`);
  }

  return data;
}

export interface TaskWithCustomer extends Task {
  customer: { id: string; name: string; company_name: string | null; phone: string | null } | null;
}

/**
 * Pending tasks that suggest the user should reach out to a customer —
 * review requests, follow-ups, and renewals. Includes customer details for
 * one-click dial/email.
 */
export async function getCustomerContactTasks(
  limit: number = 10
): Promise<TaskWithCustomer[]> {
  const supabase = await createClient();

  // tasks has a single FK to customers (related_customer_id); PostgREST's
  // FK disambiguator lets us point at it explicitly so there's no guesswork.
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "*, customer:customers!tasks_related_customer_id_fkey(id, name, company_name, phone)"
    )
    .eq("status", "pending")
    .in("task_type", ["review_request", "follow_up", "contract_renewal"])
    .not("related_customer_id", "is", null)
    .order("priority_order", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error("[getCustomerContactTasks]", error.code, error.message);
    return [];
  }

  return (data ?? []) as unknown as TaskWithCustomer[];
}

export async function getTasksByCustomer(
  customerId: string
): Promise<Task[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("related_customer_id", customerId)
    .order("priority_order", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("[getTasksByCustomer]", error.code, error.message);
    throw new Error(`Failed to fetch tasks: ${error.message}`);
  }

  return data;
}

export async function hasTaskForJob(jobId: string): Promise<boolean> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("related_job_id", jobId);

  if (error) {
    console.error("[hasTaskForJob]", error.code, error.message);
    return false;
  }

  return (count ?? 0) > 0;
}

export async function hasPendingTaskOfType(
  jobId: string,
  taskType: TaskType
): Promise<boolean> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("related_job_id", jobId)
    .eq("task_type", taskType)
    .eq("status", "pending");

  if (error) {
    console.error("[hasPendingTaskOfType]", error.code, error.message);
    return false;
  }

  return (count ?? 0) > 0;
}

/** L3: dedupe for the "no email on file" follow-up created at
 *  completion. Title-prefix match because the booking flow already
 *  creates a generic follow_up task per job — matching on type alone
 *  would collide with it in both directions. */
export async function hasPendingEmailReportTask(
  jobId: string
): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("related_job_id", jobId)
    .eq("status", "pending")
    .like("title", "Email service report%");

  if (error) {
    console.error("[hasPendingEmailReportTask]", error.code, error.message);
    return false;
  }
  return (count ?? 0) > 0;
}

/**
 * Check if a pending task of a given type exists for an agreement.
 */
export async function hasPendingTaskForAgreement(
  agreementId: string,
  taskType: TaskType
): Promise<boolean> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("agreement_id", agreementId)
    .eq("task_type", taskType)
    .eq("status", "pending");

  if (error) {
    console.error("[hasPendingTaskForAgreement]", error.code, error.message);
    return false;
  }

  return (count ?? 0) > 0;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const supabase = await createClient();
  const priority = input.priority ?? "medium";

  // upsert(onConflict:"id") makes a lost-ack outbox replay re-run
  // idempotent (same client id → no duplicate row). Plain server callers
  // omit `id` → a fresh UUID, so no conflict is possible and it behaves
  // like an insert. Mirrors createCustomer / createBooking.
  const { data, error } = await supabase
    .from("tasks")
    .upsert(
      {
        id: input.id ?? newId(),
        title: input.title,
        due_date: input.due_date ?? null,
        notes: input.notes ?? null,
        status: "pending",
        task_type: input.task_type ?? "general",
        priority,
        priority_order: PRIORITY_TO_ORDER[priority],
        related_job_id: input.related_job_id ?? null,
        related_customer_id: input.related_customer_id ?? null,
        agreement_id: input.agreement_id ?? null,
        site_id: input.site_id ?? null,
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[createTask]", error.code, error.message);
    throw new Error(`Failed to create task: ${error.message}`);
  }

  return data;
}

export async function completeTask(id: string): Promise<Task> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[completeTask]", error.code, error.message);
    throw new Error(`Failed to complete task: ${error.message}`);
  }

  return data;
}

/**
 * Soft-delete a task — sets `deleted_at = now()`.
 *
 * Distinct from {@link completeTask}: completing is a record that the thing
 * was done, deleting is a record that it should never have been there. A
 * mistaken or test to-do belongs in the second bucket.
 *
 * Goes through the `soft_delete_task` SECURITY DEFINER RPC (migration 050),
 * NOT a direct `.update()`: the tasks SELECT policy's `USING (deleted_at IS
 * NULL)` (029) is enforced against the post-update row, so a self-hiding
 * update is rejected with 42501 for every authenticated user — the same gap
 * 032/038/043 fixed for customers, jobs and agreements.
 *
 * Nothing depends on a task (the FKs all point outward: related_job_id,
 * related_customer_id, agreement_id, site_id), so there is no cascade and
 * no impact preview. Once deleted it stops surfacing everywhere — the
 * server reads are all RLS-filtered and the Dexie reads filter
 * `!deleted_at`.
 */
export async function deleteTask(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_task", { p_id: id });

  if (error) {
    console.error("[deleteTask]", error.code, error.message);
    throw new Error(`Failed to delete task: ${error.message}`);
  }
}
