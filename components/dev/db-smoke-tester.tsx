"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { wipeLocalDb, dumpLocalDb } from "@/lib/db/dev";
import { enqueueAction } from "@/lib/db/outbox";
import { newId } from "@/lib/utils/id";
import { objectToFormData } from "@/lib/sync/registry";
import { runSync } from "@/lib/sync/engine";

/**
 * Round-trip check for the FormData ↔ object serialiser pair that the
 * outbox depends on. Runs FormData → object (via inline reimpl of
 * formDataToObject's behaviour, mirroring lib/actions/wrap.ts) → back
 * to FormData via objectToFormData, then verifies every key's
 * getAll() value is identical.
 *
 * This catches regressions where one side learns to handle a new shape
 * (e.g. nested objects) without the other being updated. Diagnostic
 * surface only — no behaviour change.
 */
function runFormDataRoundtripCheck(): string {
  const before = new FormData();
  before.set("simple", "hello");
  before.set("empty", "");
  before.set("with space", "value with spaces");
  before.append("multi", "a");
  before.append("multi", "b");
  before.append("multi", "c");
  before.set("unicode", "✓ ñ 中");

  // Replicate formDataToObject (it's not exported from wrap.ts —
  // keep this self-contained).
  const obj: Record<string, string | string[]> = {};
  before.forEach((value, key) => {
    if (typeof value !== "string") {
      throw new Error(`Roundtrip: expected string, got File for ${key}`);
    }
    const existing = obj[key];
    if (existing === undefined) obj[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else obj[key] = [existing, value];
  });

  const after = objectToFormData(obj);

  const failures: string[] = [];
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  for (const k of keys) {
    const a = before.getAll(k).map(String);
    const b = after.getAll(k).map(String);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      failures.push(
        `${k}: before=${JSON.stringify(a)} after=${JSON.stringify(b)}`
      );
    }
  }

  if (failures.length === 0) {
    return `✓ FormData round-trip clean (${keys.size} keys)`;
  }
  return `✕ FormData round-trip FAILED:\n${failures.join("\n")}`;
}

/**
 * Smoke-test surface for the local Dexie store. Direct reads + writes
 * — no server actions involved. The useLiveQuery hook re-renders the
 * customer list automatically whenever the underlying table changes,
 * which is the read pattern step 7 will use throughout the app.
 *
 * Dev-only — the parent page returns 404 in production.
 */
export function DbSmokeTester() {
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const outboxCount = useLiveQuery(() => db.outbox.count(), []);
  const outboxEntries = useLiveQuery(
    () => db.outbox.orderBy("created_at").reverse().limit(20).toArray(),
    []
  );
  const photosCount = useLiveQuery(() => db.photos_pending.count(), []);
  const [busy, setBusy] = useState(false);
  const [diagnosticOutput, setDiagnosticOutput] = useState<string | null>(null);

  /**
   * Insert a hardcoded test customer directly into Dexie. Every
   * required field is filled — this is the same shape a sync pull
   * from Supabase would produce, so the smoke test exercises the
   * real row contract.
   */
  async function addTestCustomer() {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      await db.customers.add({
        id: newId(),
        created_at: now,
        updated_at: now,
        deleted_at: null,
        name: `Test ${Math.random().toString(36).slice(2, 8)}`,
        company_name: null,
        email: null,
        phone: null,
        customer_type: "domestic",
        google_review_received: false,
        review_request_snoozed_until: null,
        review_email_sent_at: null,
        mobile: null,
        position: null,
        address: null,
        address_line_1: null,
        address_line_2: null,
        town: null,
        county: null,
        postcode: null,
        website: null,
        notes: null,
        annual_contract_value: null,
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Enqueue a synthetic outbox entry so the section below shows
   * something without needing to click a real wrapped action.
   * Exercises the `enqueueAction` helper end-to-end (which is what
   * the wrapper layer calls internally).
   */
  async function addTestOutboxEntry() {
    setBusy(true);
    try {
      await enqueueAction({
        action_name: "smokeTestAction",
        args: { hello: "world", ts: Date.now() },
        entity_type: "customer",
        entity_id: newId(),
      });
    } finally {
      setBusy(false);
    }
  }

  /** Clear the outbox without touching entity tables. */
  async function clearOutbox() {
    setBusy(true);
    try {
      await db.outbox.clear();
    } finally {
      setBusy(false);
    }
  }

  async function handleWipe() {
    setBusy(true);
    try {
      await wipeLocalDb();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Wipe local Dexie (incl. sync cursors) then hard-navigate to the app
   * root — the next load boots with an EMPTY Dexie, exactly like a fresh
   * install / iOS cold relaunch. The on-device repro for the cold-start
   * gate: tap this, then watch the boot. No DevTools required.
   */
  async function handleResetAndRelaunch() {
    setBusy(true);
    try {
      await wipeLocalDb();
      window.location.href = "/";
    } catch {
      setBusy(false);
    }
  }

  async function handleDump() {
    setBusy(true);
    try {
      await dumpLocalDb();
      alert("Dump logged to console.");
    } finally {
      setBusy(false);
    }
  }

  /** Manual "Sync now" — same as the header chip's button. Useful to
   *  trigger a drain after a wrapped action without waiting 30s. */
  async function handleSyncNow() {
    setBusy(true);
    try {
      await runSync("manual");
    } finally {
      setBusy(false);
    }
  }

  function handleRoundtripCheck() {
    setDiagnosticOutput(runFormDataRoundtripCheck());
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-medium text-gray-700">Actions</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addTestCustomer}
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            + Add test customer
          </button>
          <button
            type="button"
            onClick={addTestOutboxEntry}
            disabled={busy}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            + Enqueue outbox entry
          </button>
          <button
            type="button"
            onClick={handleDump}
            disabled={busy}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Dump to console
          </button>
          <button
            type="button"
            onClick={clearOutbox}
            disabled={busy}
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            Clear outbox
          </button>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={busy}
            className="rounded-lg border border-brand-soft bg-brand-soft px-4 py-2 text-sm font-medium text-brand-darker hover:bg-brand-soft disabled:opacity-50"
          >
            Sync now
          </button>
          <button
            type="button"
            onClick={handleRoundtripCheck}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            FormData round-trip check
          </button>
          <button
            type="button"
            onClick={handleWipe}
            disabled={busy}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            Wipe local DB
          </button>
          <button
            type="button"
            onClick={handleResetAndRelaunch}
            disabled={busy}
            className="rounded-lg border border-red-300 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Reset local data &amp; relaunch
          </button>
        </div>
        {diagnosticOutput && (
          <pre
            className={`mt-3 whitespace-pre-wrap rounded-md px-3 py-2 text-xs ${
              diagnosticOutput.startsWith("✓")
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {diagnosticOutput}
          </pre>
        )}
        <dl className="mt-4 grid grid-cols-3 gap-3 text-xs text-gray-500">
          <div>
            <dt className="uppercase tracking-wider">customers</dt>
            <dd className="mt-0.5 font-mono text-base text-gray-900">
              {customers?.length ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider">outbox</dt>
            <dd className="mt-0.5 font-mono text-base text-gray-900">
              {outboxCount ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wider">photos pending</dt>
            <dd className="mt-0.5 font-mono text-base text-gray-900">
              {photosCount ?? "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-medium text-gray-700">
          outbox entries (live, newest 20)
        </h2>
        {outboxEntries === undefined ? (
          <p className="mt-2 text-xs text-gray-400">Loading…</p>
        ) : outboxEntries.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">
            No entries. Click &ldquo;+ Enqueue outbox entry&rdquo; or
            trigger a wrapped action (e.g. tick a customer&apos;s review
            checkbox).
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 text-xs">
            {outboxEntries.map((e) => (
              <li key={e.id} className="py-2 font-mono">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-gray-900">
                    {e.action_name}
                  </span>
                  <span className="text-gray-400">
                    {new Date(e.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-0.5 text-gray-500">
                  {e.entity_type} · {e.entity_id.slice(0, 8)}
                  {e.attempts > 0 && (
                    <span className="ml-2 text-amber-600">
                      ({e.attempts} attempts)
                    </span>
                  )}
                  {e.last_error && (
                    <span className="ml-2 text-red-600">
                      err: {e.last_error}
                    </span>
                  )}
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-gray-400 hover:text-gray-600">
                    args
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700">
                    {JSON.stringify(e.args, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-medium text-gray-700">
          customers (live)
        </h2>
        {customers === undefined ? (
          <p className="mt-2 text-xs text-gray-400">Loading…</p>
        ) : customers.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">
            No rows. Click &ldquo;Add test customer&rdquo; above.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {customers.map((c) => (
              <li key={c.id} className="font-mono text-xs text-gray-700">
                <span className="text-gray-400">{c.id.slice(0, 8)}</span>
                {" · "}
                {c.name}
                {" · "}
                <span className="text-gray-500">{c.customer_type}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
