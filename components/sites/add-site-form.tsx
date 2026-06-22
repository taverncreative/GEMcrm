"use client";

import { useActionState } from "react";
import { createSiteAction } from "@/app/(app)/customers/[id]/sites/actions";
import { SiteFormFields } from "@/components/sites/site-form-fields";
import { INITIAL_ACTION_STATE } from "@/types/actions";

interface AddSiteFormProps {
  customerId: string;
}

export function AddSiteForm({ customerId }: AddSiteFormProps) {
  const [state, formAction, isPending] = useActionState(
    createSiteAction,
    INITIAL_ACTION_STATE
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="customer_id" value={customerId} />

      <SiteFormFields errors={state.errors} />

      {state.message && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {state.message}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save Site"}
        </button>
      </div>
    </form>
  );
}
