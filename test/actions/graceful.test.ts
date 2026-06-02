/**
 * Graceful-failure wrapper unit tests.
 *
 * Surface-3 follow-up. The three multi-entity write paths (Booking,
 * Invoice, Delete) stay online-only. The disable guard (now reliable
 * post-serverReachable commit) is the primary defense; these
 * wrappers are the safety net for the race window between modal
 * open and submit, AND for the rarer "fetch failed mid-submit"
 * case.
 *
 * Invariants the wrappers must keep:
 *
 *   1. Network-shape thrown errors (TypeError: fetch failed and
 *      friends) resolve to `{success:false, message: "…connection
 *      lost…"}` — never crash the modal.
 *   2. Server-side `{success:false, message:"…"}` results pass
 *      through unchanged — we don't second-guess the action's own
 *      error reporting.
 *   3. NON-network errors re-throw — re-shaping a real bug as a
 *      connectivity message would hide the bug. The React error
 *      boundary continues to handle these.
 */
import { describe, it, expect } from "vitest";
import {
  wrapFormActionGracefully,
  wrapDirectCallGracefully,
} from "@/lib/actions/graceful";

// Match the wrapper's TState constraint (`message: string | null`).
// Annotating the const avoids TS narrowing `message` to `null` and
// then complaining when the action returns `message: string`.
interface TestState {
  success: boolean;
  errors: Record<string, string>;
  message: string | null;
}
const STATE_PREV: TestState = { success: false, errors: {}, message: null };

describe("wrapFormActionGracefully", () => {
  it("passes server-side {success:true} results through unchanged", async () => {
    const action = async (): Promise<TestState> => ({
      success: true,
      errors: {},
      message: "Booked",
    });
    const wrapped = wrapFormActionGracefully(action);
    const res = await wrapped(STATE_PREV, new FormData());
    expect(res.success).toBe(true);
    expect(res.message).toBe("Booked");
  });

  it("passes server-side {success:false, message} results through unchanged", async () => {
    const action = async (): Promise<TestState> => ({
      success: false,
      errors: { name: "Required" },
      message: "Validation failed",
    });
    const wrapped = wrapFormActionGracefully(action);
    const res = await wrapped(STATE_PREV, new FormData());
    expect(res.success).toBe(false);
    expect(res.message).toBe("Validation failed");
    expect(res.errors).toEqual({ name: "Required" });
  });

  it("converts TypeError: fetch failed into the connection-lost shape", async () => {
    const action = async (): Promise<TestState> => {
      throw new TypeError("fetch failed");
    };
    const wrapped = wrapFormActionGracefully(action);
    const res = await wrapped(STATE_PREV, new FormData());
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/connection lost/i);
    expect(res.message).toMatch(/try again/i);
  });

  it("converts 'Failed to fetch' (Chrome shape) the same way", async () => {
    const action = async (): Promise<TestState> => {
      throw new TypeError("Failed to fetch");
    };
    const wrapped = wrapFormActionGracefully(action);
    const res = await wrapped(STATE_PREV, new FormData());
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/connection lost/i);
  });

  it("re-throws non-network errors so real bugs aren't hidden", async () => {
    const action = async (): Promise<TestState> => {
      throw new Error("Database constraint violation");
    };
    const wrapped = wrapFormActionGracefully(action);
    await expect(wrapped(STATE_PREV, new FormData())).rejects.toThrow(
      /Database constraint/
    );
  });
});

describe("wrapDirectCallGracefully", () => {
  it("passes server-side {success:true} results through unchanged", async () => {
    const action = async (_id: string) => ({ success: true });
    const wrapped = wrapDirectCallGracefully(action);
    const res = await wrapped("id-1");
    expect(res.success).toBe(true);
  });

  it("passes server-side {success:false} results through unchanged", async () => {
    const action = async (_id: string) => ({
      success: false,
      message: "Not authorized",
    });
    const wrapped = wrapDirectCallGracefully(action);
    const res = await wrapped("id-1");
    expect(res.success).toBe(false);
    expect(res.message).toBe("Not authorized");
  });

  it("converts a fetch-shaped TypeError into a graceful failure", async () => {
    const action = async (_id: string): Promise<{ success: boolean }> => {
      throw new TypeError("fetch failed");
    };
    const wrapped = wrapDirectCallGracefully(action);
    const res = await wrapped("id-1");
    expect(res.success).toBe(false);
    expect("message" in res ? res.message : "").toMatch(/connection lost/i);
  });

  it("re-throws non-network errors", async () => {
    const action = async (_id: string): Promise<{ success: boolean }> => {
      throw new Error("Permission denied");
    };
    const wrapped = wrapDirectCallGracefully(action);
    await expect(wrapped("id-1")).rejects.toThrow(/Permission denied/);
  });
});
