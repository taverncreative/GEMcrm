"use client";

import { useActionState } from "react";
import { generateReportAction } from "@/app/(app)/jobs/[id]/report/actions";
import { INITIAL_ACTION_STATE } from "@/types/actions";

interface ReportActionsProps {
  jobId: string;
  existingPdfUrl: string | null;
}

export function ReportActions({ jobId, existingPdfUrl }: ReportActionsProps) {
  const [state, formAction, isPending] = useActionState(
    generateReportAction,
    INITIAL_ACTION_STATE
  );

  const pdfUrl = state.success && state.message ? state.message : existingPdfUrl;

  return (
    <div className="space-y-3">
      <form action={formAction}>
        <input type="hidden" name="job_id" value={jobId} />
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isPending
            ? "Generating..."
            : pdfUrl
              ? "Regenerate Report"
              : "Generate Report"}
        </button>
      </form>

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

      {!state.success && state.message && (
        <p className="text-sm text-red-500">{state.message}</p>
      )}
    </div>
  );
}
