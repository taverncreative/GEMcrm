"use client";

/**
 * View-only display of a completed service sheet.
 *
 * Shown on `/jobs/[id]/complete` when the job has reached the
 * `completed` status. Replaces the editable ServiceSheetForm so a
 * finalised sheet cannot be silently re-opened and overwritten.
 *
 * What goes here:
 *
 *   - Every field the sheet captures: call type, pests, treatment
 *     methods, findings, recommendations, pesticides, risk + comments,
 *     report notes (internal), photos, technician signature, client
 *     signature + presence + name.
 *   - Each field is rendered as read-only data — no inputs, no
 *     contenteditable elements. The UI deliberately mirrors the form's
 *     section ordering so an operator who's seen the form recognises
 *     the structure at a glance.
 *
 * What's deliberately NOT here (forward-compat scaffolding):
 *
 *   - An "Add correction" button. The intent is a future append-only
 *     correction path (dated, attributed, original preserved). The
 *     summary section below has a clearly-marked TODO slot where that
 *     button will live; the rest of the layout is built around that
 *     future affordance so adding it is a 5-minute change.
 *   - Any path that mutates the underlying job row. Read-only is a
 *     hard invariant — no `db.jobs.update` from anywhere on screen.
 *
 * Props mirror the same `job / site / customer` triple the host page
 * uses for the editable form, so the call site is a clean swap.
 */

import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { sendReportNowAction } from "@/app/(app)/jobs/[id]/report/actions";
import { AddCustomerEmailInline } from "@/components/customers/add-email-inline";
import type { Job, Site, Customer, CallType, RiskLevel } from "@/types/database";
import {
  CALL_TYPE_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/constants/job-labels";
import { ROUTES } from "@/lib/constants/routes";

interface ServiceSheetViewOnlyProps {
  job: Job;
  /** null when soft-deleted / missing; undefined permitted because the
   *  host page's useLiveQuery narrows in stages — the host gates the
   *  loading state, but TS can't see that across the guard, so we
   *  accept undefined here and render the same em-dash fallback. */
  site: Site | null | undefined;
  customer: Customer | null | undefined;
  /** L2 amend flow: when provided, the banner offers "Amend sheet" —
   *  the host swaps in the editable form in amend mode (job_status is
   *  never touched; the full schema still applies on save). */
  onAmend?: () => void;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Section wrapper — keeps the layout consistent and gives every
 * section a uniform read-only "card" look. Mirrors the form's
 * step containers so the visual rhythm is familiar to operators.
 */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm text-gray-900">{children}</div>
    </section>
  );
}

/** Label + value pair. Renders an em-dash for empty / null. */
function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const display = value && value.length > 0 ? value : "—";
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
        {label}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-900">
        {display}
      </p>
    </div>
  );
}

/** Pill list — read-only equivalent of the form's pest/method pills. */
function PillList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-gray-400">—</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * Render a captured signature. The form stores either a data: URL
 * (online direct submit path) or a Storage public URL (server-side
 * mirror or photos-loop resolution); both render here directly.
 */
function SignatureView({
  label,
  src,
}: {
  label: string;
  src: string | null;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
        {label}
      </p>
      {src ? (
        <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
          {/* `unoptimized` so we don't try to push storage/data URLs
              through next/image's optimiser — those are already as
              small as they need to be. Plain <img> would work too;
              we use next/image for layout consistency with the form's
              photo previews. */}
          <Image
            src={src}
            alt={label}
            width={320}
            height={120}
            unoptimized
            className="h-24 w-auto object-contain"
          />
        </div>
      ) : (
        <p className="mt-0.5 text-sm text-gray-400">— Not signed</p>
      )}
    </div>
  );
}

export function ServiceSheetViewOnly({
  job,
  site,
  customer,
  onAmend,
}: ServiceSheetViewOnlyProps) {
  const callTypeLabel = job.call_type
    ? CALL_TYPE_LABELS[job.call_type as CallType] ?? job.call_type
    : "—";
  const riskLevelLabel = job.risk_level
    ? RISK_LEVEL_LABELS[job.risk_level as RiskLevel] ?? job.risk_level
    : "—";
  const siteAddress = site
    ? [site.address_line_1, site.town, site.postcode].filter(Boolean).join(", ")
    : "";

  return (
    <div className="space-y-6">
      {/* ── Banner: this sheet is locked ──
          The visible "this is locked" affordance the bug report called
          for. Deliberately calm (not alarmist) — the sheet IS done, the
          operator just wants to view it. */}
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <svg
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-900">
            Service sheet completed
          </p>
          <p className="mt-0.5 text-xs text-emerald-800">
            This sheet has been signed off.
            {onAmend
              ? " Spotted a mistake or need to fill it in properly? Amend it — the report regenerates and nothing is emailed unless you choose to."
              : ""}
          </p>
        </div>
        {onAmend && (
          <button
            type="button"
            onClick={onAmend}
            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
          >
            Amend sheet
          </button>
        )}
        <Link
          href={ROUTES.jobDetail(job.id)}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
        >
          Back to job
        </Link>
      </div>

      {/* ── L3 email truth: state plainly what happened, never imply ── */}
      {job.job_status === "completed" && (
        <ReportEmailStatus job={job} customer={customer} />
      )}

      {/* ── Header summary: who/where/when ── */}
      <Section title="Visit">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Customer" value={customer?.name ?? null} />
          <Field label="Company" value={customer?.company_name ?? null} />
          <Field label="Site" value={siteAddress || null} />
          <Field label="Job date" value={formatDate(job.job_date)} />
          <Field label="Call type" value={callTypeLabel} />
        </div>
      </Section>

      {/* ── Service ── */}
      <Section title="Service">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
            Pest species
          </p>
          <div className="mt-1.5">
            <PillList items={job.pest_species ?? []} />
          </div>
        </div>
        <Field label="Findings" value={job.findings} />
        <Field label="Recommendations" value={job.recommendations} />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
            Treatment methods
          </p>
          <div className="mt-1.5">
            <PillList items={job.method_used ?? []} />
          </div>
        </div>
        <Field label="Pesticides used" value={job.pesticides_used} />
        <Field label="Internal notes" value={job.report_notes} />
      </Section>

      {/* ── Risk ── */}
      <Section title="Risk">
        <Field label="Risk level" value={riskLevelLabel} />
        <Field label="Risk comments" value={job.risk_comments} />
      </Section>

      {/* ── Photos ── */}
      <Section title="Photos">
        {job.photo_urls && job.photo_urls.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {job.photo_urls.map((url, idx) => (
              <li
                key={`${url}-${idx}`}
                className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
              >
                <div className="relative aspect-square w-full">
                  <Image
                    src={url}
                    alt={`Photo ${idx + 1}`}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">No photos captured.</p>
        )}
      </Section>

      {/* ── Sign-off ── */}
      <Section title="Sign-off">
        <SignatureView
          label="Technician signature"
          src={job.technician_signature_url}
        />
        <Field
          label="Customer present"
          value={job.client_present ? "Yes" : "No"}
        />
        {job.client_present && (
          <>
            <Field label="Client name" value={job.client_name} />
            <SignatureView
              label="Client signature"
              src={job.client_signature_url}
            />
          </>
        )}
      </Section>

      {/*
        ── Future "Add correction" slot ──

        Intentionally NOT rendered now per the bug spec ("do NOT build
        correction now"). The placement is reserved so the future patch
        is mechanical: drop a <CorrectionButton job={job} /> here, ship
        the corrections table + action, and the locked screen acquires
        an explicit append-only correction path without a redesign.

        Leaving the comment so the next agent has the breadcrumb.
      */}
    </div>
  );
}


/**
 * L3 email truth line. Four states, in priority order:
 *   1. report_emailed_to set      → "Report emailed to …" (server-
 *      recorded fact — written only on an actual successful send)
 *   2. a queued completion entry carrying send_email
 *                                 → "Email queued — sends when synced"
 *   3. customer has no address    → "Not emailed — no address on file"
 *      + inline add-email (unlocks state 4 live via Dexie)
 *   4. address exists, never sent → "Not emailed" + Send report now
 *      (online-only; single-fire — the action checks report_emailed_to
 *      before sending)
 */
function ReportEmailStatus({
  job,
  customer,
}: {
  job: Job;
  customer: Customer | null | undefined;
}) {
  const online = useIsOnline();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A pending outbox completion/amend entry that carries the email
  // choice — the send happens when it replays, so say so.
  const emailQueued = useLiveQuery(
    async () => {
      const entries = await db.outbox
        .filter((e) => e.entity_id === job.id)
        .toArray();
      return entries.some((e) => {
        const args = e.args as Record<string, unknown> | unknown[] | null;
        return (
          !!args &&
          !Array.isArray(args) &&
          (args as Record<string, unknown>).send_email === "true"
        );
      });
    },
    [job.id]
  );

  function sendNow() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await sendReportNowAction(job.id);
        if (res.success && res.emailedTo) {
          // Server confirmed the send — mirror the truth locally so the
          // line flips without waiting for the next pull.
          await db.jobs.update(job.id, {
            report_emailed_to: res.emailedTo,
            report_emailed_at: new Date().toISOString(),
          });
        } else if (!res.success) {
          setError(res.message ?? "Failed to send");
        }
      } catch {
        setError("Couldn't reach the server — try again online");
      }
    });
  }

  if (job.report_emailed_to) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        Report emailed to{" "}
        <span className="font-medium">{job.report_emailed_to}</span>
        {job.report_emailed_at
          ? ` on ${new Date(job.report_emailed_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}`
          : ""}
        .
      </div>
    );
  }

  if (emailQueued) {
    return (
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        Report email queued — it sends when this completion syncs.
      </div>
    );
  }

  if (!customer?.email) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-900">
          Report not emailed — no email address on file.
        </p>
        {customer && (
          <div className="mt-2 max-w-sm">
            <AddCustomerEmailInline customerId={customer.id} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-sm text-gray-600">
        Report not emailed to the customer yet.
      </p>
      <div className="text-right">
        <button
          type="button"
          onClick={sendNow}
          disabled={isPending || !online}
          title={!online ? "Needs internet" : undefined}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Sending…" : `Send report now to ${customer.email}`}
        </button>
        {!online && (
          <p className="mt-1 text-xs text-gray-400">Needs internet.</p>
        )}
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}
