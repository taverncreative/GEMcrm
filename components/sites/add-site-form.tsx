"use client";

import { useActionState, useState } from "react";
import { createSiteAction } from "@/app/(app)/customers/[id]/sites/actions";
import {
  SiteFormFields,
  siteFieldValues,
  type SiteFieldValues,
} from "@/components/sites/site-form-fields";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { INITIAL_ACTION_STATE } from "@/types/actions";

interface AddSiteFormProps {
  customerId: string;
}

/**
 * Add Site form.
 *
 * ONLINE ONLY, matching its sibling {@link EditSiteForm}: `createSiteAction`
 * is a plain server action with no Dexie mirror and no outbox entry, so
 * offline it throws straight into the (app) route error boundary — which
 * replaces the whole page with the offline screen and takes the typed
 * address with it. The gate below blocks the submit and says so instead.
 *
 * Fields are CONTROLLED (see {@link SiteFormFields}): this is a
 * `<form action={fn}>`, and React 19 resets uncontrolled inputs once the
 * action settles, so a server validation bounce used to wipe the address.
 * On success the action redirects, so there is nothing to clear.
 */
export function AddSiteForm({ customerId }: AddSiteFormProps) {
  const [state, formAction, isPending] = useActionState(
    createSiteAction,
    INITIAL_ACTION_STATE
  );
  const online = useIsOnline();
  const [values, setValues] = useState<SiteFieldValues>(() =>
    siteFieldValues()
  );

  function handleChange(field: keyof SiteFieldValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="customer_id" value={customerId} />

      <SiteFormFields
        errors={state.errors}
        values={values}
        onChange={handleChange}
      />

      {state.message && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {state.message}
        </div>
      )}

      {!online && (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          You&rsquo;re offline, adding a site needs a connection. What
          you&rsquo;ve typed stays here until you&rsquo;re back online.
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending || !online}
          title={online ? undefined : "Online required"}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save Site"}
        </button>
      </div>
    </form>
  );
}
