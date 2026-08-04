/**
 * The photo-recovery card in Settings.
 *
 * Judged on what it renders and what it calls: the upload itself is
 * covered in test/sync/photo-recovery.test.tsx. `retryPhotoUpload` and
 * the live query are stubbed because fake-indexeddb under jsdom cannot
 * round-trip a Blob, so a blob-bearing row cannot be seeded through
 * Dexie.
 *
 * Placement matters as much as behaviour here. The bytes only exist on
 * the OPERATOR's phone, so the card lives in Settings where he can reach
 * it, and renders nothing at all when there is nothing stuck.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PendingPhoto } from "@/lib/db";

const JOB_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

let mockOnline = true;
vi.mock("@/lib/hooks/use-is-online", () => ({
  useIsOnline: () => mockOnline,
}));

const retryMock = vi.fn();
vi.mock("@/lib/sync/photos", () => ({
  retryPhotoUpload: (id: string) => retryMock(id),
}));

let liveRows: PendingPhoto[] = [];
vi.mock("dexie-react-hooks", () => ({
  // The card runs two live queries: the pending rows, then a job-reference
  // lookup. The second returns a promise, which is how they are told apart.
  useLiveQuery: (fn: () => unknown) => {
    const out = fn();
    if (out instanceof Promise) return { [JOB_ID]: "00085" };
    return liveRows;
  },
}));

import { PhotoRecoveryCard } from "@/components/settings/photo-recovery-card";

function stuckRow(id: string, over: Partial<PendingPhoto> = {}): PendingPhoto {
  return {
    id,
    parent_type: "job",
    parent_id: JOB_ID,
    blob: new Blob([new Uint8Array(4).fill(7)], { type: "image/jpeg" }),
    mime: "image/jpeg",
    width: 8,
    height: 8,
    captured_at: "2026-07-10T09:00:00.000Z",
    uploaded: false,
    upload_attempts: 5,
    last_upload_error: "HTTP 502: new row violates row-level security policy",
    created_at: "2026-07-10T09:00:00.000Z",
    next_attempt_at: "2099-01-01T00:00:00.000Z",
    server_url: null,
    ...over,
  } as PendingPhoto;
}

beforeEach(() => {
  mockOnline = true;
  liveRows = [];
  retryMock.mockReset();
  retryMock.mockResolvedValue({ kind: "ok" });
});

describe("the recovery card", () => {
  it("renders nothing when no photos are pending", () => {
    const { container } = render(<PhotoRecoveryCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a stuck photo with its job, age and attempt count", () => {
    liveRows = [stuckRow(P1)];
    render(<PhotoRecoveryCard />);
    expect(screen.getByText(/photos waiting to upload/i)).toBeInTheDocument();
    expect(screen.getByText(/Job 00085/)).toBeInTheDocument();
    expect(screen.getByText(/5 failed attempts/i)).toBeInTheDocument();
  });

  it("retries one and confirms it landed", async () => {
    liveRows = [stuckRow(P1)];
    const user = userEvent.setup();
    render(<PhotoRecoveryCard />);

    await user.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(retryMock).toHaveBeenCalledWith(P1);
    expect(
      await screen.findByText(/uploaded\. the service sheet shows it now/i)
    ).toBeInTheDocument();
  });

  it("retries all of them", async () => {
    liveRows = [stuckRow(P1), stuckRow(P2)];
    const user = userEvent.setup();
    render(<PhotoRecoveryCard />);

    await user.click(screen.getByRole("button", { name: /retry all 2/i }));
    await waitFor(() => expect(retryMock).toHaveBeenCalledTimes(2));
    expect(retryMock).toHaveBeenCalledWith(P1);
    expect(retryMock).toHaveBeenCalledWith(P2);
  });

  it("shows the error and leaves the row retryable when an upload fails", async () => {
    retryMock.mockResolvedValue({
      kind: "server-error",
      message: "Upload failed: 502",
    });
    liveRows = [stuckRow(P1)];
    const user = userEvent.setup();
    render(<PhotoRecoveryCard />);

    await user.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(await screen.findByText(/upload failed: 502/i)).toBeInTheDocument();
    // Still pressable — the whole point is that a failure is not terminal.
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeEnabled();
  });

  it("blocks the retry offline rather than failing it", () => {
    mockOnline = false;
    liveRows = [stuckRow(P1)];
    render(<PhotoRecoveryCard />);

    expect(screen.getByRole("button", { name: /^retry$/i })).toBeDisabled();
    expect(
      screen.getByText(/uploading needs a connection/i)
    ).toBeInTheDocument();
    expect(retryMock).not.toHaveBeenCalled();
  });

  it("marks a photo whose bytes are gone as unrecoverable and offers no retry", () => {
    liveRows = [stuckRow(P1, { blob: new Blob() })];
    render(<PhotoRecoveryCard />);

    expect(
      screen.getByText(/no longer has its image data on this device/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeDisabled();
    // And no "retry all", because there is nothing recoverable to sweep.
    expect(
      screen.queryByRole("button", { name: /retry all/i })
    ).not.toBeInTheDocument();
  });
});
