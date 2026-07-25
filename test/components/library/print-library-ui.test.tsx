/**
 * Print-library UI: the confirmation hole, the disclaimer wording, Quick
 * view, and Request edit.
 *
 * The confirmation bug this pins: BasketBar's render gate used to be
 * `if (!hydrated || totalItems === 0) return null` sitting ABOVE the success
 * toast — so confirming (which empties the basket) unmounted the component
 * and the toast never rendered. The tap looked like it did nothing. The
 * success state must survive the now-empty basket.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const submitPrintOrderActionMock = vi.fn(async () => ({
  success: true,
  message: "Order sent to print.",
}));
const requestDocumentEditActionMock = vi.fn(async () => ({
  success: true,
  message: "Edit request sent.",
}));
vi.mock("@/app/(app)/library/actions", () => ({
  submitPrintOrderAction: (...a: unknown[]) =>
    (submitPrintOrderActionMock as unknown as (...x: unknown[]) => Promise<unknown>)(
      ...a
    ),
  requestDocumentEditAction: (...a: unknown[]) =>
    (requestDocumentEditActionMock as unknown as (
      ...x: unknown[]
    ) => Promise<unknown>)(...a),
  emailLibraryDocumentAction: vi.fn(async () => ({ success: true })),
  softDeleteLibraryDocumentAction: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/hooks/use-is-online", () => ({ useIsOnline: () => true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { BasketProvider } from "@/components/library/basket-context";
import { BasketBar } from "@/components/library/basket-bar";
import { LibraryDocumentRow } from "@/components/library/library-document-row";
import type { LibraryDocument } from "@/types/database";

function makeDoc(over: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    id: "doc-1",
    created_at: "2026-07-20T09:00:00Z",
    updated_at: "2026-07-20T09:00:00Z",
    deleted_at: null,
    label: "Site Rules",
    category: "Health & Safety",
    file_name: "site-rules.pdf",
    file_path: "library/site-rules.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    uploaded_by: null,
    ...over,
  };
}

/** The library page mounts both under one provider — so does this. */
function LibraryHarness({ docs }: { docs: LibraryDocument[] }) {
  return (
    <BasketProvider>
      {docs.map((d) => (
        <LibraryDocumentRow key={d.id} doc={d} />
      ))}
      <BasketBar />
    </BasketProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  submitPrintOrderActionMock.mockClear();
  requestDocumentEditActionMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("disclaimer wording", () => {
  it("reads 'exactly as they appear', never 'as supplied'", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness docs={[makeDoc()]} />);

    await user.click(screen.getByRole("button", { name: /add to basket/i }));
    await user.click(screen.getByRole("button", { name: /print basket, 1 document/i }));

    const disclaimer = await screen.findByText(/will be printed exactly/i);
    expect(disclaimer).toHaveTextContent("printed exactly as they appear");
    expect(disclaimer).not.toHaveTextContent("as supplied");
    // House rule: no em-dashes in operator copy.
    expect(disclaimer.textContent).not.toContain("—");
  });
});

describe("confirming a print order gives unmistakable feedback", () => {
  it("shows a success state, empties the basket, and offers a way back", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness docs={[makeDoc()]} />);

    await user.click(screen.getByRole("button", { name: /add to basket/i }));
    await user.click(screen.getByRole("button", { name: /print basket, 1 document/i }));
    await user.click(screen.getByRole("button", { name: /confirm order/i }));

    // 1. Unmissable success state — a dialog, not a fading inline note.
    expect(await screen.findByText("Print order sent")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: /print order sent/i })
    ).toBeInTheDocument();

    // 2. The basket is empty: no floating basket button, no "In basket" line.
    expect(screen.queryByRole("button", { name: /print basket/i })).toBeNull();
    expect(screen.queryByText(/in basket:/i)).toBeNull();

    // 3. A route back to the library rather than a dead end.
    const orderMore = screen.getByRole("button", { name: /order more documents/i });
    await user.click(orderMore);
    await waitFor(() => {
      expect(screen.queryByText("Print order sent")).toBeNull();
    });
  });

  it("the success state names what was sent", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness docs={[makeDoc(), makeDoc({ id: "doc-2", label: "COSHH" })]} />);

    const addButtons = screen.getAllByRole("button", { name: /add to basket/i });
    const qtyBoxes = screen.getAllByRole("spinbutton");
    // fireEvent over user.type: the box is a controlled number input that
    // clamps every keystroke, so typing into it is not character-faithful.
    fireEvent.change(qtyBoxes[0], { target: { value: "3" } });
    await user.click(addButtons[0]);
    await user.click(addButtons[1]);

    await user.click(screen.getByRole("button", { name: /print basket, 2 documents/i }));
    await user.click(screen.getByRole("button", { name: /confirm order/i }));

    const dialog = await screen.findByRole("dialog", { name: /print order sent/i });
    // 3 copies of one + 1 of the other.
    expect(dialog.textContent).toContain("2 documents");
    expect(dialog.textContent).toContain("4 copies");
    expect(dialog.textContent).toContain("Your basket is now empty");
  });

  it("the add-quantity box resets to 1 so no number lingers", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness docs={[makeDoc()]} />);

    const qty = screen.getByRole("spinbutton");
    fireEvent.change(qty, { target: { value: "7" } });
    expect(qty).toHaveValue(7);

    await user.click(screen.getByRole("button", { name: /add to basket/i }));

    // The typed number moves INTO the basket and the box goes back to 1 —
    // nothing lingers to make a sent order look unsent.
    expect(qty).toHaveValue(1);
    expect(screen.getByText(/in basket: 7/i)).toBeInTheDocument();
  });

  it("a failed submit keeps the basket and shows the error", async () => {
    submitPrintOrderActionMock.mockResolvedValueOnce({
      success: false,
      message: "Failed to record order",
    } as never);
    const user = userEvent.setup();
    render(<LibraryHarness docs={[makeDoc()]} />);

    await user.click(screen.getByRole("button", { name: /add to basket/i }));
    await user.click(screen.getByRole("button", { name: /print basket, 1 document/i }));
    await user.click(screen.getByRole("button", { name: /confirm order/i }));

    expect(await screen.findByText("Failed to record order")).toBeInTheDocument();
    expect(screen.queryByText("Print order sent")).toBeNull();
    // Basket intact for the retry.
    expect(screen.getByText(/1 document ·/i)).toBeInTheDocument();
  });
});

describe("quick view", () => {
  it("opens a PDF inline in a new tab (no download flag)", () => {
    render(<LibraryHarness docs={[makeDoc()]} />);
    const link = screen.getByRole("link", { name: /quick view/i });
    expect(link).toHaveAttribute("href", "/api/storage/reports/library/site-rules.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).not.toHaveAttribute("download");
  });

  it("falls back to a download for a Word document", () => {
    render(
      <LibraryHarness
        docs={[makeDoc({ file_name: "method-statement.docx", file_path: "library/method-statement.docx" })]}
      />
    );
    const link = screen.getByRole("link", { name: /quick view/i });
    expect(link).toHaveAttribute(
      "href",
      "/api/storage/reports/library/method-statement.docx?download=1"
    );
    expect(link).toHaveAttribute("download", "method-statement.docx");
    expect(link).not.toHaveAttribute("target");
  });
});

describe("request edit", () => {
  it("sends the document id and shows a clear confirmation", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness docs={[makeDoc()]} />);

    await user.click(screen.getByRole("button", { name: /request edit/i }));
    await user.type(
      screen.getByLabelText(/what needs changing/i),
      "page 2 number is old"
    );
    await user.click(screen.getByRole("button", { name: /send request/i }));

    await waitFor(() => {
      expect(requestDocumentEditActionMock).toHaveBeenCalledWith(
        "doc-1",
        "page 2 number is old"
      );
    });
    expect(
      await screen.findByText(/edit request sent for “Site Rules”/i)
    ).toBeInTheDocument();
  });

  it("surfaces a failure instead of a false confirmation", async () => {
    requestDocumentEditActionMock.mockResolvedValueOnce({
      success: false,
      message: "Document not found",
    } as never);
    const user = userEvent.setup();
    render(<LibraryHarness docs={[makeDoc()]} />);

    await user.click(screen.getByRole("button", { name: /request edit/i }));
    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByText("Document not found")).toBeInTheDocument();
    expect(screen.queryByText(/edit request sent/i)).toBeNull();
  });
});
