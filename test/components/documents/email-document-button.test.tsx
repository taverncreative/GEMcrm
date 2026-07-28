/**
 * The shared Email button — used by BOTH the Documents list and the quote
 * detail page, so its behaviour is what makes the two entry points identical.
 *
 * Pins the prefill rules, since that is what changed for quotes:
 *   - a known address (a quote's own bill-to) prefills with NO customer fetch;
 *   - with no known address, it falls back to fetching the linked customer;
 *   - a prospect quote (no linked customer, no address) prefills nothing and
 *     stays perfectly usable — you just type one;
 * plus that a send goes through the one shared action, and a failed send
 * surfaces the error instead of a success dialog.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const emailDocumentActionMock = vi.fn(
  async (
    _kind: string,
    _id: string,
    recipients: string[]
  ): Promise<{
    success: boolean;
    message?: string;
    emailedTo?: string;
    label?: string;
  }> => ({ success: true, emailedTo: recipients.join(", "), label: "Quote Q-1" })
);
vi.mock("@/app/(app)/reports/actions", () => ({
  emailDocumentAction: (...a: unknown[]) =>
    (emailDocumentActionMock as unknown as (...x: unknown[]) => Promise<unknown>)(
      ...a
    ),
}));

const getCustomerDetailMock = vi.fn(async (_id: string) => ({
  customer: { id: "c1", name: "Acme", email: "customer@example.test" },
}));
vi.mock("@/app/(app)/customers/actions", () => ({
  getCustomerDetailAction: (...a: unknown[]) =>
    (getCustomerDetailMock as unknown as (...x: unknown[]) => Promise<unknown>)(
      ...a
    ),
}));

vi.mock("@/lib/hooks/use-is-online", () => ({ useIsOnline: () => true }));

import { EmailDocumentButton } from "@/components/documents/email-document-button";

beforeEach(() => {
  emailDocumentActionMock.mockClear();
  emailDocumentActionMock.mockResolvedValue({
    success: true,
    emailedTo: "someone@example.test",
    label: "Quote Q-1",
  });
  getCustomerDetailMock.mockClear();
});

function openComposer() {
  return userEvent.click(screen.getByRole("button", { name: /Email/i }));
}

describe("prefill", () => {
  it("uses the known address and does NOT fetch the customer", async () => {
    render(
      <EmailDocumentButton
        kind="quote"
        docId="q1"
        title="Quote Q-1"
        prefillEmail="quote@example.test"
        customerId="c1"
      />
    );
    await openComposer();
    const input = screen.getByLabelText(/Send to/i) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("quote@example.test"));
    // The quote's own address wins outright — a quote addressed away from the
    // customer record must not be overwritten by it.
    expect(getCustomerDetailMock).not.toHaveBeenCalled();
  });

  it("falls back to fetching the linked customer when no address is known", async () => {
    render(
      <EmailDocumentButton
        kind="service_sheet"
        docId="r1"
        title="Service Sheet"
        customerId="c1"
      />
    );
    await openComposer();
    const input = screen.getByLabelText(/Send to/i) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("customer@example.test"));
    expect(getCustomerDetailMock).toHaveBeenCalledWith("c1");
  });

  it("a PROSPECT quote (no customer, no address) opens empty and usable", async () => {
    render(
      <EmailDocumentButton
        kind="quote"
        docId="q2"
        title="Quote Q-2"
        prefillEmail={null}
        customerId={null}
      />
    );
    await openComposer();
    const input = screen.getByLabelText(/Send to/i) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(getCustomerDetailMock).not.toHaveBeenCalled();
    await userEvent.type(input, "typed@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(emailDocumentActionMock).toHaveBeenCalledWith("quote", "q2", [
        "typed@example.test",
      ])
    );
  });
});

describe("sending", () => {
  it("sends through the shared action and confirms", async () => {
    const onSent = vi.fn();
    render(
      <EmailDocumentButton
        kind="quote"
        docId="q1"
        title="Quote Q-1"
        prefillEmail="quote@example.test"
        onSent={onSent}
      />
    );
    await openComposer();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(emailDocumentActionMock).toHaveBeenCalledWith("quote", "q1", [
        "quote@example.test",
      ])
    );
    expect(await screen.findByText("Document sent")).toBeTruthy();
    expect(onSent).toHaveBeenCalled();
  });

  it("a failed send shows the error and no confirmation", async () => {
    const onSent = vi.fn();
    emailDocumentActionMock.mockResolvedValue({
      success: false,
      message: "Email failed to send. Try again.",
    });
    render(
      <EmailDocumentButton
        kind="quote"
        docId="q1"
        title="Quote Q-1"
        prefillEmail="quote@example.test"
        onSent={onSent}
      />
    );
    await openComposer();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Email failed to send. Try again.")
    ).toBeTruthy();
    expect(screen.queryByText("Document sent")).toBeNull();
    // No refresh, because nothing changed — the quote is still a draft.
    expect(onSent).not.toHaveBeenCalled();
  });

  it("an invalid recipient is blocked client-side, before the action", async () => {
    render(
      <EmailDocumentButton
        kind="quote"
        docId="q1"
        title="Quote Q-1"
        prefillEmail="quote@example.test"
      />
    );
    await openComposer();
    const input = screen.getByLabelText(/Send to/i);
    await userEvent.clear(input);
    await userEvent.type(input, "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/is not a valid email address/)).toBeTruthy();
    expect(emailDocumentActionMock).not.toHaveBeenCalled();
  });
});
