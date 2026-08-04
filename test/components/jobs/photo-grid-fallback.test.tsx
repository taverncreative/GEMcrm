/**
 * The view-only sheet must not show broken photo tiles.
 *
 * A photo reference whose Storage object is missing 404s through the
 * proxy and the browser draws its torn-image placeholder. Four completed
 * jobs hold twelve such references. Dropping the tile and falling back to
 * the normal "No photos captured" empty state says the same true thing
 * without looking like the app is broken.
 *
 * The references are deliberately NOT cleaned from the database — the
 * photo ids are the recovery key if the blobs are still on the operator's
 * device — so this is purely a render-time fallback.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// next/image with `fill` needs no layout in jsdom; a plain img keeps the
// onError contract we actually care about.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError?: () => void;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} onError={onError} data-testid="photo" />
  ),
}));

import { ServiceSheetViewOnly } from "@/components/jobs/service-sheet-view-only";
import type { Job, Site, Customer } from "@/types/database";

const BASE = "https://x.supabase.co/storage/v1/object/public/reports";

const JOB = {
  id: "j1",
  job_date: "2026-07-10",
  job_status: "completed",
  call_type: "routine",
  pest_species: ["Rats"],
  method_used: [],
  products_used: [],
  findings: "F",
  recommendations: "R",
  risk_level: "low",
  risk_comments: "RC",
  photo_urls: [`${BASE}/photos/a.jpg`, `${BASE}/photos/b.jpg`],
  client_present: false,
  technician_signature_url: null,
  client_signature_url: null,
} as unknown as Job;

const SITE = { id: "s1", address_line_1: "1 Way", town: "T" } as unknown as Site;
const CUSTOMER = { id: "c1", name: "John Lally" } as unknown as Customer;

function renderSheet(job: Job) {
  return render(
    <ServiceSheetViewOnly job={job} site={SITE} customer={CUSTOMER} />
  );
}

describe("photo grid falls back instead of showing broken tiles", () => {
  it("renders the tiles normally when the objects load", () => {
    renderSheet(JOB);
    expect(screen.getAllByTestId("photo")).toHaveLength(2);
    expect(screen.queryByText(/no photos captured/i)).not.toBeInTheDocument();
  });

  it("drops only the tile that fails, keeping the good one", () => {
    renderSheet(JOB);
    fireEvent.error(screen.getAllByTestId("photo")[0]);
    expect(screen.getAllByTestId("photo")).toHaveLength(1);
    expect(screen.queryByText(/no photos captured/i)).not.toBeInTheDocument();
  });

  it("shows the empty state once every photo has failed", () => {
    renderSheet(JOB);
    // Both objects missing — the state the four damaged jobs are in.
    fireEvent.error(screen.getAllByTestId("photo")[0]);
    fireEvent.error(screen.getAllByTestId("photo")[0]);
    expect(screen.queryAllByTestId("photo")).toHaveLength(0);
    expect(screen.getByText(/no photos captured/i)).toBeInTheDocument();
  });

  it("shows the empty state when the sheet has no photos at all", () => {
    renderSheet({ ...JOB, photo_urls: [] } as unknown as Job);
    expect(screen.getByText(/no photos captured/i)).toBeInTheDocument();
  });
});
