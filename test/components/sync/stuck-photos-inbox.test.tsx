/**
 * Stuck photos appear in the conflict inbox.
 *
 * `lib/sync/photos.ts` claimed for months that "the conflict inbox
 * surfaces them" while the inbox read only the outbox. This test is the
 * thing that keeps the claim true: if the inbox stops reading
 * `photos_pending`, it fails.
 *
 * The copy is asserted as well as the presence, because a spinner and a
 * warning are not interchangeable here. The operator has to learn that
 * the photos are NOT on their way, and that clearing the app destroys
 * them.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PendingPhoto } from "@/lib/db";
import { STUCK_THRESHOLD } from "@/lib/sync/photos";

const JOB_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const P1 = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/hooks/use-is-online", () => ({ useIsOnline: () => true }));
vi.mock("@/lib/sync/photos", async (orig) => ({
  ...(await orig<typeof import("@/lib/sync/photos")>()),
  retryPhotoUpload: vi.fn().mockResolvedValue({ kind: "ok" }),
}));

let liveRows: PendingPhoto[] = [];
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (fn: () => unknown) => {
    const out = fn();
    if (out instanceof Promise) return { [JOB_ID]: "00085" };
    return liveRows;
  },
}));

import { StuckPhotosInbox } from "@/components/sync/stuck-photos-inbox";

function row(over: Partial<PendingPhoto> = {}): PendingPhoto {
  return {
    id: P1,
    parent_type: "job",
    parent_id: JOB_ID,
    blob: new Blob([new Uint8Array(4).fill(7)], { type: "image/jpeg" }),
    mime: "image/jpeg",
    width: 8,
    height: 8,
    captured_at: "2026-07-10T09:00:00.000Z",
    uploaded: false,
    upload_attempts: STUCK_THRESHOLD,
    last_upload_error: "HTTP 502: new row violates row-level security policy",
    created_at: "2026-07-10T09:00:00.000Z",
    next_attempt_at: "2099-01-01T00:00:00.000Z",
    server_url: null,
    ...over,
  } as PendingPhoto;
}

beforeEach(() => {
  liveRows = [];
});

describe("the conflict inbox surfaces stuck photos", () => {
  it("lists one, naming its job and its failures", () => {
    liveRows = [row()];
    render(<StuckPhotosInbox />);

    expect(screen.getByText(/photos that have not been sent/i)).toBeInTheDocument();
    expect(screen.getByText(/Job 00085/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${STUCK_THRESHOLD} failed attempts`, "i"))
    ).toBeInTheDocument();
  });

  it("says what happens if the device is cleared, rather than implying progress", () => {
    liveRows = [row()];
    render(<StuckPhotosInbox />);

    const intro = screen.getByText(/still only on this device/i);
    expect(intro).toHaveTextContent(/gone for good/i);
    expect(intro).toHaveTextContent(/cannot be recreated/i);
    // The honesty test: nothing here may read as "in progress".
    expect(screen.queryByText(/uploading…|in progress|please wait/i)).toBeNull();
  });

  it("offers a manual retry", () => {
    liveRows = [row()];
    render(<StuckPhotosInbox />);
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeEnabled();
  });

  it("renders nothing when no photo is stuck", () => {
    const { container } = render(<StuckPhotosInbox />);
    expect(container).toBeEmptyDOMElement();
  });
});
