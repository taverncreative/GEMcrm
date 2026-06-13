"use client";

import { useId } from "react";

/**
 * Shared arrival-window picker (Q1). Used by the booking modal and (Q2)
 * quick capture.
 *
 * Model: a window is a START + optional END, both "HH:MM" strings (or
 * "" for none). The parent owns the two values and persists them as
 * `job_time` (start — also the soonest-first sort key) and
 * `job_time_end`. A single start with no end is a precise booked time;
 * no start at all is "all day".
 *
 * UX: one-tap presets for the common cases the client asked for
 * (AM 9–12, PM 12–5, Anytime), plus a Custom mode exposing raw
 * start/end <input type="time"> for anything else. Presets and custom
 * write the same two values — there's no separate stored "slot".
 */

const PRESETS: { key: string; label: string; start: string; end: string }[] = [
  { key: "am", label: "AM (9–12)", start: "09:00", end: "12:00" },
  { key: "pm", label: "PM (12–5)", start: "12:00", end: "17:00" },
  { key: "anytime", label: "Anytime", start: "", end: "" },
];

export interface TimeWindow {
  start: string;
  end: string;
}

export function TimeWindowPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: TimeWindow;
  onChange: (next: TimeWindow) => void;
  idPrefix?: string;
}) {
  const autoId = useId();
  const pfx = idPrefix ?? autoId;

  // Which preset (if any) the current value matches — drives the
  // selected styling and decides whether the custom row is shown.
  const matched = PRESETS.find(
    (p) => p.start === value.start && p.end === value.end
  );
  // Custom mode = a non-empty value that isn't one of the presets, OR
  // the operator has explicitly opened custom (start set, no preset).
  const isCustom = !matched;

  const setPreset = (p: (typeof PRESETS)[number]) =>
    onChange({ start: p.start, end: p.end });

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const selected = matched?.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                selected
                  ? "border-brand bg-brand text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() =>
            // Opening Custom seeds a sensible default window if the
            // current value is empty, so the time inputs aren't blank.
            onChange(
              value.start
                ? value
                : { start: "09:00", end: "10:00" }
            )
          }
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            isCustom
              ? "border-brand bg-brand text-white"
              : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          Custom
        </button>
      </div>

      {isCustom && (
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor={`${pfx}-start`} className="sr-only">
            Window start
          </label>
          <input
            id={`${pfx}-start`}
            type="time"
            value={value.start}
            onChange={(e) => onChange({ start: e.target.value, end: value.end })}
            className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <span className="text-sm text-gray-400">to</span>
          <label htmlFor={`${pfx}-end`} className="sr-only">
            Window end
          </label>
          <input
            id={`${pfx}-end`}
            type="time"
            value={value.end}
            // End must not precede start; clear it if it does so the
            // window collapses to the single start time rather than
            // storing an inverted pair.
            onChange={(e) =>
              onChange({
                start: value.start,
                end: e.target.value && e.target.value <= value.start ? "" : e.target.value,
              })
            }
            className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>
      )}

      <p className="mt-1.5 text-[11px] text-gray-400">
        {value.start
          ? value.end
            ? `Arrival window ${value.start}–${value.end}`
            : `Arrives around ${value.start}`
          : "No specific time — shown as “all day”."}
      </p>
    </div>
  );
}
