/**
 * Pull-merge outbox guard — single- AND multi-entity.
 *
 * The guard's job: when the pull fetches a server row whose id has an
 * unsynced local write queued in the outbox, DON'T overwrite the local
 * row. Pre-this-change the guard only protected the entry's primary
 * `entity_id`. Now it also protects every id in `entity_ids[]`, so a
 * multi-entity offline create (e.g. a booking that made a customer +
 * site + job in one atomic action) has ALL its child rows protected
 * until that action syncs — not just the job the entry is keyed on.
 *
 * These tests exercise `mergeRows` directly (exported for this purpose)
 * against the fake-indexeddb harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Table } from "dexie";
import { db } from "@/lib/db";
import { mergeRows } from "@/lib/sync/pull";

// Minimal row shape mergeRows actually touches (id + updated_at); the
// `marker` field lets us tell "local" from "server" versions apart.
type RowT = { id: string; updated_at: string; marker: string };

const jobs = () => db.jobs as unknown as Table<RowT, string>;
const customers = () => db.customers as unknown as Table<RowT, string>;

async function addOutbox(
  overrides: Partial<{
    entity_type: "customer" | "site" | "job" | "agreement" | "task";
    entity_id: string;
    entity_ids: string[];
    op: "create" | "update" | "delete";
    stuck: boolean;
  }>
) {
  const now = new Date().toISOString();
  await db.outbox.add({
    action_name: "testAction",
    args: {},
    entity_type: overrides.entity_type ?? "job",
    entity_id: overrides.entity_id ?? "",
    created_at: now,
    attempts: 0,
    last_error: null,
    next_attempt_at: now,
    stuck: overrides.stuck ?? false,
    ...(overrides.op ? { op: overrides.op } : {}),
    ...(overrides.entity_ids ? { entity_ids: overrides.entity_ids } : {}),
  });
}

beforeEach(async () => {
  await db.jobs.clear();
  await db.customers.clear();
  await db.outbox.clear();
});

describe("mergeRows — outbox guard", () => {
  it("control: with NO outbox entry, the server row is merged (server wins)", async () => {
    await jobs().put({ id: "j1", updated_at: "2026-01-01T00:00:00Z", marker: "local" });

    const res = await mergeRows(
      [{ id: "j1", updated_at: "2026-02-01T00:00:00Z", marker: "server" }],
      jobs()
    );

    expect(res.merged).toBe(1);
    expect(res.skipped).toBe(0);
    expect((await jobs().get("j1"))?.marker).toBe("server");
  });

  it("single-entity: an outbox entry on entity_id protects that row from overwrite", async () => {
    await jobs().put({ id: "j1", updated_at: "2026-01-01T00:00:00Z", marker: "local" });
    await addOutbox({ entity_type: "job", entity_id: "j1", op: "update" });

    const res = await mergeRows(
      [{ id: "j1", updated_at: "2026-02-01T00:00:00Z", marker: "server" }],
      jobs()
    );

    expect(res.skipped).toBe(1);
    expect(res.merged).toBe(0);
    // Local row untouched despite the server's newer updated_at.
    expect((await jobs().get("j1"))?.marker).toBe("local");
  });

  it("MULTI-entity: a child id in another entry's entity_ids[] is protected", async () => {
    // Simulate an offline booking: one outbox entry keyed on the job,
    // carrying the newly-created customer + site + job ids.
    await customers().put({
      id: "cust-1",
      updated_at: "2026-01-01T00:00:00Z",
      marker: "local-offline-created",
    });
    await addOutbox({
      entity_type: "job",
      entity_id: "job-X",
      entity_ids: ["cust-1", "site-1", "job-X"],
      op: "create",
    });

    // A pull mid-flight returns a (stale) server version of that customer.
    const res = await mergeRows(
      [
        {
          id: "cust-1",
          updated_at: "2026-02-01T00:00:00Z",
          marker: "server-would-clobber",
        },
      ],
      customers()
    );

    expect(res.skipped).toBe(1);
    expect(res.merged).toBe(0);
    // The locally-created customer survived — this is the regression.
    expect((await customers().get("cust-1"))?.marker).toBe(
      "local-offline-created"
    );
  });

  it("stuck entries still guard (a row awaiting conflict resolution isn't clobbered)", async () => {
    await jobs().put({ id: "j1", updated_at: "2026-01-01T00:00:00Z", marker: "local" });
    await addOutbox({ entity_type: "job", entity_id: "j1", op: "create", stuck: true });

    const res = await mergeRows(
      [{ id: "j1", updated_at: "2026-02-01T00:00:00Z", marker: "server" }],
      jobs()
    );

    expect(res.skipped).toBe(1);
    expect((await jobs().get("j1"))?.marker).toBe("local");
  });

  it("unrelated outbox entries don't over-guard: a row not referenced anywhere still merges", async () => {
    await jobs().put({ id: "j1", updated_at: "2026-01-01T00:00:00Z", marker: "local" });
    // Outbox references a DIFFERENT row.
    await addOutbox({
      entity_type: "job",
      entity_id: "other",
      entity_ids: ["another", "yetanother"],
      op: "create",
    });

    const res = await mergeRows(
      [{ id: "j1", updated_at: "2026-02-01T00:00:00Z", marker: "server" }],
      jobs()
    );

    expect(res.merged).toBe(1);
    expect((await jobs().get("j1"))?.marker).toBe("server");
  });

  it("LWW still applies for non-guarded rows: a newer LOCAL row is not overwritten by an older server row", async () => {
    await jobs().put({ id: "j1", updated_at: "2026-03-01T00:00:00Z", marker: "local-newer" });

    const res = await mergeRows(
      [{ id: "j1", updated_at: "2026-02-01T00:00:00Z", marker: "server-older" }],
      jobs()
    );

    expect(res.skipped).toBe(1);
    expect((await jobs().get("j1"))?.marker).toBe("local-newer");
  });
});
