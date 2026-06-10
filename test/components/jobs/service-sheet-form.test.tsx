/**
 * Component tests for ServiceSheetForm — optimistic local-first flow
 * (offline-pwa pass B, the 2c6d434 booking treatment).
 *
 * The contract pinned here:
 *   (a) "Review & Complete" client-validates and opens the LOCAL review
 *       modal — the server action is NOT called.
 *   (b) Customer Present selection persists across re-renders.
 *   (c) Validation is client-side now: errors render inline, typed
 *       fields survive, the server is never involved.
 *   (d) The review modal closes via "Back to edit" and reopens on a
 *       second review.
 *   (e) Confirming enqueues ONE combined outbox entry (finalize +
 *       email choice + signatures inline) and NEVER calls the server
 *       at submit — drainOutbox owns all server sync.
 *   (f) Customer Present = No passes client validation (the shape that
 *       used to die on the server's null-vs-undefined Zod bounce).
 *
 * The signature pad and photo upload are mocked: their internals
 * require canvas / File APIs jsdom doesn't supply, and they're not
 * what we're testing here.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must be hoisted before imports) ─────────────────

// The actions module pulls in server-only imports; stub it. The form
// only calls completeServiceSheetAction — and in the optimistic flow it
// must NOT call even that at submit (asserted per test).
const completeFn = vi.fn();
vi.mock("@/app/(app)/jobs/[id]/complete/actions", () => ({
  completeServiceSheetAction: (...args: unknown[]) => completeFn(...args),
  approveServiceSheetAction: vi.fn(),
}));

// SignaturePad: rendered as a button that, when clicked, fires
// onSignature with a known data-URL. Saves us from needing canvas.
vi.mock("@/components/ui/signature-pad", () => ({
  SignaturePad: ({
    label,
    onSignature,
  }: {
    label: string;
    onSignature: (s: string) => void;
    onClear: () => void;
  }) => (
    <button
      type="button"
      data-testid={`sigpad-${label || "tech"}`}
      onClick={() => onSignature("data:image/png;base64,STUB")}
    >
      Mock sigpad — {label || "tech"}
    </button>
  ),
}));

// PhotoUpload: not exercised in these tests; render a benign stub.
vi.mock("@/components/ui/photo-upload", () => ({
  PhotoUpload: () => <div data-testid="mock-photo-upload" />,
}));

// ─── Imports (AFTER mocks) ─────────────────────────────────────────

import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { db } from "@/lib/db";

beforeEach(async () => {
  completeFn.mockReset();
  await db.outbox.clear();
  await db.service_sheet_drafts.clear();
});

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Walk steps 1→5, filling every required field, signing, ready to
 * review. Uses the numbered step-indicator buttons at the top of the
 * form rather than the per-step "Next" buttons because all per-step
 * Next buttons live in the DOM at once (steps are render-gated via
 * a CSS `hidden` class which jsdom doesn't apply since we disable
 * CSS in vitest.config.ts).
 */
async function fillAllSteps(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Routine"));

  await user.click(screen.getByRole("button", { name: "Mice" }));
  await user.type(
    screen.getByLabelText(/^Findings/i),
    "Mice droppings in kitchen"
  );
  await user.type(
    screen.getByLabelText(/^Recommendations/i),
    "Place bait stations"
  );
  await user.click(screen.getByRole("button", { name: "Rodenticide Used" }));
  await user.type(
    screen.getByLabelText(/^Pesticides Used/i),
    "Bromadiolone 0.005%"
  );

  await user.type(
    screen.getByLabelText(/Risk Assessment Comments/i),
    "Standard rodent treatment, no special hazards"
  );

  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByTestId("sigpad-tech"));
}

const reviewButton = () =>
  screen.getByRole("button", { name: /Review & Complete/ });
const reviewHeading = () =>
  screen.getByRole("heading", { name: /Review & Complete/ });

// ─── (a) Review opens locally, no server call ───────────────────────

describe("ServiceSheetForm — review step", () => {
  it("'Review & Complete' opens the local review modal WITHOUT calling the server", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await fillAllSteps(user);
    await user.click(reviewButton());

    await waitFor(() => {
      expect(reviewHeading()).toBeInTheDocument();
    });
    // The summary renders the data the client holds — the text now
    // appears twice: once in the form's textarea, once in the modal's
    // summary row.
    expect(
      screen.getAllByText("Mice droppings in kitchen").length
    ).toBeGreaterThanOrEqual(2);
    expect(completeFn).not.toHaveBeenCalled();
  });
});

// ─── (e) Confirm = optimistic local write + ONE combined entry ──────

describe("ServiceSheetForm — optimistic confirm", () => {
  it("enqueues ONE combined entry (finalize + email choice) and never calls the server", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await fillAllSteps(user);
    await user.click(reviewButton());
    await waitFor(() => expect(reviewHeading()).toBeInTheDocument());

    // "Complete" (without email) — exact name so we don't match
    // "Complete & Email" or "Review & Complete".
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));

    await waitFor(async () => {
      expect(await db.outbox.count()).toBe(1);
    });
    const entry = (await db.outbox.toArray())[0];
    expect(entry.action_name).toBe("completeServiceSheetAction");
    expect(entry.entity_type).toBe("job");
    expect(entry.entity_id).toBe("test-job-id");
    const args = entry.args as Record<string, string>;
    expect(args.finalize).toBe("true");
    expect(args.send_email).toBe("");
    expect(args.technician_signature).toBe("data:image/png;base64,STUB");

    // The defining property of the optimistic path:
    expect(completeFn).not.toHaveBeenCalled();
  });

  it("'Complete & Email' records the email choice in the entry args", async () => {
    const user = userEvent.setup();
    render(
      <ServiceSheetForm jobId="test-job-id" customerEmail="ops@example.test" />
    );

    await fillAllSteps(user);
    await user.click(reviewButton());
    await waitFor(() => expect(reviewHeading()).toBeInTheDocument());

    await user.click(
      screen.getByRole("button", { name: /Complete & Email/ })
    );

    await waitFor(async () => {
      expect(await db.outbox.count()).toBe(1);
    });
    const args = (await db.outbox.toArray())[0].args as Record<string, string>;
    expect(args.send_email).toBe("true");
    expect(completeFn).not.toHaveBeenCalled();
  });

  it("'Complete & Email' is disabled when the customer has no email", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await fillAllSteps(user);
    await user.click(reviewButton());
    await waitFor(() => expect(reviewHeading()).toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: /Complete & Email/ })
    ).toBeDisabled();
  });
});

// ─── (b) Customer Present selection persistence ─────────────────────

describe("ServiceSheetForm — Customer Present", () => {
  it("selecting 'Yes' for Customer Present persists across subsequent re-renders", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await fillAllSteps(user);

    const yesLabel = screen.getByText("Yes").closest("label");
    expect(yesLabel).not.toBeNull();
    await user.click(yesLabel!);

    const clientName = await screen.findByLabelText(/Client Name/i);
    await user.type(clientName, "Jane Doe");

    const radios = document.querySelectorAll<HTMLInputElement>(
      'input[type="radio"][name="customer_present_radio"]'
    );
    const yesRadio = Array.from(radios).find((r) => r.value === "yes");
    const noRadio = Array.from(radios).find((r) => r.value === "no");
    expect(yesRadio?.checked).toBe(true);
    expect(noRadio?.checked).toBe(false);
  });

  it("stays selected through a client-side validation failure", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    // Fill everything EXCEPT pesticides_used, then select Yes + name.
    await user.click(await screen.findByText("Routine"));
    await user.click(screen.getByRole("button", { name: "Mice" }));
    await user.type(
      screen.getByLabelText(/^Findings/i),
      "Mice droppings in kitchen"
    );
    await user.type(
      screen.getByLabelText(/^Recommendations/i),
      "Place bait stations"
    );
    await user.click(screen.getByRole("button", { name: "Rodenticide Used" }));
    await user.type(
      screen.getByLabelText(/Risk Assessment Comments/i),
      "Standard rodent treatment"
    );
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByTestId("sigpad-tech"));

    const yesLabel = screen.getByText("Yes").closest("label");
    await user.click(yesLabel!);
    const clientName = await screen.findByLabelText(/Client Name/i);
    await user.type(clientName, "Jane Doe");

    await user.click(reviewButton());

    // Client-side validation blocks the review — no modal, no server.
    await waitFor(() => {
      expect(
        screen.getByText(/Pesticides used is required/i)
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("heading", { name: /Review & Complete/ })
    ).not.toBeInTheDocument();
    expect(completeFn).not.toHaveBeenCalled();

    // The controlled state survived.
    const yesRadio = document.querySelector<HTMLInputElement>(
      'input[type="radio"][name="customer_present_radio"][value="yes"]'
    );
    expect(yesRadio?.checked).toBe(true);
    expect((clientName as HTMLInputElement).value).toBe("Jane Doe");
  });
});

// ─── (c) Client-side validation bounce — fields persist ─────────────

describe("ServiceSheetForm — client-side validation", () => {
  it("typed fields survive a validation failure (no server involved)", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await user.click(await screen.findByText("Routine"));
    await user.click(screen.getByRole("button", { name: "Mice" }));
    await user.type(
      screen.getByLabelText(/^Findings/i),
      "Mice droppings in kitchen"
    );
    await user.type(
      screen.getByLabelText(/^Recommendations/i),
      "Place bait stations"
    );
    await user.click(screen.getByRole("button", { name: "Rodenticide Used" }));
    // DON'T fill pesticides_used
    await user.type(
      screen.getByLabelText(/Risk Assessment Comments/i),
      "Standard rodent treatment"
    );
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByTestId("sigpad-tech"));

    await user.click(reviewButton());

    // Inline error renders and the error-step effect navigates to the
    // failing step; the typed fields keep their values.
    await waitFor(() => {
      expect(
        screen.getByText(/Pesticides used is required/i)
      ).toBeInTheDocument();
    });
    expect(completeFn).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText(/^Findings/i) as HTMLTextAreaElement).value
    ).toBe("Mice droppings in kitchen");
    expect(
      (screen.getByLabelText(/^Recommendations/i) as HTMLTextAreaElement).value
    ).toBe("Place bait stations");
  });
});

// ─── (f) Customer Present = No path ────────────────────────────────
//
// The shape that used to die server-side: with No selected the visible
// client_name input isn't rendered, FormData.get returned null, and
// the server Zod bounced it (3 jobs stuck in the conflict inbox).
// Client validation + the optimistic entry must accept it.

describe("ServiceSheetForm — Customer Present = No", () => {
  it("reviews + completes cleanly with no client signature / name", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await fillAllSteps(user);

    const noLabel = screen.getByText("No").closest("label");
    expect(noLabel).not.toBeNull();
    await user.click(noLabel!);

    expect(screen.queryByLabelText(/Client Name/i)).toBeNull();
    expect(screen.queryByTestId("sigpad-Client Signature")).toBeNull();

    await user.click(reviewButton());
    await waitFor(() => expect(reviewHeading()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Complete$/ }));

    await waitFor(async () => {
      expect(await db.outbox.count()).toBe(1);
    });
    const args = (await db.outbox.toArray())[0].args as Record<string, string>;
    expect(args.client_present).toBe("");
    // With Customer Present = No the client_name input isn't rendered,
    // so the key is absent from FormData entirely — the action's
    // null-coalesce + the schema default turn that into "" server-side
    // (the exact shape that used to bounce before the coalesce fix).
    expect(args.client_name).toBeUndefined();
    expect(completeFn).not.toHaveBeenCalled();
  });
});

// ─── (d) Review modal closes and reopens ────────────────────────────

describe("ServiceSheetForm — review reopen", () => {
  it("'Back to edit' closes the review; a second review reopens it with fresh data", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await fillAllSteps(user);
    await user.click(reviewButton());
    await waitFor(() => expect(reviewHeading()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Back to edit/ }));
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /Review & Complete/ })
      ).not.toBeInTheDocument();
    });

    // Tweak a field, review again — the summary shows the edit.
    await user.type(screen.getByLabelText(/^Findings/i), " — extra note");
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(reviewButton());

    await waitFor(() => expect(reviewHeading()).toBeInTheDocument());
    // Appears in both the textarea and the reopened summary.
    expect(
      screen.getAllByText(/Mice droppings in kitchen — extra note/).length
    ).toBeGreaterThanOrEqual(2);
    expect(completeFn).not.toHaveBeenCalled();
  });
});
