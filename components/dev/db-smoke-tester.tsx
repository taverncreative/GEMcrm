"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { wipeLocalDb, dumpLocalDb } from "@/lib/db/dev";
import { newId } from "@/lib/utils/id";

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
  const photosCount = useLiveQuery(() => db.photos_pending.count(), []);
  const [busy, setBusy] = useState(false);

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

  async function handleWipe() {
    setBusy(true);
    try {
      await wipeLocalDb();
    } finally {
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
            onClick={handleDump}
            disabled={busy}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Dump to console
          </button>
          <button
            type="button"
            onClick={handleWipe}
            disabled={busy}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            Wipe local DB
          </button>
        </div>
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
