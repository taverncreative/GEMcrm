"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  createQuickBookingAction,
  searchCustomersAction,
  getSitesForCustomerAction,
} from "@/app/(app)/bookings/actions";
import { CALL_TYPES } from "@/lib/validation/booking";
import { CALL_TYPE_LABELS, COMMON_PESTS } from "@/lib/constants/job-labels";
import { todayUk } from "@/lib/utils/today-uk";
import {
  useLocalFirstAction,
  formDataToObject,
  type WrapMeta,
  type LocalFirstOptions,
} from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import { newId } from "@/lib/utils/id";
import type { ActionState } from "@/types/actions";
import type { Customer, CustomerType, Job, Site } from "@/types/database";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

// ─── Local-first booking wrap (step 8 — offline New Booking) ────────
//
// One outbox entry for the whole multi-entity action. parseInput
// generates the client UUIDs (job always; new customer/site when the
// modal is in "new" mode); applyLocal writes those rows to Dexie so
// the jobs list / customer panel show the booking instantly; the
// wrapper enqueues with entity_ids[] (the multi-entity guard) and
// replayArgs carrying the ids so the server creates the SAME rows on
// drain — online via the fast-path call, offline on reconnect.

export interface BookingWrapInput {
  jobId: string;
  /** Set only when the modal created a NEW customer — drives both the
   *  local write and (via entityIds) the discard-revert. Never the id
   *  of an existing/selected customer. */
  newCustomerId: string | null;
  newSiteId: string | null;
  /** Resolved ids the job hangs off (existing selection OR the new id). */
  customerId: string;
  siteId: string;
  modeCustomer: "existing" | "new";
  modeSite: "existing" | "new";
  // Field snapshot for applyLocal's Dexie rows.
  fields: {
    customer_name: string;
    customer_company: string;
    customer_email: string;
    customer_phone: string;
    customer_type: CustomerType;
    site_line1: string;
    site_line2: string;
    site_town: string;
    site_county: string;
    site_postcode: string;
    job_date: string;
    job_time: string;
    call_type: string;
    pest_species: string[];
    value: string;
    report_notes: string;
  };
}

function s(formData: FormData, key: string): string {
  return (formData.get(key) as string | null) ?? "";
}

function parseBookingPests(formData: FormData): string[] {
  try {
    const raw = formData.get("pest_species");
    if (typeof raw !== "string" || !raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
  } catch {
    return [];
  }
}

export const bookingMeta: WrapMeta<BookingWrapInput> = {
  actionName: "createQuickBookingAction",
  entityType: "job",
  parseInput: (formData) => {
    const modeCustomer = (s(formData, "mode_customer") || "existing") as
      | "existing"
      | "new";
    const modeSite = (s(formData, "mode_site") || "existing") as
      | "existing"
      | "new";
    const jobDate = s(formData, "job_date");
    const callType = s(formData, "call_type");

    const newCustomerId = modeCustomer === "new" ? newId() : null;
    const newSiteId = modeSite === "new" ? newId() : null;
    const customerId =
      modeCustomer === "new" ? newCustomerId! : s(formData, "customer_id");
    const siteId = modeSite === "new" ? newSiteId! : s(formData, "site_id");

    // Light guard so an incomplete offline submit doesn't write a
    // broken local booking. The server still does full Zod validation
    // online (and the modal's own UI requires these). Returning null
    // skips local write + enqueue; online the server call still runs
    // and surfaces field errors.
    if (!jobDate || !callType || !customerId || !siteId) return null;

    return {
      jobId: newId(),
      newCustomerId,
      newSiteId,
      customerId,
      siteId,
      modeCustomer,
      modeSite,
      fields: {
        customer_name: s(formData, "customer_name"),
        customer_company: s(formData, "customer_company"),
        customer_email: s(formData, "customer_email"),
        customer_phone: s(formData, "customer_phone"),
        customer_type: (s(formData, "customer_type") || "commercial") as
          | "commercial"
          | "domestic",
        site_line1: s(formData, "site_line1"),
        site_line2: s(formData, "site_line2"),
        site_town: s(formData, "site_town"),
        site_county: s(formData, "site_county"),
        site_postcode: s(formData, "site_postcode"),
        job_date: jobDate,
        job_time: s(formData, "job_time"),
        call_type: callType,
        pest_species: parseBookingPests(formData),
        value: s(formData, "value"),
        report_notes: s(formData, "report_notes"),
      },
    };
  },
  applyLocal: async (input) => {
    const now = new Date().toISOString();
    const f = input.fields;
    // New customer (only in "new" mode). Full-ish row with sane
    // defaults so the customers list / side panel render it cleanly.
    if (input.newCustomerId) {
      await db.customers.add({
        id: input.newCustomerId,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        name: f.customer_name.trim(),
        company_name: f.customer_company.trim() || null,
        email: f.customer_email.trim() || null,
        phone: f.customer_phone.trim() || null,
        customer_type: f.customer_type,
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
      } as Customer);
    }
    // New site (only in "new" mode).
    if (input.newSiteId) {
      await db.sites.add({
        id: input.newSiteId,
        customer_id: input.customerId,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        address_line_1: f.site_line1.trim() || null,
        address_line_2: f.site_line2.trim() || null,
        town: f.site_town.trim() || null,
        county: (f.site_county.trim() || "—") || null,
        postcode: f.site_postcode.trim().toUpperCase() || null,
      } as Site);
    }
    // The job — always. reference_number is null until the server
    // computes it on sync (UI falls back to the short id meanwhile).
    await db.jobs.add({
      id: input.jobId,
      site_id: input.siteId,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      job_date: f.job_date,
      job_time: f.job_time.trim() || null,
      call_type: (f.call_type || null) as Job["call_type"],
      pest_species: f.pest_species,
      findings: null,
      recommendations: null,
      treatment: null,
      pesticides_used: null,
      risk_level: null,
      risk_comments: null,
      technician_signature_url: null,
      client_signature_url: null,
      job_status: "scheduled",
      agreement_id: null,
      environmental_risk: null,
      environmental_comments: null,
      protected_species_present: false,
      method_used: [],
      photo_urls: [],
      client_present: false,
      client_name: null,
      report_notes: f.report_notes.trim() || null,
      value: f.value.trim() ? Number(f.value) : null,
      is_invoiced: false,
      is_paid: false,
      reference_number: null,
      parent_job_id: null,
      is_archived: false,
    } as Job);
  },
  entityId: (input) => input.jobId,
  // ONLY newly-created ids — keeps discard-revert surgical (an existing
  // selected customer/site is never listed here, so it can't be deleted).
  entityIds: (input) =>
    [input.newCustomerId, input.newSiteId, input.jobId].filter(
      (id): id is string => !!id
    ),
  op: "create",
  // Carry every form field plus the generated ids, so the server
  // (online fast-path AND outbox replay) creates the same rows.
  replayArgs: (input, formData) => ({
    ...formDataToObject(formData),
    job_id: input.jobId,
    customer_id_new: input.newCustomerId ?? "",
    site_id_new: input.newSiteId ?? "",
  }),
};

// Offline: no server result to flip state, so close the modal on the
// local write landing. Online, the server result drives state as
// before (so a validation failure keeps the modal open with errors).
const bookingLocalFirstOpts: LocalFirstOptions<ActionState, BookingWrapInput> =
  {
    localSuccessState: () => ({
      success: true,
      errors: {},
      message: "Booking saved — will sync when online",
    }),
  };

interface BookingModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional — prefill customer / site (e.g. when opened from a site page). */
  presetCustomer?: Customer | null;
  presetSite?: Site | null;
}

type CustomerMode = "existing" | "new";
type SiteMode = "existing" | "new";

const todayIso = () => todayUk();

/**
 * Single-modal quick booking with everything controlled.
 *
 * Every input is a controlled React state value. React's form-action behaviour
 * resets uncontrolled inputs on submit (including failed submits) — that was
 * wiping the user's typed-in date/type/notes whenever they got a "pick a site"
 * error. Controlled state survives the action round-trip.
 *
 * Site picker auto-selects the most recently created site for the chosen
 * customer (sites come back ordered newest-first from the data layer).
 */
export function BookingModal({
  open,
  onClose,
  presetCustomer,
  presetSite,
}: BookingModalProps) {
  const router = useRouter();

  // ── Customer state ──
  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    presetCustomer ?? null
  );
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [newCustomerType, setNewCustomerType] = useState<CustomerType>("commercial");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerCompany, setNewCustomerCompany] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  // ── Site state ──
  const [siteMode, setSiteMode] = useState<SiteMode>("existing");
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(presetSite ?? null);
  const [loadingSites, setLoadingSites] = useState(false);
  const [newSiteLine1, setNewSiteLine1] = useState("");
  const [newSiteLine2, setNewSiteLine2] = useState("");
  const [newSiteTown, setNewSiteTown] = useState("");
  const [newSiteCounty, setNewSiteCounty] = useState("");
  const [newSitePostcode, setNewSitePostcode] = useState("");

  // ── Booking state ──
  const [jobDate, setJobDate] = useState(todayIso);
  const [jobTime, setJobTime] = useState("");
  const [callType, setCallType] = useState("");
  const [value, setValue] = useState("");
  const [reportNotes, setReportNotes] = useState("");
  const [selectedPests, setSelectedPests] = useState<string[]>([]);

  const customerInputRef = useRef<HTMLInputElement>(null);
  const customerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOpenRef = useRef(false);

  // Local-first (step 8): applyLocal writes the booking (+ new
  // customer/site) to Dexie immediately, enqueues one multi-entity
  // outbox entry, and — online — fires the server action with the
  // same client ids. Offline, the booking is queued and the modal
  // closes via the localSuccessState option. Replaces the previous
  // graceful-online-only wrap; a mid-submit connection loss now just
  // queues the booking instead of erroring.
  const [state, action, isPending] = useLocalFirstAction(
    createQuickBookingAction,
    initialState,
    bookingMeta,
    bookingLocalFirstOpts
  );

  // Reset state on every fresh open. The guard means re-renders while open
  // don't wipe the user's input.
  useEffect(() => {
    if (!open) {
      lastOpenRef.current = false;
      return;
    }
    if (lastOpenRef.current) return;
    lastOpenRef.current = true;

    setCustomerMode("existing");
    setSiteMode("existing");
    setCustomerQuery("");
    setSelectedCustomer(presetCustomer ?? null);
    setSelectedSite(presetSite ?? null);
    setSites([]);
    setSelectedPests([]);
    setNewCustomerType("commercial");
    setNewCustomerName("");
    setNewCustomerCompany("");
    setNewCustomerEmail("");
    setNewCustomerPhone("");
    setNewSiteLine1("");
    setNewSiteLine2("");
    setNewSiteTown("");
    setNewSiteCounty("");
    setNewSitePostcode("");
    setJobDate(todayIso());
    setJobTime("");
    setCallType("");
    setValue("");
    setReportNotes("");

    if (!presetCustomer) {
      setLoadingCustomers(true);
      void searchCustomersAction("").then((data) => {
        setCustomerResults(data);
        setLoadingCustomers(false);
        setTimeout(() => customerInputRef.current?.focus(), 50);
      });
    } else {
      setLoadingSites(true);
      void getSitesForCustomerAction(presetCustomer.id).then((s) => {
        setSites(s);
        setLoadingSites(false);
        if (!presetSite && s.length > 0) {
          // Sites are ordered newest-first; default to the most recent.
          setSelectedSite(s[0]);
        } else if (s.length === 0) {
          // No sites yet — fall back to the customer's registered address
          // if they have one. Pre-fills the new-site form so the operator
          // just has to hit "Add Booking" instead of re-typing the address.
          prefillSiteFromCustomer(presetCustomer);
        }
      });
    }
  }, [open, presetCustomer, presetSite]);

  /** When a customer has no sites but the customer record itself has an
   *  address, swing the form into "new site" mode and pre-fill it from
   *  the customer record. Saves the operator from re-typing what they
   *  already entered when adding the customer. */
  function prefillSiteFromCustomer(c: Customer) {
    if (
      !c.address_line_1?.trim() &&
      !c.town?.trim() &&
      !c.postcode?.trim()
    ) {
      // No address on the customer record either — leave in existing mode.
      return;
    }
    setSiteMode("new");
    setNewSiteLine1(c.address_line_1 ?? "");
    setNewSiteLine2(c.address_line_2 ?? "");
    setNewSiteTown(c.town ?? "");
    setNewSiteCounty(c.county ?? "");
    setNewSitePostcode(c.postcode ?? "");
  }

  // Close + refresh on successful submission.
  useEffect(() => {
    if (state.success) {
      onClose();
      router.refresh();
    }
  }, [state.success, onClose, router]);

  const runCustomerSearch = useCallback((v: string) => {
    setCustomerQuery(v);
    if (customerDebounceRef.current) {
      clearTimeout(customerDebounceRef.current);
    }
    customerDebounceRef.current = setTimeout(() => {
      setLoadingCustomers(true);
      void searchCustomersAction(v).then((data) => {
        setCustomerResults(data);
        setLoadingCustomers(false);
      });
    }, 200);
  }, []);

  const pickCustomer = useCallback(async (c: Customer) => {
    setSelectedCustomer(c);
    setSelectedSite(null);
    setSiteMode("existing");
    setLoadingSites(true);
    const list = await getSitesForCustomerAction(c.id);
    setSites(list);
    setLoadingSites(false);
    if (list.length > 0) {
      // Auto-pick the most recently created site.
      setSelectedSite(list[0]);
    } else {
      // Customer has no sites — try to pre-fill from their registered
      // address so a fresh "+ Add site" form isn't blank.
      prefillSiteFromCustomer(c);
    }
  }, []);

  const togglePest = useCallback((pest: string) => {
    setSelectedPests((prev) =>
      prev.includes(pest) ? prev.filter((p) => p !== pest) : [...prev, pest]
    );
  }, []);

  if (!open) return null;

  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelClass = "block text-xs font-medium text-gray-600";

  return (
    // Full-screen on mobile (no padding, no rounded corners — feels native);
    // centered dialog capped at 90vh on tablet/desktop with internal scroll.
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:py-8">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative flex h-full w-full flex-col bg-white shadow-xl sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">New Booking</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form action={action} className="flex min-h-0 flex-1 flex-col">
          {/* All values are now sent via controlled hidden inputs derived from
              state — that way a failed submit + re-submit doesn't wipe what
              the user typed. */}
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <input type="hidden" name="mode_customer" value={customerMode} />
          <input type="hidden" name="mode_site" value={siteMode} />
          <input
            type="hidden"
            name="customer_id"
            value={customerMode === "existing" ? selectedCustomer?.id ?? "" : ""}
          />
          <input type="hidden" name="customer_type" value={newCustomerType} />
          <input type="hidden" name="customer_name" value={newCustomerName} />
          <input type="hidden" name="customer_company" value={newCustomerCompany} />
          <input type="hidden" name="customer_email" value={newCustomerEmail} />
          <input type="hidden" name="customer_phone" value={newCustomerPhone} />
          <input
            type="hidden"
            name="site_id"
            value={siteMode === "existing" ? selectedSite?.id ?? "" : ""}
          />
          <input type="hidden" name="site_line1" value={newSiteLine1} />
          <input type="hidden" name="site_line2" value={newSiteLine2} />
          <input type="hidden" name="site_town" value={newSiteTown} />
          <input type="hidden" name="site_county" value={newSiteCounty} />
          <input type="hidden" name="site_postcode" value={newSitePostcode} />
          <input type="hidden" name="job_date" value={jobDate} />
          <input type="hidden" name="job_time" value={jobTime} />
          <input type="hidden" name="call_type" value={callType} />
          <input type="hidden" name="value" value={value} />
          <input type="hidden" name="report_notes" value={reportNotes} />
          <input
            type="hidden"
            name="pest_species"
            value={JSON.stringify(selectedPests)}
          />

          {state.message && !state.success && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              {state.message}
            </div>
          )}

          {/* ─── CUSTOMER ──────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Customer
              </h3>
              <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setCustomerMode("existing");
                    setSelectedCustomer(null);
                    setSelectedSite(null);
                    setSites([]);
                  }}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    customerMode === "existing"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500"
                  }`}
                >
                  Existing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomerMode("new");
                    setSelectedCustomer(null);
                    setSelectedSite(null);
                    setSites([]);
                    setSiteMode("new");
                  }}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    customerMode === "new"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500"
                  }`}
                >
                  + New
                </button>
              </div>
            </div>

            {customerMode === "existing" ? (
              <div className="mt-2">
                {selectedCustomer ? (
                  <div className="flex items-center justify-between rounded-lg border border-brand bg-brand-soft px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-brand-darker">
                        {selectedCustomer.name}
                      </p>
                      {selectedCustomer.company_name && (
                        <p className="text-xs text-brand-darker">
                          {selectedCustomer.company_name}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setSelectedSite(null);
                        setSites([]);
                      }}
                      className="text-xs font-medium text-brand-darker hover:text-brand-darker"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      ref={customerInputRef}
                      type="text"
                      value={customerQuery}
                      onChange={(e) => runCustomerSearch(e.target.value)}
                      placeholder="Search by name or company…"
                      className={inputClass}
                    />
                    <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-gray-100">
                      {loadingCustomers ? (
                        <p className="px-3 py-4 text-center text-xs text-gray-400">
                          Searching…
                        </p>
                      ) : customerResults.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-gray-400">
                          No customers. Try “+ New” above.
                        </p>
                      ) : (
                        customerResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => pickCustomer(c)}
                            className="flex w-full items-center gap-3 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-darker">
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {c.name}
                              </p>
                              {c.company_name && (
                                <p className="truncate text-xs text-gray-500">
                                  {c.company_name}
                                </p>
                              )}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    {state.errors.customer_id && (
                      <p className="mt-1 text-xs text-red-500">
                        {state.errors.customer_id}
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelClass}>
                    Customer type <span className="text-red-500">*</span>
                  </label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {(["commercial", "domestic"] as const).map((t) => (
                      <label
                        key={t}
                        className="flex cursor-pointer items-center justify-center rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-darker"
                      >
                        <input
                          type="radio"
                          name="customer_type_radio"
                          value={t}
                          checked={newCustomerType === t}
                          onChange={() => setNewCustomerType(t)}
                          className="sr-only"
                        />
                        {t === "commercial" ? "Commercial" : "Domestic"}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="bn-customer_name" className={labelClass}>
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bn-customer_name"
                    type="text"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    required
                    placeholder="Full name"
                    className={inputClass}
                  />
                  {state.errors.customer_name && (
                    <p className="mt-1 text-xs text-red-500">
                      {state.errors.customer_name}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="bn-customer_company" className={labelClass}>
                    Company
                  </label>
                  <input
                    id="bn-customer_company"
                    type="text"
                    value={newCustomerCompany}
                    onChange={(e) => setNewCustomerCompany(e.target.value)}
                    placeholder="Optional"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="bn-customer_phone" className={labelClass}>
                    Phone
                  </label>
                  <input
                    id="bn-customer_phone"
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="Optional"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="bn-customer_email" className={labelClass}>
                    Email
                  </label>
                  <input
                    id="bn-customer_email"
                    type="email"
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    placeholder="Optional"
                    className={inputClass}
                  />
                  {state.errors.customer_email && (
                    <p className="mt-1 text-xs text-red-500">
                      {state.errors.customer_email}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ─── SITE ──────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Location
              </h3>
              <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 text-xs">
                <button
                  type="button"
                  disabled={customerMode === "new" || !selectedCustomer}
                  onClick={() => {
                    setSiteMode("existing");
                    // Re-select the most-recent site if none is currently picked.
                    if (!selectedSite && sites.length > 0) {
                      setSelectedSite(sites[0]);
                    }
                  }}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    siteMode === "existing"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500"
                  }`}
                >
                  Existing
                </button>
                <button
                  type="button"
                  onClick={() => setSiteMode("new")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    siteMode === "new"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500"
                  }`}
                >
                  + New
                </button>
              </div>
            </div>

            {siteMode === "existing" ? (
              <div className="mt-2">
                {!selectedCustomer && customerMode === "existing" ? (
                  <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    Pick a customer first.
                  </p>
                ) : selectedSite ? (
                  <>
                    <div className="flex items-center justify-between rounded-lg border border-brand bg-brand-soft px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-brand-darker">
                          {selectedSite.address_line_1}
                        </p>
                        <p className="truncate text-xs text-brand-darker">
                          {[selectedSite.town, selectedSite.postcode]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      </div>
                      {sites.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setSelectedSite(null)}
                          className="text-xs font-medium text-brand-darker hover:text-brand-darker"
                        >
                          Change
                        </button>
                      )}
                    </div>
                    {sites.length > 1 && (
                      <p className="mt-1 text-[11px] text-gray-400">
                        Most recent site auto-selected.
                      </p>
                    )}
                  </>
                ) : loadingSites ? (
                  <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-xs text-gray-400">
                    Loading sites…
                  </p>
                ) : sites.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-xs text-gray-500">
                    <p>No sites on record for this customer.</p>
                    <button
                      type="button"
                      onClick={() => setSiteMode("new")}
                      className="mt-1 font-medium text-brand-darker hover:text-brand-darker"
                    >
                      + Add a new site
                    </button>
                  </div>
                ) : (
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-100">
                    {sites.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedSite(s)}
                        className="flex w-full items-start gap-3 border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-gray-50"
                      >
                        <svg
                          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                          />
                        </svg>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {s.address_line_1}
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            {[s.town, s.postcode].filter(Boolean).join(", ")}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {state.errors.site_id && (
                  <p className="mt-1 text-xs text-red-500">
                    {state.errors.site_id}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="bn-site_line1" className={labelClass}>
                    Address Line 1 <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bn-site_line1"
                    type="text"
                    value={newSiteLine1}
                    onChange={(e) => setNewSiteLine1(e.target.value)}
                    required
                    placeholder="Street address"
                    className={inputClass}
                  />
                  {state.errors.site_line1 && (
                    <p className="mt-1 text-xs text-red-500">
                      {state.errors.site_line1}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="bn-site_town" className={labelClass}>
                    Town <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bn-site_town"
                    type="text"
                    value={newSiteTown}
                    onChange={(e) => setNewSiteTown(e.target.value)}
                    required
                    className={inputClass}
                  />
                  {state.errors.site_town && (
                    <p className="mt-1 text-xs text-red-500">
                      {state.errors.site_town}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="bn-site_postcode" className={labelClass}>
                    Postcode <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="bn-site_postcode"
                    type="text"
                    value={newSitePostcode}
                    onChange={(e) => setNewSitePostcode(e.target.value)}
                    required
                    placeholder="e.g. SW1A 1AA"
                    className={inputClass}
                  />
                  {state.errors.site_postcode && (
                    <p className="mt-1 text-xs text-red-500">
                      {state.errors.site_postcode}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ─── BOOKING ─────────────────────────────────────── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Booking
            </h3>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>
                  Date <span className="text-red-500">*</span>
                  <span className="ml-2 font-normal text-gray-400">
                    / Time
                  </span>
                </label>
                {/* flex-wrap + min-w-0 so the time input drops below the
                    date on phones whose intrinsic native date-picker width
                    would otherwise push it off-screen. */}
                <div className="mt-1 flex flex-wrap gap-2">
                  <input
                    id="bn-job_date"
                    type="date"
                    value={jobDate}
                    onChange={(e) => setJobDate(e.target.value)}
                    required
                    className="block min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                  <input
                    id="bn-job_time"
                    type="time"
                    value={jobTime}
                    onChange={(e) => setJobTime(e.target.value)}
                    placeholder="All day"
                    className="block w-28 shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
                {state.errors.job_date && (
                  <p className="mt-1 text-xs text-red-500">
                    {state.errors.job_date}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-gray-400">
                  Leave time blank for &ldquo;all day&rdquo;.
                </p>
              </div>
              <div>
                <label htmlFor="bn-call_type" className={labelClass}>
                  Call Type <span className="text-red-500">*</span>
                </label>
                <select
                  id="bn-call_type"
                  value={callType}
                  onChange={(e) => setCallType(e.target.value)}
                  required
                  className={inputClass}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {CALL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CALL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                {state.errors.call_type && (
                  <p className="mt-1 text-xs text-red-500">
                    {state.errors.call_type}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="bn-value" className={labelClass}>
                  Value
                </label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    £
                  </span>
                  <input
                    id="bn-value"
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    className="block w-full rounded-lg border border-gray-200 bg-white py-2 pl-7 pr-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Pest species (optional)</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {COMMON_PESTS.map((pest) => (
                    <button
                      key={pest}
                      type="button"
                      onClick={() => togglePest(pest)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        selectedPests.includes(pest)
                          ? "border-brand bg-brand text-white"
                          : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {pest}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="bn-report_notes" className={labelClass}>
                  Notes (optional)
                </label>
                <textarea
                  id="bn-report_notes"
                  value={reportNotes}
                  onChange={(e) => setReportNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. customer asked for morning slot, side entrance, leave gate closed…"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          </div>

          {/* Sticky footer — pinned to the bottom of the form, always visible
              so the primary CTA stays thumb-reachable on mobile as the form
              scrolls. `env(safe-area-inset-bottom)` keeps clear of the iOS
              home indicator. */}
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-100 bg-white px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:pb-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="min-h-[44px] rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 sm:min-h-0"
            >
              {isPending ? "Saving…" : "Add Booking"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
