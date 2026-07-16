/**
 * Save as draft — the submit must actually DISPATCH (live bug).
 *
 * The wizard keeps every step mounted (CSS-hidden), so on the Terms step
 * the step-4 signee field is required + empty + invisible. A submit button
 * WITHOUT formNoValidate is silently blocked by browser constraint
 * validation (the bubble cannot anchor to an invisible control), so the
 * click did nothing in a real browser: the "unresponsive Save as draft" on
 * prod.
 *
 * jsdom limitation: its requestSubmit honours only the FORM's novalidate
 * and ignores the submitter's formnovalidate
 * (jsdom/lib/.../HTMLFormElement-impl.js, "Step 6.3"), so the bug
 * condition (signee empty + hidden) cannot be dispatch-tested here — the
 * formNoValidate attribute assertions are the load-bearing regression pin.
 * The dispatch + error-surfacing tests fill the signee so jsdom's validator
 * lets the submit through, guarding the button-to-action wiring and the
 * visible-failure contract.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const draftActionMock = vi.fn(
  async (
    _prev: { success: boolean },
    _fd: FormData
  ): Promise<{ success: boolean; errors: Record<string, string>; message: string | null }> => ({
    success: false,
    errors: {},
    message: null,
  })
);
vi.mock("@/app/(app)/sites/[id]/agreements/actions", () => ({
  createAgreementAction: vi.fn(async () => ({
    success: false,
    errors: {},
    message: null,
  })),
  createDraftAgreementAction: (
    prev: { success: boolean },
    fd: FormData
  ) => draftActionMock(prev, fd),
}));

import { AddAgreementForm } from "@/components/agreements/add-agreement-form";

function fill(name: string, value: string) {
  const el = document.querySelector(
    `[name="${name}"]`
  ) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

async function renderWizardOnTerms() {
  render(<AddAgreementForm siteId="s1" />);
  await userEvent.click(screen.getByRole("button", { name: /New Agreement/ }));
  // John's flow: fill steps 1-3; the step-4 signee stays EMPTY (hidden).
  fill("reference_number", "GEM-TEST-001");
  fill("contact_name", "Test Co");
  fill("invoice_address", "1 Test Way");
  fill("contact_phone", "01234 567890");
  fill("contact_email", "test@example.com");
  fill("contract_value", "1000");
  fill("start_date", "2026-07-16");
  fill("visit_frequency", "4");
  fill("callout_terms", "48-hour response");
}

beforeEach(() => {
  draftActionMock.mockClear();
});

describe("Save as draft — dispatch + the formNoValidate regression pin", () => {
  it("both wizard submits carry formNoValidate (hidden required fields must never block)", async () => {
    await renderWizardOnTerms();
    const save = screen.getByRole("button", { name: /Save as draft/ });
    const create = screen.getByRole("button", { name: /Create Agreement/ });
    expect((save as HTMLButtonElement).formNoValidate).toBe(true);
    expect((create as HTMLButtonElement).formNoValidate).toBe(true);
  });

  it("clicking Save as draft dispatches createDraftAgreementAction with the filled form", async () => {
    await renderWizardOnTerms();
    // jsdom-only concession (see header): satisfy its form-level validator.
    fill("client_signatory_name", "jsdom workaround");
    await userEvent.click(screen.getByRole("button", { name: /Save as draft/ }));

    await waitFor(() => expect(draftActionMock).toHaveBeenCalledTimes(1));
    const fd = draftActionMock.mock.calls[0][1];
    expect(fd.get("reference_number")).toBe("GEM-TEST-001");
    expect(fd.get("site_id")).toBe("s1");
    // Signatures deliberately empty on the draft path.
    expect(fd.get("client_signature")).toBe("");
  });

  it("a validation failure is VISIBLE: the server error renders, never a dead button", async () => {
    draftActionMock.mockResolvedValue({
      success: false,
      errors: { reference_number: "GEM Services Reference is required" },
      message: null,
    });
    await renderWizardOnTerms();
    fill("client_signatory_name", "jsdom workaround");
    fill("reference_number", "x"); // non-empty for jsdom's validator; the
    // SERVER decides validity — its error must render.
    await userEvent.click(screen.getByRole("button", { name: /Save as draft/ }));

    await waitFor(() =>
      expect(
        screen.getByText("GEM Services Reference is required")
      ).toBeInTheDocument()
    );
  });
});
