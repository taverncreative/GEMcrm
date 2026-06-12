"use client";

import { useActionState } from "react";
import { generateReportAction } from "@/app/(app)/jobs/[id]/report/actions";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { INITIAL_ACTION_STATE } from "@/types/actions";

interface ReportActionsProps {
  jobId: string;
  existingPdfUrl: string | null;
  /** isServiceSheetFilled(job) — the unfilled-sheet gate. */
  sheetFilled: boolean;
}

// `generateReportAction` is skip-classified (server-side puppeteer +
// Storage upload — cannot run offline). When the operator is offline,
// the button stays disabled and a small inline note explains why
// rather than letting them tap into a confusing spinner that fails.
//
// "Regenerate Report" is a RECOVERY tool — for sheets whose auto-
// generated PDF didn't land — not a routine step, hence the label even
// when no PDF exists yet. It is gated on a filled sheet so it can
// never produce a placeholder PDF from an empty one; the server action
// enforces the same check.
//
// The "Download PDF" link is also gated on a real URL existing. If
// step 7 starts on a job whose report hasn't been pulled into the
// (online-only) read yet, the link is simply hidden.
export function ReportActions({
  jobId,
  existingPdfUrl,
  sheetFilled,
}: ReportActionsProps) {
  const [state, formAction, isPending] = useActionState(
    generateReportAction,
    INITIAL_ACTION_STATE
  );
  const online = useIsOnline();

  const pdfUrl = state.success && state.message ? state.message : existingPdfUrl;
  const buttonDisabled = isPending || !online || !sheetFilled;

  return (
    <div className="space-y-3">
      <form action={formAction}>
        <input type="hidden" name="job_id" value={jobId} />
        <button
          type="submit"
          disabled={buttonDisabled}
          title={
            !sheetFilled
              ? "Service sheet not filled in"
              : !online
                ? "Needs internet — try again when back online"
                : undefined
          }
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-75 hover:bg-gray-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <>
              <Spinner />
              <span>Regenerating…</span>
            </>
          ) : (
            "Regenerate Report"
          )}
        </button>
      </form>

      {!sheetFilled && (
        <p className="text-xs text-amber-600">
          Service sheet not filled in — a report can only be generated
          from a completed sheet.
        </p>
      )}

      {sheetFilled && !online && (
        <p className="text-xs text-gray-500">
          PDF generation needs internet. Reconnect and tap to generate.
        </p>
      )}

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-lg border border-gray-200 px-4 py-2.5 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Download PDF
        </a>
      )}

      {!pdfUrl && online && sheetFilled && (
        <p className="text-xs text-gray-400">
          No PDF yet — tap above to regenerate it from the sheet.
        </p>
      )}

      {!state.success && state.message && (
        <p className="text-sm text-red-500">{state.message}</p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}
