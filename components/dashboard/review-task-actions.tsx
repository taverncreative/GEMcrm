"use client";

import { useActionState } from "react";
import {
  sendReviewSMSAction,
  sendReviewEmailAction,
} from "@/app/(app)/dashboard/review-actions";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

export function ReviewTaskActions({
  taskId,
  jobId,
  customerId,
}: {
  taskId: string;
  jobId: string;
  customerId: string;
}) {
  const [smsState, smsAction, smsPending] = useActionState(
    sendReviewSMSAction,
    initialState
  );
  const [emailState, emailAction, emailPending] = useActionState(
    sendReviewEmailAction,
    initialState
  );

  if (smsState.success || emailState.success) {
    return <span className="text-xs text-brand-darker">Sent ✓</span>;
  }

  return (
    <div className="flex items-center gap-1">
      <form action={smsAction}>
        <input type="hidden" name="job_id" value={jobId} />
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="task_id" value={taskId} />
        <button
          type="submit"
          disabled={smsPending}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          title={smsState.message ?? "Send review request via SMS"}
        >
          {smsPending ? "..." : "SMS"}
        </button>
      </form>
      <form action={emailAction}>
        <input type="hidden" name="job_id" value={jobId} />
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="task_id" value={taskId} />
        <button
          type="submit"
          disabled={emailPending}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          title={emailState.message ?? "Send review request via email"}
        >
          {emailPending ? "..." : "Email"}
        </button>
      </form>
    </div>
  );
}
