/**
 * The agreement wizard's Create path must never look dead, and must never
 * take the customer's signatures down with it.
 *
 * Three live-field faults are pinned here.
 *
 *   1. NO PENDING STATE. The dispatch happened after `await ensureReady(...)`,
 *      which put it outside React's form-action transition, so
 *      useActionState's isPending never flipped. The button read "Create
 *      Agreement", enabled, for the entire request — on a weak mobile
 *      connection, indistinguishable from a dead button. Reported twice from
 *      the field as "nothing happens when you press it".
 *
 *   2. SIGNATURES DESTROYED ON A DROP. A network throw out of the action was
 *      rethrown during render, caught by the route error boundary, and the
 *      whole wizard unmounted inside 50ms — losing both signatures the
 *      customer had just given, in front of that customer.
 *
 *   3. NO OFFLINE GATE. Nothing told the operator that creating an agreement
 *      is online-only; he filled all four steps and then hung.
 *
 * SignaturePad is mocked to a plain button (jsdom has no canvas), so
 * "capturing a signature" here means driving the same onSignature callback
 * the real pad drives on pointerup.
 */
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";

const createActionMock = vi.fn();
vi.mock("@/app/(app)/sites/[id]/agreements/actions", () => ({
  createAgreementAction: (prev: unknown, fd: FormData) =>
    createActionMock(prev, fd),
  createDraftAgreementAction: vi.fn(async () => ({
    success: false,
    errors: {},
    message: null,
  })),
}));

// jsdom has no canvas. Stand in a button per pad that fires onSignature
// with a recognisable data URL, and render any restored signature so the
// rehydration assertion can see it.
vi.mock("@/components/ui/signature-pad", () => ({
  SignaturePad: ({
    label,
    onSignature,
    initialDataUrl,
  }: {
    label: string;
    onSignature: (d: string) => void;
    initialDataUrl?: string;
  }) => (
    <div>
      <button type="button" onClick={() => onSignature(`sig:${label}`)}>
        {`sign ${label}`}
      </button>
      <span data-testid={`restored:${label}`}>{initialDataUrl ?? ""}</span>
    </div>
  ),
}));

const onlineMock = vi.fn(() => true);
vi.mock("@/lib/hooks/use-is-online", () => ({
  useIsOnline: () => onlineMock(),
}));

import { AddAgreementForm } from "@/components/agreements/add-agreement-form";

const GEM_PAD = "sign Signed By GEM Services *";
const CLIENT_PAD = "sign Signed By Client *";

function fill(name: string, value: string) {
  const el = document.querySelector(
    `[name="${name}"]`
  ) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.change(el, { target: { value } });
}

/** Open the wizard, fill every step, and capture BOTH signatures. */
async function renderFilledAndSigned(siteId = "s1") {
  render(<AddAgreementForm siteId={siteId} />);
  await userEvent.click(
    await screen.findByRole("button", { name: /New Agreement/ })
  );
  fill("reference_number", "GEM-RESIL-001");
  fill("contact_name", "Resilience Ltd");
  fill("invoice_address", "1 Test Way");
  fill("contact_phone", "01234 567890");
  fill("contact_email", "test@example.com");
  fill("contract_value", "1200");
  fill("start_date", "2026-08-03");
  fill("visit_frequency", "12");
  fill("callout_terms", "24-hour response");
  fill("client_signatory_name", "A Client");
  await userEvent.click(screen.getByRole("button", { name: GEM_PAD }));
  await userEvent.click(screen.getByRole("button", { name: CLIENT_PAD }));
}

function createButton() {
  return screen.getByRole("button", {
    name: /Create Agreement|Creating/,
  }) as HTMLButtonElement;
}

beforeEach(async () => {
  createActionMock.mockReset();
  onlineMock.mockReturnValue(true);
  await db.agreement_drafts.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Create Agreement — pending state (fix 1)", () => {
  it("shows 'Creating...' and DISABLES the button for the whole request", async () => {
    // Hold the action open so we can observe the in-flight state, exactly
    // as a stalled request on a weak signal would.
    let release!: (v: {
      success: boolean;
      errors: Record<string, string>;
      message: string | null;
    }) => void;
    createActionMock.mockImplementation(
      () => new Promise((resolve) => (release = resolve))
    );

    await renderFilledAndSigned();
    expect(createButton().textContent).toMatch(/Create Agreement/);
    expect(createButton().disabled).toBe(false);

    await userEvent.click(createButton());

    // THE REGRESSION PIN: mid-flight the button must be visibly busy.
    await waitFor(() => {
      expect(createButton().textContent).toMatch(/Creating/);
      expect(createButton().disabled).toBe(true);
    });

    release({ success: true, errors: {}, message: "Agreement created" });
    await waitFor(() =>
      expect(screen.getByText(/Agreement created/i)).toBeTruthy()
    );
  });
});

describe("Create Agreement — a dropped connection (fix 2)", () => {
  it("keeps the form MOUNTED with both signatures intact, and explains why", async () => {
    createActionMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await renderFilledAndSigned();
    await userEvent.click(createButton());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /connection dropped/i
      )
    );

    // The wizard is still on screen...
    expect(createButton()).toBeTruthy();
    // ...every typed field survived...
    expect(
      (document.querySelector('[name="reference_number"]') as HTMLInputElement)
        .value
    ).toBe("GEM-RESIL-001");
    // ...and, the whole point, BOTH signatures are still in the payload.
    expect(
      (document.querySelector('[name="gem_signature"]') as HTMLInputElement)
        .value
    ).toBe(`sig:Signed By GEM Services *`);
    expect(
      (document.querySelector('[name="client_signature"]') as HTMLInputElement)
        .value
    ).toBe(`sig:Signed By Client *`);
    // Not stuck busy either — the operator can press again.
    expect(createButton().disabled).toBe(false);
  });

  it("a RETRY after the failure submits the same captured data and succeeds", async () => {
    createActionMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    createActionMock.mockResolvedValueOnce({
      success: true,
      errors: {},
      message: "Agreement created",
    });

    await renderFilledAndSigned();
    await userEvent.click(createButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // Signal is back. Press again — no re-typing, no re-signing.
    await userEvent.click(createButton());
    await waitFor(() =>
      expect(screen.getByText(/Agreement created/i)).toBeTruthy()
    );

    expect(createActionMock).toHaveBeenCalledTimes(2);
    const retryFd = createActionMock.mock.calls[1][1] as FormData;
    expect(retryFd.get("reference_number")).toBe("GEM-RESIL-001");
    expect(retryFd.get("gem_signature")).toBe("sig:Signed By GEM Services *");
    expect(retryFd.get("client_signature")).toBe("sig:Signed By Client *");
  });

  it("an unexpected server throw also leaves the wizard standing", async () => {
    createActionMock.mockRejectedValue(new Error("boom"));

    await renderFilledAndSigned();
    await userEvent.click(createButton());

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/something went wrong/i)
    );
    expect(
      (document.querySelector('[name="client_signature"]') as HTMLInputElement)
        .value
    ).toBe("sig:Signed By Client *");
  });
});

describe("Create Agreement — draft persistence (fix 2, belt and braces)", () => {
  it("persists the wizard INCLUDING signatures, and restores them after a reload", async () => {
    await renderFilledAndSigned("site-persist");

    // Debounced 500ms in the form.
    await waitFor(
      async () => {
        const saved = await db.agreement_drafts.get("site-persist");
        expect(saved?.client_signature).toBe("sig:Signed By Client *");
      },
      { timeout: 3000 }
    );

    const saved = await db.agreement_drafts.get("site-persist");
    expect(saved?.gem_signature).toBe("sig:Signed By GEM Services *");
    expect(saved?.fields.reference_number).toBe("GEM-RESIL-001");

    // Simulate the crash/reload: tear the whole tree down (nothing of the
    // component's state survives this) and mount fresh, as a page load would.
    cleanup();
    render(<AddAgreementForm siteId="site-persist" />);

    // Rehydrated straight into the open wizard, signatures and all.
    await waitFor(() =>
      expect(
        (document.querySelector('[name="client_signature"]') as HTMLInputElement)
          ?.value
      ).toBe("sig:Signed By Client *")
    );
    expect(
      (document.querySelector('[name="reference_number"]') as HTMLInputElement)
        .value
    ).toBe("GEM-RESIL-001");
    // The pads are told what to repaint, so the operator SEES the signature
    // rather than an empty box.
    expect(
      screen.getByTestId("restored:Signed By Client *").textContent
    ).toBe("sig:Signed By Client *");
  });

  it("clears the persisted draft once the agreement is really created", async () => {
    createActionMock.mockResolvedValue({
      success: true,
      errors: {},
      message: "Agreement created",
    });

    await renderFilledAndSigned("site-clear");
    await waitFor(
      async () =>
        expect(await db.agreement_drafts.get("site-clear")).toBeTruthy(),
      { timeout: 3000 }
    );

    await userEvent.click(createButton());
    await waitFor(() =>
      expect(screen.getByText(/Agreement created/i)).toBeTruthy()
    );
    await waitFor(async () =>
      expect(await db.agreement_drafts.get("site-clear")).toBeUndefined()
    );
  });
});

describe("Create Agreement — offline gate (fix 3)", () => {
  it("says so up front and refuses, rather than hanging", async () => {
    onlineMock.mockReturnValue(false);
    await renderFilledAndSigned();

    // Told up front, on every step, not after the fourth.
    expect(screen.getByRole("status").textContent).toMatch(/offline/i);
    // And the submit is refused rather than dispatched into the void.
    expect(createButton().disabled).toBe(true);
    expect(createActionMock).not.toHaveBeenCalled();
  });

  it("still saves the work locally while offline", async () => {
    onlineMock.mockReturnValue(false);
    await renderFilledAndSigned("site-offline");

    await waitFor(
      async () => {
        const saved = await db.agreement_drafts.get("site-offline");
        expect(saved?.client_signature).toBe("sig:Signed By Client *");
      },
      { timeout: 3000 }
    );
  });
});
