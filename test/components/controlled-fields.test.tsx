/**
 * Controlled-field regressions: typed input must survive a failed submit.
 *
 * React 19 resets UNCONTROLLED inputs once a `<form action={fn}>` action
 * settles — including when the action early-returns without doing anything.
 * The agreement wizard hit this first (a validation bounce wiped a filled
 * contract form); these are the three siblings the audit found.
 *
 * Each test drives a real failing submit and asserts the typed values are
 * still on screen afterwards, which is the operator-visible contract. The
 * happy paths and the shared-component regression are covered too, because
 * converting a SHARED field-set is the risky half of this change.
 */
import { Component, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

/** Stand-in for the (app) route error boundary, so a re-thrown action
 *  error is caught here instead of failing the run. */
class ErrorBoundary extends Component<
  { children: ReactNode; onError: (e: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? (
      <div data-testid="boundary">Something went wrong</div>
    ) : (
      this.props.children
    );
  }
}

// ─── Module mocks (hoisted before imports) ─────────────────────────

const createBookingFn = vi.fn();
vi.mock("@/app/(app)/sites/[id]/bookings/actions", () => ({
  createBookingAction: (...args: unknown[]) => createBookingFn(...args),
}));

const submitFeedbackFn = vi.fn();
vi.mock("@/app/(app)/settings/actions", () => ({
  submitFeatureRequestAction: (...args: unknown[]) => submitFeedbackFn(...args),
}));

const createSiteFn = vi.fn();
vi.mock("@/app/(app)/customers/[id]/sites/actions", () => ({
  createSiteAction: (...args: unknown[]) => createSiteFn(...args),
}));

const updateSiteFn = vi.fn();
vi.mock("@/app/(app)/sites/[id]/actions", () => ({
  updateSiteAction: (...args: unknown[]) => updateSiteFn(...args),
}));

let mockOnline = true;
vi.mock("@/lib/hooks/use-is-online", () => ({
  useIsOnline: () => mockOnline,
}));

// The global setup stubs next/navigation but not usePathname, which the
// feedback form reads to decide whether to refresh the past-requests list.
// A local mock replaces the global one wholesale, so re-supply both.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/settings",
}));

// ─── Imports (AFTER mocks) ─────────────────────────────────────────

import { QuickBookingForm } from "@/components/jobs/quick-booking-form";
import { FeatureRequestForm } from "@/components/settings/feature-request-form";
import { AddSiteForm } from "@/components/sites/add-site-form";
import { EditSiteForm } from "@/components/sites/edit-site-form";
import type { Site } from "@/types/database";

const BOUNCE = { success: false, errors: {}, message: "Something went wrong" };

beforeEach(() => {
  mockOnline = true;
  createBookingFn.mockReset();
  submitFeedbackFn.mockReset();
  createSiteFn.mockReset();
  updateSiteFn.mockReset();
});

// ─── F7: quick booking ─────────────────────────────────────────────

describe("QuickBookingForm — typed input survives a failed submit", () => {
  it("keeps notes, value and date when the client gate blocks the submit", async () => {
    const user = userEvent.setup();
    render(<QuickBookingForm siteId="site-1" />);

    const notes = screen.getByLabelText(/notes/i) as HTMLTextAreaElement;
    const value = screen.getByLabelText(/job value/i) as HTMLInputElement;
    const date = screen.getByLabelText(/^date/i) as HTMLInputElement;

    await user.type(notes, "Side entrance, gate code 1234");
    await user.type(value, "185");
    await user.clear(date);
    await user.type(date, "2026-09-15");

    // Tick the "Other" pest pill and DON'T describe it — this is the gate
    // that early-returns, which is what used to trigger React's reset.
    await user.click(screen.getByRole("button", { name: "Other" }));
    await user.click(screen.getByRole("button", { name: /add booking/i }));

    expect(await screen.findByText(/describe the other pest/i)).toBeInTheDocument();
    // The action never ran...
    expect(createBookingFn).not.toHaveBeenCalled();
    // ...and the operator's typing is still there.
    expect(notes.value).toBe("Side entrance, gate code 1234");
    expect(value.value).toBe("185");
    expect(date.value).toBe("2026-09-15");
  });

  it("keeps notes, value and date after a SERVER validation bounce", async () => {
    createBookingFn.mockResolvedValue({
      success: false,
      errors: { job_date: "That date is in the past" },
      message: null,
    });
    const user = userEvent.setup();
    render(<QuickBookingForm siteId="site-1" defaultCallType="routine" />);

    const notes = screen.getByLabelText(/notes/i) as HTMLTextAreaElement;
    const value = screen.getByLabelText(/job value/i) as HTMLInputElement;

    await user.type(notes, "Ring the bell twice");
    await user.type(value, "240");
    await user.click(screen.getByRole("button", { name: /add booking/i }));

    await waitFor(() => expect(createBookingFn).toHaveBeenCalled());
    await screen.findByText(/that date is in the past/i);

    expect(notes.value).toBe("Ring the bell twice");
    expect(value.value).toBe("240");
  });

  it("still submits the typed values on the happy path", async () => {
    createBookingFn.mockResolvedValue({
      success: true,
      errors: {},
      message: null,
    });
    const user = userEvent.setup();
    render(<QuickBookingForm siteId="site-1" defaultCallType="routine" />);

    await user.type(screen.getByLabelText(/notes/i), "Leave gate closed");
    await user.type(screen.getByLabelText(/job value/i), "99.50");
    await user.click(screen.getByRole("button", { name: /add booking/i }));

    await waitFor(() => expect(createBookingFn).toHaveBeenCalled());
    const fd = createBookingFn.mock.calls[0][1] as FormData;
    expect(fd.get("report_notes")).toBe("Leave gate closed");
    // "99.5", not "99.50": jsdom's number input drops the trailing zero.
    // Verified identical for a controlled and an uncontrolled input, so it
    // is the environment, not this change.
    expect(fd.get("value")).toBe("99.5");
    expect(fd.get("job_date")).toBeTruthy();
    expect(await screen.findByText(/booking added to calendar/i)).toBeInTheDocument();
  });
});

// ─── F6: feedback form ─────────────────────────────────────────────

describe("FeatureRequestForm — the typed message survives a failed submit", () => {
  it("keeps the message after a server validation bounce", async () => {
    submitFeedbackFn.mockResolvedValue({
      success: false,
      errors: { message: "Too short" },
      message: null,
    });
    const user = userEvent.setup();
    render(<FeatureRequestForm currentUserEmail="nate@example.com" />);

    const box = screen.getByLabelText(/what's on your mind/i) as HTMLTextAreaElement;
    await user.type(box, "The calendar should show the weekday");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(submitFeedbackFn).toHaveBeenCalled());
    await screen.findByText(/too short/i);
    expect(box.value).toBe("The calendar should show the weekday");
  });

  it("DOCUMENTS the remaining gap: a thrown action still loses the message", async () => {
    // Not a wish, a fact: an unhandled rejection out of a form action
    // propagates to the route error boundary, which replaces the page and
    // takes the form with it — controlled state cannot help, because the
    // component is gone. Pinned so nobody assumes the controlled fix
    // covers this case too. Fixing it needs a graceful shim, and the one
    // in the repo breaks the send (see the note in the component).
    submitFeedbackFn.mockRejectedValue(new TypeError("fetch failed"));
    const user = userEvent.setup();
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <FeatureRequestForm currentUserEmail="nate@example.com" />
      </ErrorBoundary>
    );

    await user.type(
      screen.getByLabelText(/what's on your mind/i),
      "Please add a dark mode"
    );
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    // The form is gone, so there is no textarea left to preserve.
    expect(screen.getByTestId("boundary")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/what's on your mind/i)
    ).not.toBeInTheDocument();
  });

  it("CLEARS the box on a successful send (React's reset used to do this)", async () => {
    submitFeedbackFn.mockResolvedValue({
      success: true,
      errors: {},
      message: null,
      submittedAt: "2026-08-03T14:03:22.000Z",
    });
    const user = userEvent.setup();
    render(<FeatureRequestForm currentUserEmail="nate@example.com" />);

    const box = screen.getByLabelText(/what's on your mind/i) as HTMLTextAreaElement;
    await user.type(box, "Ship it");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(box.value).toBe(""));
    expect(await screen.findByText(/thanks, request logged/i)).toBeInTheDocument();
  });

  it("leaves the text alone when the offline gate blocks the send", async () => {
    mockOnline = false;
    const user = userEvent.setup();
    render(<FeatureRequestForm currentUserEmail="nate@example.com" />);

    const box = screen.getByLabelText(/what's on your mind/i) as HTMLTextAreaElement;
    await user.type(box, "Written with no signal");
    expect(screen.getByRole("button", { name: /offline/i })).toBeDisabled();
    expect(box.value).toBe("Written with no signal");
    expect(submitFeedbackFn).not.toHaveBeenCalled();
  });
});

// ─── F8: add-site (+ the shared field-set) ─────────────────────────

const SITE = {
  id: "site-9",
  address_line_1: "1 Industrial Way",
  address_line_2: "Unit 4",
  town: "Testford",
  county: "Kent",
  postcode: "TF1 1AA",
} as unknown as Site;

describe("AddSiteForm — typed address survives, and offline is gated", () => {
  it("keeps the whole typed address after a server bounce", async () => {
    createSiteFn.mockResolvedValue(BOUNCE);
    const user = userEvent.setup();
    render(<AddSiteForm customerId="cust-1" />);

    await user.type(screen.getByLabelText(/address line 1/i), "9 Test Street");
    await user.type(screen.getByLabelText(/address line 2/i), "Rear unit");
    await user.type(screen.getByLabelText(/town/i), "Testford");
    await user.type(screen.getByLabelText(/county/i), "Kent");
    await user.type(screen.getByLabelText(/postcode/i), "TF9 9ZZ");

    await user.click(screen.getByRole("button", { name: /save site/i }));
    await waitFor(() => expect(createSiteFn).toHaveBeenCalled());
    await screen.findByText(/something went wrong/i);

    expect((screen.getByLabelText(/address line 1/i) as HTMLInputElement).value).toBe("9 Test Street");
    expect((screen.getByLabelText(/address line 2/i) as HTMLInputElement).value).toBe("Rear unit");
    expect((screen.getByLabelText(/town/i) as HTMLInputElement).value).toBe("Testford");
    expect((screen.getByLabelText(/county/i) as HTMLInputElement).value).toBe("Kent");
    expect((screen.getByLabelText(/postcode/i) as HTMLInputElement).value).toBe("TF9 9ZZ");
  });

  it("gates the submit offline instead of letting the action throw", async () => {
    mockOnline = false;
    const user = userEvent.setup();
    render(<AddSiteForm customerId="cust-1" />);

    await user.type(screen.getByLabelText(/address line 1/i), "9 Test Street");

    const save = screen.getByRole("button", { name: /save site/i });
    expect(save).toBeDisabled();
    expect(screen.getByText(/adding a site needs a connection/i)).toBeInTheDocument();

    await user.click(save);
    expect(createSiteFn).not.toHaveBeenCalled();
    // The address is untouched — no error boundary, nothing lost.
    expect((screen.getByLabelText(/address line 1/i) as HTMLInputElement).value).toBe("9 Test Street");
  });

  it("submits the typed address on the happy path", async () => {
    createSiteFn.mockResolvedValue({ success: true, errors: {}, message: null });
    const user = userEvent.setup();
    render(<AddSiteForm customerId="cust-1" />);

    await user.type(screen.getByLabelText(/address line 1/i), "12 High St");
    await user.type(screen.getByLabelText(/town/i), "Testford");
    await user.type(screen.getByLabelText(/county/i), "Kent");
    await user.click(screen.getByRole("button", { name: /save site/i }));

    await waitFor(() => expect(createSiteFn).toHaveBeenCalled());
    const fd = createSiteFn.mock.calls[0][1] as FormData;
    expect(fd.get("address_line_1")).toBe("12 High St");
    expect(fd.get("town")).toBe("Testford");
    expect(fd.get("county")).toBe("Kent");
    expect(fd.get("customer_id")).toBe("cust-1");
  });
});

// ─── Shared-component regression: the EDIT form must be unchanged ──

describe("EditSiteForm — unaffected by the shared field-set going controlled", () => {
  it("pre-fills every field from the existing site", () => {
    render(<EditSiteForm site={SITE} />);
    expect((screen.getByLabelText(/address line 1/i) as HTMLInputElement).value).toBe("1 Industrial Way");
    expect((screen.getByLabelText(/address line 2/i) as HTMLInputElement).value).toBe("Unit 4");
    expect((screen.getByLabelText(/town/i) as HTMLInputElement).value).toBe("Testford");
    expect((screen.getByLabelText(/county/i) as HTMLInputElement).value).toBe("Kent");
    expect((screen.getByLabelText(/postcode/i) as HTMLInputElement).value).toBe("TF1 1AA");
  });

  it("submits edited values through FormData exactly as before", async () => {
    updateSiteFn.mockResolvedValue({
      success: false,
      errors: {},
      message: "Save failed",
    });
    const user = userEvent.setup();
    render(<EditSiteForm site={SITE} />);

    const town = screen.getByLabelText(/town/i) as HTMLInputElement;
    await user.clear(town);
    await user.type(town, "Newtown");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateSiteFn).toHaveBeenCalled());
    expect(updateSiteFn.mock.calls[0][0]).toBe("site-9");
    const fd = updateSiteFn.mock.calls[0][1] as FormData;
    expect(fd.get("town")).toBe("Newtown");
    expect(fd.get("address_line_1")).toBe("1 Industrial Way");
    expect(fd.get("postcode")).toBe("TF1 1AA");
  });

  it("keeps the edited values on screen after a failed save", async () => {
    updateSiteFn.mockResolvedValue({
      success: false,
      errors: {},
      message: "Save failed",
    });
    const user = userEvent.setup();
    render(<EditSiteForm site={SITE} />);

    const line1 = screen.getByLabelText(/address line 1/i) as HTMLInputElement;
    await user.clear(line1);
    await user.type(line1, "2 Industrial Way");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await screen.findByText(/save failed/i);
    expect(line1.value).toBe("2 Industrial Way");
  });

  it("still gates on connectivity", () => {
    mockOnline = false;
    render(<EditSiteForm site={SITE} />);
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });
});
