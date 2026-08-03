/**
 * The amend form must LOAD the sheet it is about to save.
 *
 * The server-side manifest makes the form incapable of deleting what it
 * wasn't given, but that alone would leave an amend unable to keep photos
 * or the sign-off state at all. This is the other half: the form is handed
 * the job's existing state and hands it straight back, and it declares
 * exactly which columns it is speaking for.
 *
 * The signature pads matter most here. A completed sheet stores signatures
 * as Storage objects, so the form fetches them through the same-origin
 * proxy and converts to data URLs. When that fetch FAILS (offline, storage
 * down) the pad stays blank, the operator is told why, and the form drops
 * the signature from its manifest — so the stored URL is preserved rather
 * than nulled.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/(app)/jobs/[id]/complete/actions", () => ({
  completeServiceSheetAction: vi.fn(),
  approveServiceSheetAction: vi.fn(),
}));

vi.mock("@/components/ui/signature-pad", () => ({
  SignaturePad: ({
    label,
    initialDataUrl,
  }: {
    label: string;
    initialDataUrl?: string;
    onSignature: (s: string) => void;
    onClear: () => void;
  }) => (
    <div
      data-testid={`sig-${label || "tech"}`}
      data-initial={initialDataUrl ?? ""}
    />
  ),
}));

vi.mock("@/components/ui/photo-upload", () => ({
  PhotoUpload: ({
    defaultRemoteUrls,
    onChange,
  }: {
    defaultRemoteUrls?: string[];
    onChange: (ids: string[]) => void;
  }) => (
    <button
      type="button"
      data-testid="photo-upload"
      data-remote={(defaultRemoteUrls ?? []).join("|")}
      onClick={() => onChange([])}
    >
      photos
    </button>
  ),
}));

import { ServiceSheetForm } from "@/components/jobs/service-sheet-form";
import { db } from "@/lib/db";
import { SHEET_FIELDS } from "@/lib/data/sheet-fields";

const P1 = "https://s.co/storage/v1/object/public/reports/photos/a.jpg";
const P2 = "https://s.co/storage/v1/object/public/reports/photos/b.jpg";
const TECH = "https://s.co/storage/v1/object/public/reports/signatures/j1/technician.png";
const CLIENT = "https://s.co/storage/v1/object/public/reports/signatures/j1/client.png";

/** A completed sheet, as the complete page now passes it on amend. */
const AMEND_PROPS = {
  jobId: "j1",
  mode: "amend" as const,
  defaultCallType: "routine",
  defaultFindings: "Droppings in the store room.",
  defaultRecommendations: "Bait stations installed.",
  defaultRiskComments: "No special hazards.",
  defaultPests: ["Rats"],
  defaultMethods: ["Rodenticide Used"],
  defaultClientPresent: true,
  defaultClientName: "John Lally",
  defaultInvoiceRequired: true,
  defaultPhotoUrls: [P1, P2],
  defaultTechSignatureUrl: TECH,
  defaultClientSignatureUrl: CLIENT,
};

function formData(container: HTMLElement): FormData {
  return new FormData(container.querySelector("form")!);
}

beforeEach(async () => {
  await db.service_sheet_drafts.clear();
  vi.restoreAllMocks();
});

/** Fetch stub that returns a 1x1 PNG blob for any signature request. */
function stubSignatureFetch(ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ok
        ? ({
            ok: true,
            blob: async () =>
              new Blob([Uint8Array.from([137, 80, 78, 71])], {
                type: "image/png",
              }),
          } as unknown as Response)
        : ({ ok: false, status: 500 } as unknown as Response)
    )
  );
}

describe("amend form seeds the sheet it is about to save", () => {
  it("hands back the photos and sign-off state it was given", async () => {
    stubSignatureFetch();
    const { container } = render(<ServiceSheetForm {...AMEND_PROPS} />);

    await waitFor(() =>
      expect(screen.getByTestId("photo-upload")).toBeInTheDocument()
    );

    // Photos reach the picker as the stored references...
    expect(screen.getByTestId("photo-upload")).toHaveAttribute(
      "data-remote",
      `${P1}|${P2}`
    );
    // ...and the sign-off state is in the submission.
    const fd = formData(container);
    expect(fd.get("photo_data_urls")).toBe(JSON.stringify([P1, P2]));
    expect(fd.get("client_present")).toBe("true");
    expect(fd.get("client_name")).toBe("John Lally");
    expect(fd.get("invoice_required")).toBe("true");
  });

  it("loads the stored signatures and submits them back", async () => {
    stubSignatureFetch();
    const { container } = render(<ServiceSheetForm {...AMEND_PROPS} />);

    await waitFor(() => {
      expect(formData(container).get("technician_signature")).toMatch(
        /^data:image\/png;base64,/
      );
    });
    expect(formData(container).get("client_signature")).toMatch(
      /^data:image\/png;base64,/
    );
    // Fetched through the SAME-ORIGIN proxy, which is what keeps the canvas
    // untainted so a re-sign can still call toDataURL.
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    for (const [url] of calls) {
      expect(String(url)).toMatch(/^\/api\/storage\/reports\//);
    }
  });

  it("claims every column when everything loaded", async () => {
    stubSignatureFetch();
    const { container } = render(<ServiceSheetForm {...AMEND_PROPS} />);
    await waitFor(() => {
      expect(formData(container).get("technician_signature")).toBeTruthy();
    });
    const declared = String(formData(container).get("sheet_fields")).split(",");
    for (const f of SHEET_FIELDS) {
      expect(declared, `${f} should be declared`).toContain(f);
    }
  });
});

describe("a failed signature fetch degrades safely", () => {
  it("leaves the pads blank, says why, and does NOT claim the columns", async () => {
    stubSignatureFetch(false);
    const { container } = render(<ServiceSheetForm {...AMEND_PROPS} />);

    await waitFor(() =>
      expect(
        screen.getAllByText(/couldn.t load the signature already on this sheet/i)
          .length
      ).toBeGreaterThan(0)
    );

    // Blank pad, nothing to submit.
    const fd = formData(container);
    expect(fd.get("technician_signature")).toBe("");
    expect(fd.get("client_signature")).toBe("");

    // And crucially: the columns are NOT declared, so the server leaves the
    // stored URLs alone rather than nulling them.
    const declared = String(fd.get("sheet_fields")).split(",");
    expect(declared).not.toContain("technician_signature_url");
    expect(declared).not.toContain("client_signature_url");
    // Everything else is still claimed, so the rest of the amend saves.
    expect(declared).toContain("findings");
    expect(declared).toContain("photo_urls");
    expect(declared).toContain("client_present");
  });
});

describe("a fresh fill is unaffected", () => {
  it("claims everything and fetches no signature", async () => {
    stubSignatureFetch();
    const { container } = render(
      <ServiceSheetForm jobId="j2" defaultCallType="routine" />
    );
    await waitFor(() =>
      expect(container.querySelector("form")).toBeInTheDocument()
    );
    const declared = String(formData(container).get("sheet_fields")).split(",");
    expect(declared.length).toBe(SHEET_FIELDS.length);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
