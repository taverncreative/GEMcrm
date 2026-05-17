"use client";

import { useActionState } from "react";
import { createSiteAction } from "@/app/(app)/customers/[id]/sites/actions";
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

      <div>
        <label htmlFor="address_line_1" className="block text-sm font-medium text-gray-700">
          Address Line 1 <span className="text-red-500">*</span>
        </label>
        <input
          id="address_line_1"
          name="address_line_1"
          type="text"
          required
          autoFocus
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          placeholder="Street address"
        />
        {state.errors.address_line_1 && (
          <p className="mt-1 text-sm text-red-500">{state.errors.address_line_1}</p>
        )}
      </div>

      <div>
        <label htmlFor="address_line_2" className="block text-sm font-medium text-gray-700">
          Address Line 2
        </label>
        <input
          id="address_line_2"
          name="address_line_2"
          type="text"
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          placeholder="Flat, unit, etc."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="town" className="block text-sm font-medium text-gray-700">
            Town <span className="text-red-500">*</span>
          </label>
          <input
            id="town"
            name="town"
            type="text"
            required
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="Town"
          />
          {state.errors.town && (
            <p className="mt-1 text-sm text-red-500">{state.errors.town}</p>
          )}
        </div>

        <div>
          <label htmlFor="county" className="block text-sm font-medium text-gray-700">
            County <span className="text-red-500">*</span>
          </label>
          <input
            id="county"
            name="county"
            type="text"
            required
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="County"
          />
          {state.errors.county && (
            <p className="mt-1 text-sm text-red-500">{state.errors.county}</p>
          )}
        </div>
      </div>

      <div className="max-w-xs">
        <label htmlFor="postcode" className="block text-sm font-medium text-gray-700">
          Postcode <span className="text-red-500">*</span>
        </label>
        <input
          id="postcode"
          name="postcode"
          type="text"
          required
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 uppercase placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          placeholder="Postcode"
        />
        {state.errors.postcode && (
          <p className="mt-1 text-sm text-red-500">{state.errors.postcode}</p>
        )}
      </div>

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
