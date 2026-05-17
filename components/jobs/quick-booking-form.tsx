"use client";

import { useActionState, useState } from "react";
import { createBookingAction } from "@/app/(app)/sites/[id]/bookings/actions";
import { CALL_TYPES } from "@/lib/validation/booking";
import { CALL_TYPE_LABELS, COMMON_PESTS } from "@/lib/constants/job-labels";
import { todayUk } from "@/lib/utils/today-uk";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

interface QuickBookingFormProps {
  siteId: string;
  defaultPests?: string[];
  defaultCallType?: string;
}

/**
 * 30-second booking form — the "customer just rang" flow.
 *
 * Just date + call type + (optional) pest species + (optional) notes.
 * No signatures, no findings — those come later on-site via the Service
 * Sheet completion page.
 */
export function QuickBookingForm({
  siteId,
  defaultPests = [],
  defaultCallType,
}: QuickBookingFormProps) {
  const [state, action, isPending] = useActionState(
    createBookingAction,
    initialState
  );
  const [selectedPests, setSelectedPests] = useState<string[]>(defaultPests);

  function togglePest(pest: string) {
    setSelectedPests((prev) =>
      prev.includes(pest) ? prev.filter((p) => p !== pest) : [...prev, pest]
    );
  }

  if (state.success) {
    return (
      <div className="rounded-xl border border-brand bg-brand-soft p-4 text-sm">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 text-brand-darker"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m4.5 12.75 6 6 9-13.5"
            />
          </svg>
          <p className="font-medium text-brand-darker">Booking added to calendar</p>
        </div>
        <p className="mt-1 text-xs text-brand-darker">
          Fill the Service Sheet from the job page on the day of the visit.
        </p>
      </div>
    );
  }

  const inputClass =
    "mt-1 block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelClass = "block text-sm font-medium text-gray-700 mb-0.5";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="site_id" value={siteId} />
      <input
        type="hidden"
        name="pest_species"
        value={JSON.stringify(selectedPests)}
      />

      {state.message && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-600">
          {state.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="job_date" className={labelClass}>
            Date <span className="text-red-500">*</span>
          </label>
          <input
            id="job_date"
            name="job_date"
            type="date"
            required
            defaultValue={todayUk()}
            className={inputClass}
          />
          {state.errors.job_date && (
            <p className="mt-1 text-sm text-red-500">{state.errors.job_date}</p>
          )}
        </div>

        <div>
          <label htmlFor="call_type" className={labelClass}>
            Call Type <span className="text-red-500">*</span>
          </label>
          <select
            id="call_type"
            name="call_type"
            required
            defaultValue={defaultCallType ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              Select call type…
            </option>
            {CALL_TYPES.map((type) => (
              <option key={type} value={type}>
                {CALL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {state.errors.call_type && (
            <p className="mt-1 text-sm text-red-500">{state.errors.call_type}</p>
          )}
        </div>
      </div>

      <div>
        <label className={labelClass}>Pest Species (optional)</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {COMMON_PESTS.map((pest) => (
            <button
              key={pest}
              type="button"
              onClick={() => togglePest(pest)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                selectedPests.includes(pest)
                  ? "border-brand bg-brand text-white"
                  : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              {pest}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="value" className={labelClass}>
          Job Value (optional)
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
            £
          </span>
          <input
            id="value"
            type="number"
            name="value"
            min={0}
            step="0.01"
            placeholder="0.00"
            className={`${inputClass} pl-8`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="report_notes" className={labelClass}>
          Notes (optional)
        </label>
        <textarea
          id="report_notes"
          name="report_notes"
          rows={2}
          placeholder="e.g. customer requested morning visit, side entrance, etc."
          className={inputClass}
        />
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add Booking"}
        </button>
      </div>
    </form>
  );
}
