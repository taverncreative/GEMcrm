/**
 * ServiceSheetForm — restored signatures must REPAINT, not just restore.
 *
 * The draft store has always persisted tech_sig / client_sig, and the
 * body's useState has always rehydrated them, so a restored sheet would
 * have SUBMITTED the right signatures. But neither SignaturePad was
 * given `initialDataUrl`, so the canvas rendered blank.
 *
 * That is worse than it sounds. signature-pad.tsx documents it: an empty
 * pad "reads to the operator as 'my signature was lost' and invites a
 * needless re-sign". And the re-sign is not the bad case — pressing
 * Clear is, because that fires onClear and wipes the stored signature
 * for real. A blank pad is one tap away from the loss it looks like.
 *
 * These tests assert the wiring: the pads are handed the draft's data
 * URLs on mount, and Clear remains the only thing that removes one.
 * (The actual pixel painting is the SignaturePad's own job — it is
 * exercised on :3002, since jsdom has no canvas.)
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (hoisted before imports) ─────────────────────────

vi.mock("@/app/(app)/jobs/[id]/complete/actions", () => ({
  completeServiceSheetAction: vi.fn(),
  approveServiceSheetAction: vi.fn(),
}));

/**
 * Signature-pad stub that EXPOSES what it was mounted with. The real
 * component paints to a canvas jsdom does not implement, so the
 * observable contract here is "was initialDataUrl handed over", plus a
 * working Clear button so the destructive path stays covered.
 */
vi.mock("@/components/ui/signature-pad", () => ({
  SignaturePad: ({
    label,
    onSignature,
    onClear,
    initialDataUrl,
  }: {
    label: string;
    onSignature: (s: string) => void;
    onClear: () => void;
    initialDataUrl?: string;
  }) => {
    const key = label || "tech";
    return (
      <div>
        <span
          data-testid={`sigpad-initial-${key}`}
          data-initial={initialDataUrl ?? ""}
        >
          {initialDataUrl ? "painted" : "blank"}
        </span>
        <button
          type="button"
          data-testid={`sigpad-sign-${key}`}
          onClick={() => onSignature("data:image/png;base64,FRESH")}
        >
          sign {key}
        </button>
        <button
          type="button"
          data-testid={`sigpad-clear-${key}`}
          onClick={onClear}
        >
          clear {key}
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/ui/photo-upload", () => ({
  PhotoUpload: () => <div data-testid="mock-photo-upload" />,
}));

// ─── Imports (AFTER mocks) ─────────────────────────────────────────

import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { saveDraft } from "@/lib/db/drafts";
import { db } from "@/lib/db";

const TECH_SIG = "data:image/png;base64,DRAFTTECH";
const CLIENT_SIG = "data:image/png;base64,DRAFTCLIENT";

/** A draft with both signatures captured and the customer marked present
 *  (which is what mounts the client pad at all). */
async function seedSignedDraft(jobId: string) {
  await saveDraft({
    job_id: jobId,
    step: 5,
    call_type: "routine",
    selected_pests: ["Mice"],
    selected_methods: ["Rodenticide Used"],
    findings: "DRAFT FINDINGS",
    recommendations: "DRAFT RECOMMENDATIONS",
    products_used: [],
    report_notes: "",
    risk_level: "low",
    risk_comments: "DRAFT RISK",
    client_name: "Draft Client",
    tech_sig: TECH_SIG,
    client_sig: CLIENT_SIG,
    customer_present: "yes",
    photo_data_urls: [],
    schedule_follow_up: false,
    follow_up_date: "",
  });
}

beforeEach(async () => {
  await db.service_sheet_drafts.clear();
});

describe("ServiceSheetForm — signatures repaint after a draft restore", () => {
  it("hands BOTH pads the draft's stored data URLs on mount", async () => {
    await seedSignedDraft("sig-job-1");
    render(<ServiceSheetForm jobId="sig-job-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("sigpad-initial-tech")).toHaveAttribute(
        "data-initial",
        TECH_SIG
      );
    });
    // The client pad only exists when "Customer Present" is yes, which
    // the draft restored — if that regressed this query would throw.
    expect(
      screen.getByTestId("sigpad-initial-Client Signature")
    ).toHaveAttribute("data-initial", CLIENT_SIG);

    // The regression this test exists for: both read "painted", never
    // "blank", when a draft carried signatures.
    expect(screen.getByTestId("sigpad-initial-tech")).toHaveTextContent(
      "painted"
    );
    expect(
      screen.getByTestId("sigpad-initial-Client Signature")
    ).toHaveTextContent("painted");
  });

  it("submits the restored technician signature without a re-sign", async () => {
    await seedSignedDraft("sig-job-2");
    const { container } = render(<ServiceSheetForm jobId="sig-job-2" />);

    await waitFor(() => {
      expect(screen.getByTestId("sigpad-initial-tech")).toBeInTheDocument();
    });

    const form = container.querySelector("form")!;
    const fd = new FormData(form);
    expect(fd.get("technician_signature")).toBe(TECH_SIG);
    expect(fd.get("client_signature")).toBe(CLIENT_SIG);
  });

  it("mounts pads blank when the draft has no signatures", async () => {
    await saveDraft({
      job_id: "sig-job-3",
      step: 2,
      call_type: "routine",
      selected_pests: ["Mice"],
      selected_methods: ["Rodenticide Used"],
      findings: "F",
      recommendations: "R",
      products_used: [],
      report_notes: "",
      risk_level: "low",
      risk_comments: "RC",
      client_name: "",
      tech_sig: "",
      client_sig: "",
      customer_present: "",
      photo_data_urls: [],
      schedule_follow_up: false,
      follow_up_date: "",
    });
    render(<ServiceSheetForm jobId="sig-job-3" />);

    await waitFor(() => {
      expect(screen.getByTestId("sigpad-initial-tech")).toHaveTextContent(
        "blank"
      );
    });
  });

  it("Clear is the ONLY thing that removes a restored signature", async () => {
    await seedSignedDraft("sig-job-4");
    const user = userEvent.setup();
    const { container } = render(<ServiceSheetForm jobId="sig-job-4" />);

    await waitFor(() => {
      expect(screen.getByTestId("sigpad-clear-tech")).toBeInTheDocument();
    });
    const form = container.querySelector("form")!;

    // Still present after an unrelated interaction.
    await user.click(screen.getByTestId("sigpad-sign-Client Signature"));
    expect(new FormData(form).get("technician_signature")).toBe(TECH_SIG);

    // Clear, and only Clear, drops it.
    await user.click(screen.getByTestId("sigpad-clear-tech"));
    await waitFor(() => {
      expect(new FormData(form).get("technician_signature")).toBe("");
    });
  });

  it("a fresh signature replaces the restored one", async () => {
    await seedSignedDraft("sig-job-5");
    const user = userEvent.setup();
    const { container } = render(<ServiceSheetForm jobId="sig-job-5" />);

    await waitFor(() => {
      expect(screen.getByTestId("sigpad-sign-tech")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("sigpad-sign-tech"));
    await waitFor(() => {
      expect(
        new FormData(container.querySelector("form")!).get(
          "technician_signature"
        )
      ).toBe("data:image/png;base64,FRESH");
    });
  });
});
