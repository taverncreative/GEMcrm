/**
 * useGracefulFormAction — the replacement for wrapFormActionGracefully.
 *
 * The thing it exists to prevent: a THROWN server action reaching the
 * route error boundary, which replaces the page and unmounts the form
 * the operator's text is sitting in. `useActionState` rethrows during
 * render and does exactly that; this hook catches instead.
 *
 * ── A standing caveat about these tests ──
 *
 * They pin the hook's contract (state transitions, pending, re-entry,
 * text survival) and that is worth having. They CANNOT pin the reason
 * the old shim was deleted. React's test-environment transition
 * lifecycle is more permissive than the production build, so a client
 * closure handed to `useActionState` dispatches perfectly well in jsdom
 * while silently never dispatching in a real browser. A green run here
 * is not evidence that a form action works — only a live submit with
 * the database as the oracle is. See lib/actions/graceful.ts.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useGracefulFormAction } from "@/lib/actions/use-graceful-form-action";

interface State {
  success: boolean;
  errors: Record<string, string>;
  message: string | null;
}
const INITIAL: State = { success: false, errors: {}, message: null };

/** Mirrors the feedback form: a controlled field whose value must
 *  survive whatever the action does. */
function Harness({
  action,
}: {
  action: (prev: State, fd: FormData) => Promise<State>;
}) {
  const [state, formAction, isPending] = useGracefulFormAction(
    action,
    INITIAL
  );
  return (
    <form action={formAction}>
      <input name="message" defaultValue="typed by the operator" />
      <button type="submit" disabled={isPending}>
        {isPending ? "Sending…" : "Send"}
      </button>
      <span data-testid="msg">{state.message ?? ""}</span>
      <span data-testid="success">{String(state.success)}</span>
      <span data-testid="err">{state.errors.message ?? ""}</span>
    </form>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("results the action returns", () => {
  it("passes a success result through", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        action={async () => ({ success: true, errors: {}, message: "Sent" })}
      />
    );
    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByTestId("success").textContent).toBe("true")
    );
    expect(screen.getByTestId("msg").textContent).toBe("Sent");
  });

  it("passes a validation bounce through without touching the field", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        action={async () => ({
          success: false,
          errors: { message: "Tell us a little more" },
          message: null,
        })}
      />
    );
    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByTestId("err").textContent).toMatch(/little more/i)
    );
    // The whole point of the controlled-field work: a bounce must not
    // wipe what was typed.
    expect(screen.getByRole("textbox")).toHaveValue("typed by the operator");
  });

  it("hands the LATEST state to the action as prev, like useActionState", async () => {
    const seen: State[] = [];
    const action = async (prev: State): Promise<State> => {
      seen.push(prev);
      return { success: true, errors: {}, message: "ok" };
    };
    const user = userEvent.setup();
    render(<Harness action={action} />);

    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(seen).toHaveLength(1));
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(seen).toHaveLength(2));

    expect(seen[0]).toEqual(INITIAL);
    expect(seen[1].message).toBe("ok");
  });
});

describe("a thrown action", () => {
  it("does NOT propagate, so the form cannot be unmounted by the boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <Harness
        action={async () => {
          throw new TypeError("fetch failed");
        }}
      />
    );

    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByTestId("msg").textContent).toMatch(/try again/i)
    );
    // Still mounted, still holding the operator's text.
    expect(screen.getByRole("textbox")).toHaveValue("typed by the operator");
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("catches NON-network throws too, unlike the deleted shim", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <Harness
        action={async () => {
          throw new Error("Database constraint violation");
        }}
      />
    );

    await user.click(screen.getByRole("button"));
    // Re-throwing would hand the error boundary the very form holding
    // the operator's text. Keeping the text beats surfacing the error.
    await waitFor(() =>
      expect(screen.getByTestId("msg").textContent).toBeTruthy()
    );
    expect(screen.getByRole("textbox")).toHaveValue("typed by the operator");
  });

  it("still logs the error, so a real bug is not swallowed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <Harness
        action={async () => {
          throw new Error("Database constraint violation");
        }}
      />
    );
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]?.[1])).toMatch(/Database constraint/);
  });

  it("recovers: a retry after a throw succeeds normally", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let firstCall = true;
    const action = async (): Promise<State> => {
      if (firstCall) {
        firstCall = false;
        throw new TypeError("fetch failed");
      }
      return { success: true, errors: {}, message: "Sent" };
    };
    const user = userEvent.setup();
    render(<Harness action={action} />);

    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByTestId("msg").textContent).toMatch(/try again/i)
    );

    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByTestId("success").textContent).toBe("true")
    );
  });
});

describe("double-submit", () => {
  it("a second tap inside the same frame does not send twice", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const action = async (): Promise<State> => {
      calls++;
      await gate;
      return { success: true, errors: {}, message: "Sent" };
    };
    render(<Harness action={action} />);

    const btn = screen.getByRole("button");
    // Two clicks with no await between them — the window before React
    // re-renders with the disabled attribute.
    btn.click();
    btn.click();

    release();
    await waitFor(() =>
      expect(screen.getByTestId("success").textContent).toBe("true")
    );
    expect(calls).toBe(1);
  });
});
