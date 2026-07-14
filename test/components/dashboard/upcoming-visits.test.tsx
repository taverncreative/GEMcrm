/**
 * UpcomingVisits — overdue rows render "red and angry".
 *
 * Pins the display half of the overdue-stays change:
 *   - a past-date visit is flagged "Overdue by N days" with the red row
 *     styling (border-red-200 / bg-red-50);
 *   - today and future visits are NOT flagged overdue;
 *   - a light "Overdue (N)" divider marks the boundary above the first
 *     upcoming visit.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UpcomingVisits } from "@/components/dashboard/upcoming-visits";
import type { JobWithContext } from "@/lib/data/jobs";

// Local YYYY-MM-DD offset by whole days from today (matches how the
// component parses job_date and compares against the local "today").
function localDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function job(id: string, jobDate: string, name: string): JobWithContext {
  return {
    id,
    job_date: jobDate,
    site: { customer: { name, company_name: null } },
  } as unknown as JobWithContext;
}

describe("UpcomingVisits — overdue styling", () => {
  it("flags a past visit as overdue, red, and above a divider; today/future are not", () => {
    render(
      <UpcomingVisits
        jobs={[
          job("p", localDateOffset(-5), "Past Farm"),
          job("t", localDateOffset(0), "Today Cafe"),
          job("f", localDateOffset(10), "Future Shop"),
        ]}
      />
    );

    // The overdue past visit is flagged, and only it.
    expect(screen.getByText(/Overdue by 5 days/)).toBeInTheDocument();
    expect(screen.queryAllByText(/Overdue by/)).toHaveLength(1);

    // Red row styling on the overdue row.
    const overdueLink = screen.getByText("Past Farm").closest("a");
    expect(overdueLink?.className).toContain("bg-red-50");

    // Divider counts the one overdue visit, above the first upcoming row.
    expect(screen.getByText(/Overdue \(1\)/)).toBeInTheDocument();

    // Today and future rows are present but not styled overdue.
    const futureLink = screen.getByText("Future Shop").closest("a");
    expect(futureLink?.className).not.toContain("bg-red-50");
  });

  it("no divider and no overdue flags when everything is upcoming", () => {
    render(
      <UpcomingVisits
        jobs={[
          job("t", localDateOffset(0), "Today Cafe"),
          job("f", localDateOffset(3), "Soon Ltd"),
        ]}
      />
    );
    expect(screen.queryByText(/Overdue by/)).toBeNull();
    expect(screen.queryByText(/Overdue \(/)).toBeNull();
  });
});
