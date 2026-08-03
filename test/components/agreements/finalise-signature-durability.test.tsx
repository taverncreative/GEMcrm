/**
 * AgreementFinalise — signature durability across a remount.
 *
 * This panel is the second place the operator captures two signatures in
 * front of a customer, and it was the only such surface with no
 * persistence at all: gemSig and clientSig were plain component state.
 * A router.refresh() from elsewhere on the page, an error boundary, a
 * back-swipe, or mobile Safari reclaiming a backgrounded tab took both
 * signatures with it, and the customer had to sign again.
 *
 * The fix mirrors the agreement wizard: a Dexie-backed draft (keyed by
 * agreement_id, see lib/db/agreement-finalise-drafts.ts), debounced
 * writes, repaint via initialDataUrl, cleared on success.
 *
 * "Remount" here is a genuine unmount/remount of the component tree —
 * exactly what a refresh or an error boundary does — not a re-render.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (hoisted before imports) ─────────────────────────

const finaliseFn = vi.fn();
const deleteFn = vi.fn();
vi.mock("@/app/(app)/agreements/[id]/actions", () => ({
  finaliseDraftAgreementAction: (...args: unknown[]) => finaliseFn(...args),
  deleteAgreementAction: (...args: unknown[]) => deleteFn(...args),
}));

const refreshFn = vi.fn();
const pushFn = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshFn, push: pushFn }),
}));

// Online, so the panel's buttons are enabled. The gating itself is
// existing behaviour and deliberately untouched by this change.
vi.mock("@/lib/hooks/use-is-online", () => ({ useIsOnline: () => true }));

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
    const key = label.includes("GEM") ? "gem" : "client";
    return (
      <div>
        <span
          data-testid={`sig-initial-${key}`}
          data-initial={initialDataUrl ?? ""}
        >
          {initialDataUrl ? "painted" : "blank"}
        </span>
        <button
          type="button"
          data-testid={`sig-sign-${key}`}
          onClick={() => onSignature(`data:image/png;base64,${key.toUpperCase()}SIG`)}
        >
          sign {key}
        </button>
        <button type="button" data-testid={`sig-clear-${key}`} onClick={onClear}>
          clear {key}
        </button>
      </div>
    );
  },
}));

// ─── Imports (AFTER mocks) ─────────────────────────────────────────

import { AgreementFinalise } from "@/components/agreements/agreement-finalise";
import { loadFinaliseDraft } from "@/lib/db/agreement-finalise-drafts";
import { db } from "@/lib/db";

const AGREEMENT_ID = "agr-1";
const GEM_SIG = "data:image/png;base64,GEMSIG";
const CLIENT_SIG = "data:image/png;base64,CLIENTSIG";

/** The debounce is 500ms; give it room and flush React's effects. */
async function letDraftSave() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 700));
  });
}

/** Open the panel and capture both signatures + a signee name. */
async function captureBothSignatures(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /finalise agreement/i }));
  await user.click(screen.getByTestId("sig-sign-gem"));
  await user.click(screen.getByTestId("sig-sign-client"));
  await user.type(
    screen.getByLabelText(/name of signee/i),
    "Nate Green"
  );
}

beforeEach(async () => {
  finaliseFn.mockReset();
  deleteFn.mockReset();
  refreshFn.mockReset();
  pushFn.mockReset();
  await db.agreement_finalise_drafts.clear();
});

describe("AgreementFinalise — signatures survive a remount", () => {
  it("persists both signatures to the draft store as they are captured", async () => {
    const user = userEvent.setup();
    render(
      <AgreementFinalise agreementId={AGREEMENT_ID} defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );

    await captureBothSignatures(user);
    await letDraftSave();

    const draft = await loadFinaliseDraft(AGREEMENT_ID);
    expect(draft?.gem_signature).toBe(GEM_SIG);
    expect(draft?.client_signature).toBe(CLIENT_SIG);
    expect(draft?.signatory_name).toBe("Nate Green");
  });

  it("repaints both signatures after a full unmount and remount", async () => {
    const user = userEvent.setup();
    const first = render(
      <AgreementFinalise agreementId={AGREEMENT_ID} defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );
    await captureBothSignatures(user);
    await letDraftSave();

    // The event this whole change exists for: the tree goes away.
    first.unmount();

    render(
      <AgreementFinalise agreementId={AGREEMENT_ID} defaultSignatoryName={null} />
    );

    // The panel re-opens itself, because a collapsed panel would give the
    // operator no sign the signatures survived.
    await waitFor(() =>
      expect(screen.getByTestId("sig-initial-gem")).toBeInTheDocument()
    );

    // Both pads are handed their stored data URLs — "painted", not "blank".
    expect(screen.getByTestId("sig-initial-gem")).toHaveAttribute(
      "data-initial",
      GEM_SIG
    );
    expect(screen.getByTestId("sig-initial-client")).toHaveAttribute(
      "data-initial",
      CLIENT_SIG
    );
    expect(screen.getByTestId("sig-initial-gem")).toHaveTextContent("painted");
    expect(screen.getByTestId("sig-initial-client")).toHaveTextContent(
      "painted"
    );
    // The typed name came back too.
    expect(
      (screen.getByLabelText(/name of signee/i) as HTMLInputElement).value
    ).toBe("Nate Green");
  });

  it("a restored panel can finalise without re-signing", async () => {
    const user = userEvent.setup();
    const first = render(
      <AgreementFinalise agreementId={AGREEMENT_ID} defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );
    await captureBothSignatures(user);
    await letDraftSave();
    first.unmount();

    finaliseFn.mockResolvedValue({ success: true });
    render(
      <AgreementFinalise agreementId={AGREEMENT_ID} defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /confirm and make active/i })
      ).toBeInTheDocument()
    );

    await user.click(
      screen.getByRole("button", { name: /confirm and make active/i })
    );

    // The restored signatures reached the action — no "signature is
    // required" bounce, no re-sign in front of the customer.
    await waitFor(() => expect(finaliseFn).toHaveBeenCalledTimes(1));
    expect(finaliseFn.mock.calls[0][1]).toMatchObject({
      gem_signature: GEM_SIG,
      client_signature: CLIENT_SIG,
      client_signatory_name: "Nate Green",
    });
  });

  it("mounts collapsed and blank when there is no draft", async () => {
    render(
      <AgreementFinalise agreementId="agr-none" defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );
    // Collapsed: the pads are not mounted at all.
    expect(screen.queryByTestId("sig-initial-gem")).not.toBeInTheDocument();

    await userEvent.setup().click(
      screen.getByRole("button", { name: /finalise agreement/i })
    );
    expect(screen.getByTestId("sig-initial-gem")).toHaveTextContent("blank");
  });
});

describe("AgreementFinalise — draft lifecycle", () => {
  it("clears the draft on a successful finalise", async () => {
    const user = userEvent.setup();
    render(
      <AgreementFinalise agreementId={AGREEMENT_ID} defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );
    await captureBothSignatures(user);
    await letDraftSave();
    expect(await loadFinaliseDraft(AGREEMENT_ID)).toBeDefined();

    finaliseFn.mockResolvedValue({ success: true });
    await user.click(
      screen.getByRole("button", { name: /confirm and make active/i })
    );

    await waitFor(() => expect(refreshFn).toHaveBeenCalled());
    expect(await loadFinaliseDraft(AGREEMENT_ID)).toBeUndefined();
  });

  it("KEEPS the draft when finalising fails, so nothing is re-signed", async () => {
    const user = userEvent.setup();
    render(
      <AgreementFinalise agreementId={AGREEMENT_ID} defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );
    await captureBothSignatures(user);
    await letDraftSave();

    // The existing network-failure path, deliberately unchanged.
    finaliseFn.mockRejectedValue(new Error("offline"));
    await user.click(
      screen.getByRole("button", { name: /confirm and make active/i })
    );

    await waitFor(() =>
      expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument()
    );
    const draft = await loadFinaliseDraft(AGREEMENT_ID);
    expect(draft?.gem_signature).toBe(GEM_SIG);
    expect(draft?.client_signature).toBe(CLIENT_SIG);
  });

  it("clears the draft when the draft agreement is discarded", async () => {
    const user = userEvent.setup();
    render(
      <AgreementFinalise agreementId={AGREEMENT_ID} defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );
    await captureBothSignatures(user);
    await letDraftSave();
    expect(await loadFinaliseDraft(AGREEMENT_ID)).toBeDefined();

    // Collapse back to the entry state where Discard lives.
    await user.click(screen.getByRole("button", { name: /^back$/i }));
    deleteFn.mockResolvedValue({ success: true });
    await user.click(screen.getByRole("button", { name: /discard draft/i }));
    await user.click(screen.getByRole("button", { name: /yes, discard/i }));

    await waitFor(() => expect(pushFn).toHaveBeenCalled());
    expect(await loadFinaliseDraft(AGREEMENT_ID)).toBeUndefined();
  });

  it("keys drafts by agreement, so two drafts on one site cannot collide", async () => {
    const user = userEvent.setup();
    const first = render(
      <AgreementFinalise agreementId="agr-A" defaultSignatoryName={null} />
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );
    await user.click(
      screen.getByRole("button", { name: /finalise agreement/i })
    );
    await user.click(screen.getByTestId("sig-sign-gem"));
    await letDraftSave();
    first.unmount();

    // A different agreement on the same site must start clean.
    render(<AgreementFinalise agreementId="agr-B" defaultSignatoryName={null} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /finalise agreement/i })
      ).toBeInTheDocument()
    );
    expect(await loadFinaliseDraft("agr-A")).toBeDefined();
    expect(await loadFinaliseDraft("agr-B")).toBeUndefined();
  });
});
