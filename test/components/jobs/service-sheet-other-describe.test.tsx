/**
 * ServiceSheetForm — "Other" free-text describe box (feat/other-describe-box).
 *
 * Contract pinned here:
 *   (a) Selecting the "Other" pest pill reveals a required describe box;
 *       a non-Other selection shows no box.
 *   (b) "Other" with an empty description blocks review (required) and
 *       never calls the server.
 *   (c) Completing with a described "Other" folds the text into the
 *       pest_species array as "Other: <desc>" in the outbox entry — the
 *       shape that persists offline, syncs, and prints on the PDF.
 *   (d) Same behaviour for the "Other" treatment method.
 *   (e) A stored/encoded "Other: <desc>" default round-trips back into
 *       the pill + populated describe box (the amend / reopen path).
 *
 * Signature pad + photo upload are mocked (canvas/File APIs jsdom lacks),
 * matching the sibling service-sheet-form test files.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const completeFn = vi.fn();
vi.mock("@/app/(app)/jobs/[id]/complete/actions", () => ({
  completeServiceSheetAction: (...args: unknown[]) => completeFn(...args),
  approveServiceSheetAction: vi.fn(),
}));

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

vi.mock("@/components/ui/photo-upload", () => ({
  PhotoUpload: () => <div data-testid="mock-photo-upload" />,
}));

import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { db } from "@/lib/db";

beforeEach(async () => {
  completeFn.mockReset();
  await db.outbox.clear();
  await db.service_sheet_drafts.clear();
});

// Two pills read "Other" — pest species (first in DOM) and treatment
// (second). Disambiguate positionally.
const pestOther = () => screen.getAllByRole("button", { name: "Other" })[0];
const treatmentOther = () =>
  screen.getAllByRole("button", { name: "Other" })[1];

/** Fill steps 1–5 selecting the "Other" pest pill, ready to review. */
async function fillWithOtherPest(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Routine"));
  await user.click(pestOther());
  await user.type(screen.getByLabelText(/^Findings/i), "Some findings");
  await user.type(screen.getByLabelText(/^Recommendations/i), "Some recs");
  await user.click(screen.getByRole("button", { name: "Rodenticide Used" }));
  await user.type(
    screen.getByLabelText(/Risk Assessment Comments/i),
    "No special hazards"
  );
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByTestId("sigpad-tech"));
}

const reviewButton = () =>
  screen.getByRole("button", { name: /Review & Complete/ });

// ─── (a) box reveal ─────────────────────────────────────────────────

describe("ServiceSheetForm — Other describe box reveal", () => {
  it("shows the describe box only when the Other pest pill is selected", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await user.click(await screen.findByText("Routine"));
    await user.click(screen.getByRole("button", { name: "2" }));

    expect(screen.queryByLabelText(/Describe the other pest/i)).toBeNull();

    await user.click(pestOther());
    expect(
      screen.getByLabelText(/Describe the other pest/i)
    ).toBeInTheDocument();

    // Deselecting hides it again.
    await user.click(pestOther());
    expect(screen.queryByLabelText(/Describe the other pest/i)).toBeNull();
  });
});

// ─── (b) required ───────────────────────────────────────────────────

describe("ServiceSheetForm — Other pest required", () => {
  it("blocks review when Other is selected but no description is typed", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await fillWithOtherPest(user);
    await user.click(reviewButton());

    // The error jumps back to step 2 (the describe box, targeted by its
    // label, is visible) and the review modal never opens.
    await waitFor(() => {
      expect(
        screen.getByLabelText(/Describe the other pest/i)
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("heading", { name: /Review & Complete/ })
    ).not.toBeInTheDocument();
    expect(completeFn).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(0);
  });
});

// ─── (c) folded into pest_species ───────────────────────────────────

describe("ServiceSheetForm — Other pest encoding", () => {
  it("folds the description into pest_species as 'Other: <desc>'", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await fillWithOtherPest(user);
    await user.type(
      screen.getByLabelText(/Describe the other pest/i),
      "Cockroaches"
    );

    await user.click(reviewButton());
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Review & Complete/ })
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));

    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    const args = (await db.outbox.toArray())[0].args as Record<string, string>;
    const pests = JSON.parse(args.pest_species) as string[];
    expect(pests).toContain("Other: Cockroaches");
    expect(pests).not.toContain("Other");
    expect(completeFn).not.toHaveBeenCalled();
  });
});

// ─── (d) Other treatment method ─────────────────────────────────────

describe("ServiceSheetForm — Other treatment method", () => {
  it("reveals + requires + folds the Other treatment description", async () => {
    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    await user.click(await screen.findByText("Routine"));
    await user.click(screen.getByRole("button", { name: "Mice" }));
    await user.type(screen.getByLabelText(/^Findings/i), "F");
    await user.type(screen.getByLabelText(/^Recommendations/i), "R");
    await user.type(
      screen.getByLabelText(/Risk Assessment Comments/i),
      "None"
    );
    // Select the "Other" treatment pill (the second "Other" button; the
    // first is the pest pill, left unselected here).
    await user.click(treatmentOther());
    await user.type(
      screen.getByLabelText(/Describe the other treatment/i),
      "Heat treatment"
    );

    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByTestId("sigpad-tech"));
    await user.click(reviewButton());
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Review & Complete/ })
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));

    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    const args = (await db.outbox.toArray())[0].args as Record<string, string>;
    const methods = JSON.parse(args.method_used) as string[];
    expect(methods).toContain("Other: Heat treatment");
    expect(methods).not.toContain("Other");
  });
});

// ─── (e) round-trip from stored encoded default ─────────────────────

describe("ServiceSheetForm — Other pest round-trip", () => {
  it("restores an encoded 'Other: <desc>' default into the pill + describe box", async () => {
    const user = userEvent.setup();
    render(
      <ServiceSheetForm
        jobId="test-job-id"
        defaultPests={["Wasps", "Other: Silverfish"]}
      />
    );

    await user.click(await screen.findByText("Routine"));
    await user.click(screen.getByRole("button", { name: "2" }));

    // The describe box is present and pre-filled from the split.
    const box = (await screen.findByLabelText(
      /Describe the other pest/i
    )) as HTMLInputElement;
    expect(box.value).toBe("Silverfish");

    // The Other pill reads as selected (folded value round-trips through
    // the hidden input on the next submit).
    await user.type(screen.getByLabelText(/^Findings/i), "F");
    await user.type(screen.getByLabelText(/^Recommendations/i), "R");
    await user.click(screen.getByRole("button", { name: "Rodenticide Used" }));
    await user.type(
      screen.getByLabelText(/Risk Assessment Comments/i),
      "None"
    );
    await user.click(screen.getByRole("button", { name: "5" }));
    await user.click(screen.getByTestId("sigpad-tech"));
    await user.click(reviewButton());
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Review & Complete/ })
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));

    await waitFor(async () => expect(await db.outbox.count()).toBe(1));
    const args = (await db.outbox.toArray())[0].args as Record<string, string>;
    const pests = JSON.parse(args.pest_species) as string[];
    expect(pests).toEqual(["Wasps", "Other: Silverfish"]);
  });
});
