"use server";

/**
 * Server-action bridge for the sync engine's pull loop.
 *
 * `lib/data/sync-pulls.ts` lives on the server (uses the cookie-bound
 * Supabase client + the SECURITY DEFINER RPCs from migration 030).
 * The client-side pull loop in `lib/sync/pull.ts` can't import it
 * directly because doing so drags `lib/supabase/server.ts` (cookies,
 * `next/headers`) into the client bundle.
 *
 * These thin wrappers expose each pull as a server action. Auth is
 * enforced via `requireUser()` per call — the SECURITY DEFINER
 * function would also catch it inside Postgres, but rejecting at the
 * action boundary is faster and surfaces a clearer 401-like outcome
 * to the sync engine's error classifier.
 *
 * Each returns the row array. The engine's pull loop merges into Dexie.
 */

import { requireUser } from "@/lib/auth/require-user";
import {
  pullCustomersSince,
  pullSitesSince,
  pullJobsSince,
  pullAgreementsSince,
  pullTasksSince,
} from "@/lib/data/sync-pulls";
import type {
  Customer,
  Site,
  Job,
  Agreement,
  Task,
} from "@/types/database";

export async function pullCustomersAction(
  since: string | null
): Promise<Customer[]> {
  await requireUser();
  return pullCustomersSince(since);
}

export async function pullSitesAction(
  since: string | null
): Promise<Site[]> {
  await requireUser();
  return pullSitesSince(since);
}

export async function pullJobsAction(
  since: string | null
): Promise<Job[]> {
  await requireUser();
  return pullJobsSince(since);
}

export async function pullAgreementsAction(
  since: string | null
): Promise<Agreement[]> {
  await requireUser();
  return pullAgreementsSince(since);
}

export async function pullTasksAction(
  since: string | null
): Promise<Task[]> {
  await requireUser();
  return pullTasksSince(since);
}
