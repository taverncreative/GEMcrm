/**
 * ServiceSheetForm — draft persistence tests.
 *
 * Two flows the operator absolutely needs to work:
 *
 *   (1) Pre-existing draft is rendered into the form.
 *       Reproduces: operator fills half the form, phone backgrounds the
 *       PWA, foregrounds it later, navigates back to the job → form must
 *       re-mount with everything they typed.
 *
 *   (2) On a successful approve, the draft is cleared.
 *       Reproduces: operator finishes a sheet → approves → goes to start
 *       a new visit on the same job somehow (or another technician picks
 *       it up) → must NOT see the old half-filled draft haunting them.
 *
 * Strategy:
 *   - Pre-write a draft via saveDraft() before rendering.
 *   - Render <ServiceSheetForm /> with defaults that DIFFER from the draft.
 *     The outer wrapper's useLiveQuery resolves to the draft (not null),
 *     so the body mounts with draft values. If the draft path is broken,
 *     defaults win and the assertion fails.
 *   - For (2), spy on db.service_sheet_drafts to confirm the row is gone
 *     after approveServiceSheetAction returns success.
 *
 * Same mock pattern as the sibling test file: server actions and visual
 * children (signature pad, photo upload) are stubbed.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must be hoisted before imports) ─────────────────

const completeFn = vi.fn();
const approveFn = vi.fn();
vi.mock("@/app/(app)/jobs/[id]/complete/actions", () => ({
  completeServiceSheetAction: (...args: unknown[]) => completeFn(...args),
  approveServiceSheetAction: (...args: unknown[]) => approveFn(...args),
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
  PhotoUpload: ({ defaultPhotoIds }: { defaultPhotoIds?: string[] }) => (
    <div
      data-testid="mock-photo-upload"
      data-default-ids={(defaultPhotoIds ?? []).join(",")}
    />
  ),
}));

// ─── Imports (AFTER mocks) ─────────────────────────────────────────

import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { saveDraft, loadDraft } from "@/lib/db/drafts";
import { db } from "@/lib/db";

beforeEach(async () => {
  completeFn.mockReset();
  approveFn.mockReset();
  await db.service_sheet_drafts.clear();
});

// ─── (1) Draft restoration ──────────────────────────────────────────

describe("ServiceSheetForm — draft restoration", () => {
  it("renders fields from a pre-existing draft, not the defaults", async () => {
    // Pre-seed a draft with values that differ obviously from the
    // defaults so we can't false-positive on "defaults happen to match".
    await saveDraft({
      job_id: "test-job-id",
      step: 2,
      call_type: "routine",
      selected_pests: ["Mice"],
      selected_methods: ["Rodenticide Used"],
      findings: "DRAFT FINDINGS",
      recommendations: "DRAFT RECOMMENDATIONS",
      products_used: [
        {
          product_id: null,
          brand_name: "DRAFT BRAND",
          chemical_name: "draft chem",
          quantity: "5g",
        },
      ],
      report_notes: "DRAFT NOTES",
      risk_level: "high",
      risk_comments: "DRAFT RISK",
      client_name: "Draft Client",
      tech_sig: "data:image/png;base64,DRAFTTECH",
      client_sig: "data:image/png;base64,DRAFTCLIENT",
      customer_present: "yes",
      photo_data_urls: ["draft-photo-1", "draft-photo-2"],
      schedule_follow_up: true,
      follow_up_date: "2026-09-09",
    });

    render(
      <ServiceSheetForm
        jobId="test-job-id"
        defaultCallType=""
        defaultFindings="FROM-DEFAULTS"
        defaultRecommendations="FROM-DEFAULTS"
        defaultReportNotes="FROM-DEFAULTS"
        defaultRiskLevel="low"
      />
    );

    // Wait for the outer wrapper's useLiveQuery to resolve and the
    // body to mount. The first user-visible draft field is Findings.
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^Findings/i) as HTMLTextAreaElement).value
      ).toBe("DRAFT FINDINGS");
    });

    // Other text fields preserved
    expect(
      (screen.getByLabelText(/^Recommendations/i) as HTMLTextAreaElement).value
    ).toBe("DRAFT RECOMMENDATIONS");
    // Products Used (migration 047) restores from the draft — the row's brand
    // type-ahead shows the saved brand, the quantity its free text.
    expect(
      (screen.getByLabelText("Product") as HTMLInputElement).value
    ).toBe("DRAFT BRAND");
    expect(
      (screen.getByLabelText("Quantity") as HTMLInputElement).value
    ).toBe("5g");
    expect(
      (screen.getByLabelText(/Risk Assessment Comments/i) as HTMLTextAreaElement)
        .value
    ).toBe("DRAFT RISK");

    // Photo IDs passed through to PhotoUpload as defaultPhotoIds —
    // the mock writes them onto a data attribute we can read.
    const photoMock = screen.getByTestId("mock-photo-upload");
    expect(photoMock.getAttribute("data-default-ids")).toBe(
      "draft-photo-1,draft-photo-2"
    );

    // The hidden call_type field reflects the draft's "routine"
    const callTypeHidden = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="call_type"]'
    );
    expect(callTypeHidden?.value).toBe("routine");

    // Customer Present "yes" radio is selected
    const yesRadio = document.querySelector<HTMLInputElement>(
      'input[type="radio"][name="customer_present_radio"][value="yes"]'
    );
    expect(yesRadio?.checked).toBe(true);
  });

  it("falls back to defaults when there is no draft", async () => {
    // No saveDraft call — the table is empty thanks to beforeEach.

    render(
      <ServiceSheetForm
        jobId="test-job-id"
        defaultFindings="DEFAULT FINDINGS"
        defaultRecommendations="DEFAULT RECOMMENDATIONS"
        defaultReportNotes="DEFAULT NOTES"
        defaultRiskLevel="low"
      />
    );

    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^Findings/i) as HTMLTextAreaElement).value
      ).toBe("DEFAULT FINDINGS");
    });
    expect(
      (screen.getByLabelText(/^Recommendations/i) as HTMLTextAreaElement).value
    ).toBe("DEFAULT RECOMMENDATIONS");
    // No draft and no default products → the empty-state hint shows.
    expect(screen.getByText(/No products added/i)).toBeInTheDocument();

    // Customer Present unselected
    const yesRadio = document.querySelector<HTMLInputElement>(
      'input[type="radio"][name="customer_present_radio"][value="yes"]'
    );
    const noRadio = document.querySelector<HTMLInputElement>(
      'input[type="radio"][name="customer_present_radio"][value="no"]'
    );
    expect(yesRadio?.checked).toBe(false);
    expect(noRadio?.checked).toBe(false);
  });
});

// ─── (2) Draft cleared on completion ────────────────────────────────

describe("ServiceSheetForm — draft cleared on completion", () => {
  it("removes the draft row after confirming Complete in the review step", async () => {
    // Pre-seed a draft so we can prove the clear happened.
    await saveDraft({
      job_id: "test-job-id",
      step: 5,
      call_type: "routine",
      selected_pests: ["Mice"],
      selected_methods: ["Rodenticide Used"],
      findings: "anything",
      recommendations: "anything",
      pesticides_used: "anything",
      report_notes: "",
      risk_level: "low",
      risk_comments: "anything",
      client_name: "",
      tech_sig: "",
      client_sig: "",
      customer_present: "",
      photo_data_urls: [],
      schedule_follow_up: false,
      follow_up_date: "",
    });

    // Sanity-check it's there.
    expect(await loadDraft("test-job-id")).toBeDefined();

    const user = userEvent.setup();
    render(<ServiceSheetForm jobId="test-job-id" />);

    // Wait for the draft body to mount.
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^Findings/i) as HTMLTextAreaElement).value
      ).toBe("anything");
    });

    // Navigate to step 5 (the indicator buttons are always in the DOM).
    await user.click(screen.getByRole("button", { name: "5" }));
    // Tech signature
    await user.click(screen.getByTestId("sigpad-tech"));
    // Review (client-validates, opens the local review modal — the
    // server action is never called in the optimistic flow).
    await user.click(
      screen.getByRole("button", { name: /Review & Complete/ })
    );
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Review & Complete/ })
      ).toBeInTheDocument();
    });

    // Confirm without email — local write + outbox enqueue, then the
    // success effect clears the draft and navigates.
    await user.click(screen.getByRole("button", { name: /^Complete$/ }));

    await waitFor(
      async () => {
        const draft = await loadDraft("test-job-id");
        expect(draft).toBeUndefined();
      },
      { timeout: 2000 }
    );
    expect(completeFn).not.toHaveBeenCalled();
  });
});
