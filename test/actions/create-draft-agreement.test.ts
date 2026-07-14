/**
 * createDraftAgreementAction — saves an unsigned draft.
 * Pins: it inserts status='draft' and does NOT generate scheduled visits
 * (a draft puts no jobs on the calendar), then redirects to the draft.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const getSiteByIdMock = vi.fn(async () => ({ id: "s1", customer_id: "c1" }));
const createAgreementMock = vi.fn(
  async (_input: { status: string }) => ({ id: "draft1" })
);
const generateAgreementJobsMock = vi.fn(async () => undefined);
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("@/lib/data/sites", () => ({
  getSiteById: (...a: unknown[]) => getSiteByIdMock(...(a as [])),
}));
vi.mock("@/lib/data/agreements", () => ({
  createAgreement: (...a: unknown[]) =>
    (createAgreementMock as unknown as (...x: unknown[]) => Promise<unknown>)(
      ...a
    ),
}));
vi.mock("@/lib/services/agreement-events", () => ({
  generateAgreementJobs: (...a: unknown[]) => generateAgreementJobsMock(...(a as [])),
}));
vi.mock("@/lib/pdf/generate-agreement-pdf", () => ({
  generateAgreementPdf: vi.fn(),
}));
vi.mock("@/lib/storage/upload", () => ({ uploadPdf: vi.fn() }));
vi.mock("@/lib/data/customers", () => ({ getCustomerById: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/services/email", () => ({ sendAgreement: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: vi.fn(async () => ({ id: "op" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));

import { createDraftAgreementAction } from "@/app/(app)/sites/[id]/agreements/actions";

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

const full = {
  site_id: "s1",
  reference_number: "GEM-2026-001",
  contact_name: "Acme Cafe Ltd",
  contact_email: "owner@acme.test",
  contact_phone: "01234 567890",
  invoice_address: "5 Cafe Row",
  start_date: "2026-07-01",
  visit_frequency: "12",
  contract_value: "1200",
  pest_species: JSON.stringify(["Rats"]),
  callout_terms: "48-hour response",
  terms_text: "1. THE CLIENT\nThe terms.",
};

beforeEach(() => {
  createAgreementMock.mockClear();
  createAgreementMock.mockResolvedValue({ id: "draft1" });
  generateAgreementJobsMock.mockClear();
  redirectMock.mockClear();
});

describe("createDraftAgreementAction", () => {
  it("creates a status='draft' agreement, generates NO visits, redirects", async () => {
    // redirect() throws to navigate — the action call rejects.
    await expect(
      createDraftAgreementAction({ success: false, errors: {}, message: null }, fd(full))
    ).rejects.toThrow(/REDIRECT/);

    expect(createAgreementMock).toHaveBeenCalledTimes(1);
    expect(createAgreementMock.mock.calls[0][0].status).toBe("draft");

    // The load-bearing invariant: a draft puts nothing on the calendar.
    expect(generateAgreementJobsMock).not.toHaveBeenCalled();

    expect(redirectMock).toHaveBeenCalledWith("/agreements/draft1");
  });

  it("blocks when a required proposal field is missing (no create)", async () => {
    const res = await createDraftAgreementAction(
      { success: false, errors: {}, message: null },
      fd({ ...full, reference_number: "" })
    );
    expect(res.success).toBe(false);
    expect(res.errors.reference_number).toBeTruthy();
    expect(createAgreementMock).not.toHaveBeenCalled();
    expect(generateAgreementJobsMock).not.toHaveBeenCalled();
  });
});
