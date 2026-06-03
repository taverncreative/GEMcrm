/**
 * useLocalFirstAction additive-extension regression (step 8).
 *
 * The booking wrap added three OPTIONAL WrapMeta fields (op, entityIds,
 * replayArgs) + an optional localSuccessState. The hard safeguard: when
 * a caller omits them (e.g. the service sheet), the enqueue shape and
 * the online server call must be byte-for-byte what they were before.
 *
 * These tests drive the hook through a real form submit with
 * enqueueAction mocked, and assert:
 *   - WITHOUT extras → enqueue gets {action_name, args(=formDataToObject),
 *     entity_type, entity_id} and NO `op` / NO `entity_ids` keys; the
 *     online server call receives the RAW formData. (Service-sheet shape.)
 *   - WITH extras → enqueue gets op:"create", entity_ids, and the
 *     id-enriched args; the online server call receives a FormData
 *     rebuilt from those enriched args.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture enqueue calls.
const enqueueMock = vi.fn(
  async (_input: Record<string, unknown>) => ({ id: 1, compacted_ids: [] })
);
vi.mock("@/lib/db/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/outbox")>();
  return {
    ...actual,
    enqueueAction: (input: Record<string, unknown>) => enqueueMock(input),
  };
});

import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";

type Input = { id: string; injectedId?: string };
interface State {
  success: boolean;
  errors: Record<string, string>;
  message: string | null;
}
const INITIAL: State = { success: false, errors: {}, message: null };

// Records what the server action was invoked with, so we can assert
// online id-consistency.
const serverSeen: { fd: FormData | null } = { fd: null };
async function stubServerAction(_prev: State, fd: FormData): Promise<State> {
  serverSeen.fd = fd;
  return { success: true, errors: {}, message: "ok" };
}

function Harness({
  meta,
}: {
  meta: WrapMeta<Input>;
}) {
  const [, action] = useLocalFirstAction(stubServerAction, INITIAL, meta);
  return (
    <form action={action}>
      <input type="hidden" name="thing" value="abc" />
      <button type="submit">go</button>
    </form>
  );
}

beforeEach(() => {
  enqueueMock.mockClear();
  serverSeen.fd = null;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("useLocalFirstAction — no extras (service-sheet shape preserved)", () => {
  const plainMeta: WrapMeta<Input> = {
    actionName: "plainAction",
    entityType: "job",
    entityId: () => "job-1",
    parseInput: () => ({ id: "job-1" }),
    applyLocal: async () => {},
  };

  it("enqueues with NO op and NO entity_ids; args = raw form fields", async () => {
    const user = userEvent.setup();
    render(<Harness meta={plainMeta} />);
    await user.click(screen.getByText("go"));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const call = enqueueMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.action_name).toBe("plainAction");
    expect(call.entity_type).toBe("job");
    expect(call.entity_id).toBe("job-1");
    expect(call.args).toEqual({ thing: "abc" }); // formDataToObject
    // The critical regression: these keys must be ABSENT, not undefined.
    expect("op" in call).toBe(false);
    expect("entity_ids" in call).toBe(false);
  });

  it("online server call receives the RAW formData", async () => {
    const user = userEvent.setup();
    render(<Harness meta={plainMeta} />);
    await user.click(screen.getByText("go"));
    await waitFor(() => expect(serverSeen.fd).not.toBeNull());
    expect(serverSeen.fd!.get("thing")).toBe("abc");
    // No injected id (no replayArgs).
    expect(serverSeen.fd!.get("job_id")).toBeNull();
  });
});

describe("useLocalFirstAction — with extras (booking shape)", () => {
  const richMeta: WrapMeta<Input> = {
    actionName: "createQuickBookingAction",
    entityType: "job",
    entityId: () => "job-1",
    parseInput: () => ({ id: "job-1", injectedId: "generated-job-id" }),
    applyLocal: async () => {},
    op: "create",
    entityIds: () => ["new-cust", "new-site", "generated-job-id"],
    replayArgs: (input, formData) => ({
      thing: (formData.get("thing") as string) ?? "",
      job_id: input.injectedId!,
    }),
  };

  it("enqueues op:'create', entity_ids, and id-enriched args", async () => {
    const user = userEvent.setup();
    render(<Harness meta={richMeta} />);
    await user.click(screen.getByText("go"));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const call = enqueueMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.op).toBe("create");
    expect(call.entity_ids).toEqual([
      "new-cust",
      "new-site",
      "generated-job-id",
    ]);
    expect(call.args).toEqual({ thing: "abc", job_id: "generated-job-id" });
  });

  it("online server call receives FormData rebuilt from the enriched args (id-consistency)", async () => {
    const user = userEvent.setup();
    render(<Harness meta={richMeta} />);
    await user.click(screen.getByText("go"));
    await waitFor(() => expect(serverSeen.fd).not.toBeNull());
    // The injected id reached the server call — so online inserts match
    // the rows applyLocal wrote.
    expect(serverSeen.fd!.get("job_id")).toBe("generated-job-id");
    expect(serverSeen.fd!.get("thing")).toBe("abc");
  });
});

describe("useLocalFirstAction — offline localSuccessState", () => {
  const meta: WrapMeta<Input> = {
    actionName: "createQuickBookingAction",
    entityType: "job",
    entityId: () => "job-1",
    parseInput: () => ({ id: "job-1" }),
    applyLocal: async () => {},
    op: "create",
    entityIds: () => ["job-1"],
    replayArgs: () => ({ job_id: "job-1" }),
  };

  function OfflineHarness() {
    const [state, action] = useLocalFirstAction(stubServerAction, INITIAL, meta, {
      localSuccessState: () => ({
        success: true,
        errors: {},
        message: "saved offline",
      }),
    });
    return (
      <form action={action}>
        <button type="submit">go</button>
        <span data-testid="msg">{state.message ?? ""}</span>
      </form>
    );
  }

  it("offline: flips state to localSuccessState (no server call), enqueue still happens", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const user = userEvent.setup();
    render(<OfflineHarness />);
    await user.click(screen.getByText("go"));

    await waitFor(() =>
      expect(screen.getByTestId("msg").textContent).toBe("saved offline")
    );
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    // No server call while offline.
    expect(serverSeen.fd).toBeNull();
  });
});
