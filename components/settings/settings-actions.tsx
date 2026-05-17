"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  runRenewalCheckAction,
  finishDayAction,
} from "@/app/(app)/settings/actions";
import { createClient } from "@/lib/supabase/client";
import { ROUTES } from "@/lib/constants/routes";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

export function RenewalCheckButton() {
  const [state, action, isPending] = useActionState(
    runRenewalCheckAction,
    initialState
  );

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-dark disabled:opacity-50"
      >
        {isPending ? "Checking…" : "Run renewal check"}
      </button>
      {state.message && (
        <p
          className={`mt-2 text-sm ${
            state.success ? "text-brand-darker" : "text-red-600"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export function FinishDayButton() {
  const [state, action, isPending] = useActionState(
    finishDayAction,
    initialState
  );

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Record today's summary"}
      </button>
      {state.message && (
        <p
          className={`mt-2 text-sm ${
            state.success ? "text-brand-darker" : "text-red-600"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(ROUTES.LOGIN);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50"
    >
      Sign out
    </button>
  );
}
