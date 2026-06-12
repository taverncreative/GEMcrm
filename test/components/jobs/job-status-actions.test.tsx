/**
 * L1 single-completion-route rule, client side.
 *
 * The detail-page status control (JobStatusActions) and the dashboard
 * quick action (JobQuickAction) no longer carry ANY button that writes
 * job_status = completed. The completion affordance is a LINK to the
 * service sheet (/jobs/:id/complete). "Start"/"Start Job"
 * (scheduled → in_progress) remains a real status write.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// The wrap hook touches Dexie + sync; the navigation shape under test
// doesn't need any of it.
vi.mock("@/lib/actions/wrap", () => ({
  useLocalFirstAction: () => [
    { success: false, errors: {}, message: null },
    vi.fn(),
    false,
  ],
}));

import {
  JobStatusActions,
  JobQuickAction,
} from "@/components/jobs/job-status-actions";

const completeHref = "/jobs/job1/complete";

const completionLink = (label: RegExp) => {
  const links = screen.queryAllByRole("link", { name: label });
  return links.find((l) => l.getAttribute("href") === completeHref) ?? null;
};

describe("JobStatusActions (job detail)", () => {
  it("scheduled → Start Job button + Complete-job LINK, no completing button", () => {
    render(<JobStatusActions jobId="job1" currentStatus="scheduled" />);

    expect(screen.getByRole("button", { name: /Start Job/ })).toBeTruthy();
    expect(completionLink(/Complete job/)).toBeTruthy();
    // No button submits a completed status any more.
    expect(screen.queryByRole("button", { name: /Start & Complete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Complete Job$/ })).toBeNull();
    expect(document.querySelector('input[name="status"][value="completed"]')).toBeNull();
  });

  it("in_progress → only the Complete-job LINK", () => {
    render(<JobStatusActions jobId="job1" currentStatus="in_progress" />);

    expect(completionLink(/Complete job/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector('input[name="status"][value="completed"]')).toBeNull();
  });

  it("completed → static chip, no actions", () => {
    render(<JobStatusActions jobId="job1" currentStatus="completed" />);

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("JobQuickAction (dashboard cards)", () => {
  it("scheduled → Start writes in_progress only", () => {
    render(<JobQuickAction jobId="job1" currentStatus="scheduled" />);

    expect(screen.getByRole("button", { name: /Start/ })).toBeTruthy();
    expect(
      document.querySelector('input[name="status"]')?.getAttribute("value")
    ).toBe("in_progress");
  });

  it("in_progress → Complete LINK to the sheet, no Done button", () => {
    render(<JobQuickAction jobId="job1" currentStatus="in_progress" />);

    expect(completionLink(/Complete/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Done/ })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("completed → renders nothing", () => {
    const { container } = render(
      <JobQuickAction jobId="job1" currentStatus="completed" />
    );
    expect(container.innerHTML).toBe("");
  });
});
