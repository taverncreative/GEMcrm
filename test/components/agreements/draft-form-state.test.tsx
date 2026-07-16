/**
 * The agreement wizard must NOT destroy input on a failed submit.
 *
 * React 19 resets UNCONTROLLED form fields after every form action round
 * trip, including validation failures. With the wizard's inputs
 * uncontrolled, the live failure sequence was: first submit fails
 * validation, React wipes every typed value, the user retries, the retry
 * submits a genuinely EMPTY form, and the wizard lands on step 1 with
 * required errors over blank fields — a fully-filled contract form lost.
 * BookingModal fixed this exact class by going fully controlled
 * (see its header comment); this pins the same contract here.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const draftActionMock = vi.fn(
  async (
    _prev: unknown,
    _fd: FormData
  ): Promise<{ success: boolean; errors: Record<string, string>; message: string | null }> => ({
    success: false,
    errors: { pest_species: "Select at least one pest species" },
    message: null,
  })
);
vi.mock("@/app/(app)/sites/[id]/agreements/actions", () => ({
  createAgreementAction: vi.fn(async () => ({
    success: false,
    errors: {},
    message: null,
  })),
  createDraftAgreementAction: (prev: unknown, fd: FormData) =>
    draftActionMock(prev, fd),
}));

import { AddAgreementForm } from "@/components/agreements/add-agreement-form";

const TYPED: Record<string, string> = {
  reference_number: "GEM-KEEP-001",
  contact_name: "Keep My Data Ltd",
  invoice_address: "1 Keep Street",
  contact_phone: "01234 111222",
  contact_email: "keep@example.com",
  contract_value: "2000",
  start_date: "2026-07-20",
  visit_frequency: "6",
  callout_terms: "48-hour response",
};

function el(name: string): HTMLInputElement | HTMLTextAreaElement {
  return document.querySelector(`[name="${name}"]`) as HTMLInputElement;
}

async function renderAndFill() {
  render(<AddAgreementForm siteId="s1" />);
  await userEvent.click(screen.getByRole("button", { name: /New Agreement/ }));
  for (const [k, v] of Object.entries(TYPED)) {
    fireEvent.change(el(k), { target: { value: v } });
  }
  // jsdom-only concession: its requestSubmit ignores the submitter's
  // formnovalidate (see save-as-draft-dispatch.test.tsx header), so the
  // hidden required signee must be non-empty for the submit to dispatch.
  fireEvent.change(el("client_signatory_name"), {
    target: { value: "jsdom workaround" },
  });
}

beforeEach(() => {
  draftActionMock.mockClear();
});

describe("agreement wizard — input survives a failed submit", () => {
  it("submits the typed values, and they are STILL in the fields after the failure", async () => {
    await renderAndFill();
    await userEvent.click(screen.getByRole("button", { name: /Save as draft/ }));

    // The server got the typed values (deliberately failing on pests only).
    await waitFor(() => expect(draftActionMock).toHaveBeenCalledTimes(1));
    const fd = draftActionMock.mock.calls[0][1];
    for (const [k, v] of Object.entries(TYPED)) {
      expect(fd.get(k)).toBe(v);
    }

    // The error surfaced...
    await waitFor(() =>
      expect(
        screen.getByText("Select at least one pest species")
      ).toBeInTheDocument()
    );

    // ...and NOTHING the user typed was destroyed by the round trip.
    for (const [k, v] of Object.entries(TYPED)) {
      expect(el(k).value).toBe(v);
    }
  });

  it("a retry after the failure still submits the values (not an emptied form)", async () => {
    await renderAndFill();
    await userEvent.click(screen.getByRole("button", { name: /Save as draft/ }));
    await waitFor(() => expect(draftActionMock).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: /Save as draft/ }));
    await waitFor(() => expect(draftActionMock).toHaveBeenCalledTimes(2));
    const fd = draftActionMock.mock.calls[1][1];
    expect(fd.get("reference_number")).toBe("GEM-KEEP-001");
    expect(fd.get("contact_email")).toBe("keep@example.com");
  });
});
