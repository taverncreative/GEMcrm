/**
 * useLocalFirstAction — pending state + local-failure reporting.
 *
 * Three bugs of the same family had all reached the operator as "I press
 * the button and nothing happens". This pins the wrapper half of the fix:
 *
 *   F1  The transition used to wrap ONLY the legacy server call, so every
 *       caller supplying `localSuccessState` (service sheet, booking
 *       modal, add-customer, reschedule) had `isPending` hard-wired
 *       false — the "Completing…" / "Saving…" labels could never fire.
 *
 *   F2  Both local-half failures (applyLocal threw / enqueue threw)
 *       console.error'd and returned with NO state change, so a form
 *       whose only feedback is `state.message` showed nothing, forever.
 *
 *   F4  The dispatch has to survive being called AFTER an await (the
 *       service sheet's "Complete & Email" awaits its document-readiness
 *       gate first). The transition is opened inside the dispatch, so
 *       being called late must not cost the pending state.
 *
 * Plus the double-tap guard: two taps inside one frame must enqueue ONE
 * entry, because each dispatch on the create wrappers mints fresh ids.
 */
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const enqueueMock = vi.fn(async (input: Record<string, unknown>) => {
  void input;
  return { id: 1, compacted_ids: [] };
});
vi.mock("@/lib/db/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/outbox")>();
  return {
    ...actual,
    enqueueAction: (input: Record<string, unknown>) => enqueueMock(input),
  };
});

import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";

type Input = { id: string };
interface State {
  success: boolean;
  errors: Record<string, string>;
  message: string | null;
}
const INITIAL: State = { success: false, errors: {}, message: null };

/** A deferred so a test can hold the local write open and observe pending. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function stubServerAction(): Promise<State> {
  return { success: true, errors: {}, message: "server ok" };
}

const OPTIMISTIC = {
  localSuccessState: () => ({
    success: true,
    errors: {},
    message: "saved" as string | null,
  }),
};

function baseMeta(overrides: Partial<WrapMeta<Input>> = {}): WrapMeta<Input> {
  return {
    actionName: "testAction",
    entityType: "job",
    entityId: () => "job-1",
    parseInput: () => ({ id: "job-1" }),
    applyLocal: async () => {},
    ...overrides,
  };
}

/** Renders pending + message so assertions read like the operator's screen. */
function Harness({
  meta,
  opts,
  onDispatch,
}: {
  meta: WrapMeta<Input>;
  opts?: Parameters<typeof useLocalFirstAction<State, Input>>[3];
  /** Lets a test drive the dispatch itself (e.g. after an await). */
  onDispatch?: (action: (fd: FormData) => Promise<void>) => void;
}) {
  const [state, action, isPending] = useLocalFirstAction<State, Input>(
    stubServerAction,
    INITIAL,
    meta,
    opts
  );
  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (onDispatch) onDispatch(action);
          else void action(new FormData());
        }}
      >
        {isPending ? "Saving…" : "Save"}
      </button>
      <span data-testid="msg">{state.message ?? ""}</span>
      <span data-testid="success">{String(state.success)}</span>
    </div>
  );
}

beforeEach(() => {
  enqueueMock.mockClear();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

describe("F1 — isPending on the optimistic path", () => {
  it("is true while an optimistic submit is in flight, and the button disables", async () => {
    const gate = deferred();
    const meta = baseMeta({ applyLocal: () => gate.promise });
    const user = userEvent.setup();
    render(<Harness meta={meta} opts={OPTIMISTIC} />);

    const button = screen.getByRole("button");
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent("Save");

    await user.click(button);

    // Held open by the deferred applyLocal — this is the window in which
    // the operator used to see NOTHING change.
    await waitFor(() => expect(button).toHaveTextContent("Saving…"));
    expect(button).toBeDisabled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    await waitFor(() =>
      expect(screen.getByTestId("success").textContent).toBe("true")
    );
    expect(button).not.toBeDisabled();
  });

  it("still covers the legacy path (no localSuccessState)", async () => {
    const gate = deferred();
    const meta = baseMeta({ applyLocal: () => gate.promise });
    const user = userEvent.setup();
    render(<Harness meta={meta} />);

    const button = screen.getByRole("button");
    await user.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Saving…"));

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(button).toHaveTextContent("Save"));
  });
});

describe("F4 — a dispatch called AFTER an await keeps its pending state", () => {
  it("pending flips even though the dispatch happens in an async continuation", async () => {
    const applyGate = deferred();
    const preGate = deferred();
    const meta = baseMeta({ applyLocal: () => applyGate.promise });
    const user = userEvent.setup();

    render(
      <Harness
        meta={meta}
        opts={OPTIMISTIC}
        onDispatch={(action) => {
          // Mirrors service-sheet handleConfirmComplete: an awaited
          // document-readiness gate, THEN the dispatch. This is the shape
          // that used to lose isPending entirely.
          void (async () => {
            await preGate.promise;
            void action(new FormData());
          })();
        }}
      />
    );

    const button = screen.getByRole("button");
    await user.click(button);
    // Nothing dispatched yet — the gate is still open.
    expect(button).toHaveTextContent("Save");

    await act(async () => {
      preGate.resolve();
      await preGate.promise;
    });

    await waitFor(() => expect(button).toHaveTextContent("Saving…"));
    expect(button).toBeDisabled();

    await act(async () => {
      applyGate.resolve();
      await applyGate.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("success").textContent).toBe("true")
    );
  });
});

describe("F2 — local failures surface a message instead of aborting silently", () => {
  it("applyLocal throwing sets a failure state with an operator-facing message", async () => {
    const meta = baseMeta({
      applyLocal: async () => {
        throw new Error("QuotaExceededError");
      },
    });
    const user = userEvent.setup();
    render(<Harness meta={meta} opts={OPTIMISTIC} />);

    await user.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByTestId("msg").textContent).not.toBe("")
    );
    expect(screen.getByTestId("msg").textContent).toMatch(/couldn't save/i);
    expect(screen.getByTestId("success").textContent).toBe("false");
    // Aborted before the outbox, as before.
    expect(enqueueMock).not.toHaveBeenCalled();
    // And the button is usable again so the retry is possible.
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("a failed enqueue says the write landed locally but was not queued", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("outbox unavailable"));
    const user = userEvent.setup();
    render(<Harness meta={baseMeta()} opts={OPTIMISTIC} />);

    await user.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByTestId("msg").textContent).not.toBe("")
    );
    const msg = screen.getByTestId("msg").textContent ?? "";
    // The two phases must NOT read the same: only one of them half-landed.
    expect(msg).toMatch(/saved on your device/i);
    expect(msg).toMatch(/queue/i);
    expect(screen.getByTestId("success").textContent).toBe("false");
  });

  it("a caller-supplied localFailureState wins over the generic default", async () => {
    const meta = baseMeta({
      applyLocal: async () => {
        throw new Error("boom");
      },
    });
    const user = userEvent.setup();
    render(
      <Harness
        meta={meta}
        opts={{
          ...OPTIMISTIC,
          localFailureState: () => ({
            success: false,
            errors: {},
            message: "The sheet is safe here as a draft.",
          }),
        }}
      />
    );

    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByTestId("msg").textContent).toBe(
        "The sheet is safe here as a draft."
      )
    );
  });
});

describe("double-tap guard", () => {
  it("two taps inside one frame enqueue exactly ONE entry", async () => {
    const gate = deferred();
    const meta = baseMeta({ applyLocal: () => gate.promise });
    render(<Harness meta={meta} opts={OPTIMISTIC} />);

    const button = screen.getByRole("button");
    // Fire both synchronously, before React can re-render with disabled —
    // the window a real double-tap lands in.
    await act(async () => {
      button.click();
      button.click();
    });

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    await waitFor(() =>
      expect(screen.getByTestId("success").textContent).toBe("true")
    );
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("reopens for a genuine second submit once the first has settled", async () => {
    render(<Harness meta={baseMeta()} opts={OPTIMISTIC} />);
    const user = userEvent.setup();
    const button = screen.getByRole("button");

    await user.click(button);
    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).not.toBeDisabled());

    await user.click(button);
    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(2));
  });
});

/**
 * commitLocal — the write that may only happen once delivery is queued.
 *
 * The service sheet's finalize flips `job_status` to "completed", which
 * swaps the /complete page to the view-only sheet and unmounts the form.
 * Done before the enqueue, a failed enqueue then set a failure message on
 * a form that no longer existed: the operator saw a finished sheet with
 * nothing queued for the office.
 */
describe("commitLocal ordering", () => {
  it("does NOT run when the enqueue fails, and the failure is reported", async () => {
    const commitLocal = vi.fn(async () => {});
    enqueueMock.mockRejectedValueOnce(new Error("outbox write failed"));
    const user = userEvent.setup();

    render(<Harness meta={baseMeta({ commitLocal })} opts={OPTIMISTIC} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByTestId("msg").textContent).toMatch(/queued/i)
    );
    // The claim that the work is done was never written.
    expect(commitLocal).not.toHaveBeenCalled();
    expect(screen.getByTestId("success").textContent).toBe("false");
  });

  it("runs after a successful enqueue, and only then", async () => {
    const order: string[] = [];
    const meta = baseMeta({
      applyLocal: async () => {
        order.push("applyLocal");
      },
      commitLocal: async () => {
        order.push("commitLocal");
      },
    });
    enqueueMock.mockImplementationOnce(async () => {
      order.push("enqueue");
      return { id: 1, compacted_ids: [] };
    });
    const user = userEvent.setup();

    render(<Harness meta={meta} opts={OPTIMISTIC} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() => expect(order).toContain("commitLocal"));
    expect(order).toEqual(["applyLocal", "enqueue", "commitLocal"]);
  });

  it("a throw in commitLocal is NOT reported as failure — the entry is already queued", async () => {
    const meta = baseMeta({
      commitLocal: async () => {
        throw new Error("local mirror write failed");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();

    render(<Harness meta={meta} opts={OPTIMISTIC} />);
    await user.click(screen.getByRole("button"));

    // Telling the operator "not sent" here would be a lie: it IS queued.
    await waitFor(() =>
      expect(screen.getByTestId("success").textContent).toBe("true")
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("callers without commitLocal are completely unaffected", async () => {
    const user = userEvent.setup();
    render(<Harness meta={baseMeta()} opts={OPTIMISTIC} />);
    await user.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(screen.getByTestId("success").textContent).toBe("true")
    );
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });
});
