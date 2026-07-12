import { describe, it, expect } from "vitest";
import { describeStuckEntry } from "@/lib/sync/describe-stuck";
import type { OutboxEntry } from "@/lib/db";

/**
 * H3 — the stuck-sync alert must name the record in operator terms, never
 * developer jargon. These pin the copy the operator actually reads.
 */

function entry(partial: Partial<OutboxEntry>): OutboxEntry {
  return {
    action_name: "x",
    args: {},
    entity_type: "job",
    entity_id: "id",
    created_at: "2026-07-12T00:00:00Z",
    attempts: 5,
    last_error: "boom",
    next_attempt_at: "2026-07-12T00:00:00Z",
    stuck: true,
    ...partial,
  };
}

describe("describeStuckEntry", () => {
  it("names a booking with customer + date", () => {
    const out = describeStuckEntry(
      entry({
        action_name: "createQuickBookingAction",
        args: { customer_name: "Jane Doe", job_date: "2026-07-14" },
      })
    );
    expect(out).toBe("Booking for Jane Doe on 14 Jul didn't reach the server");
  });

  it("degrades gracefully when the booking has no name (existing customer)", () => {
    const out = describeStuckEntry(
      entry({
        action_name: "createQuickBookingAction",
        args: { customer_name: "", customer_id: "abc", job_date: "2026-07-14" },
      })
    );
    expect(out).toBe("Booking on 14 Jul didn't reach the server");
  });

  it("names a service sheet", () => {
    const out = describeStuckEntry(
      entry({
        action_name: "completeServiceSheetAction",
        args: { client_name: "Acme Ltd" },
      })
    );
    expect(out).toBe("Service sheet for Acme Ltd didn't reach the server");
  });

  it("names a new customer", () => {
    const out = describeStuckEntry(
      entry({ action_name: "createCustomerAction", args: { name: "New Co" } })
    );
    expect(out).toBe("New customer New Co didn't reach the server");
  });

  it("uses a friendly fallback for other known actions", () => {
    expect(
      describeStuckEntry(entry({ action_name: "updateJobStatusAction" }))
    ).toBe("Job status change didn't reach the server");
  });

  it("never leaks the raw action name for unknown actions", () => {
    const out = describeStuckEntry(entry({ action_name: "someInternalAction" }));
    expect(out).toBe("A change you made didn't reach the server");
    expect(out).not.toContain("someInternalAction");
  });

  it("tolerates malformed args without throwing", () => {
    expect(() =>
      describeStuckEntry(entry({ action_name: "createQuickBookingAction", args: null }))
    ).not.toThrow();
  });
});
