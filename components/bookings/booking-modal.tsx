"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createQuickBookingAction } from "@/app/(app)/bookings/actions";
import {
  searchCustomersLocal,
  getSitesForCustomerLocal,
  findClashingJobLocal,
} from "@/lib/db/lookups";
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
import { TimeWindowPicker } from "@/components/ui/time-window-picker";
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
    job_time_end: string;
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

/**
 * Build the local-first meta for the modal.
 *
 * Two modes, one shared multi-entity machinery:
 *
 *   - CREATE (no `draftJobId`) — the original New Booking path. Mints a
 *     fresh job id, `op:"create"`, applyLocal INSERTs the job, entityIds
 *     lists every newly-created id (incl. the job) so a discard-revert is
 *     surgical.
 *
 *   - UPGRADE (`draftJobId` set, Q3) — attach-to-draft. The job already
 *     exists, so `jobId` IS the draft id, `op:"update"`, and applyLocal
 *     UPDATEs that row (sets the resolved site + booking fields, flips
 *     status draft → scheduled) instead of inserting. capture_note is
 *     left untouched (persists); reference_number stays null until the
 *     server computes it on replay. New-customer/new-site INSERTs are
 *     identical to the create path, so the proven FK ordering carries
 *     over wholesale (server-side the action creates customer → site →
 *     then UPDATEs the job).
 *
 * Fork A discard-revert safety: in upgrade mode `op` is "update", so
 * revertLocalCreate (which acts ONLY on op:"create") never fires on the
 * draft — the operator's original capture can't be deleted. `entityIds`
 * lists ONLY the newly-created customer/site (NOT the pre-existing draft
 * job), both for revert-set hygiene and so the pull-merge guard protects
 * them while the upgrade is pending.
 *
 * Accepted edge (Fork A, documented): if the operator upgrades a draft
 * while OFFLINE, creating a NEW customer + site, then discards that entry
 * from the conflict inbox BEFORE any sync, those new customer/site rows
 * linger in Dexie as unreferenced local orphans (the draft job is
 * separately reverted to draft by the next pull). Rare, low harm; the
 * fully-correct "update-with-children revert" (Fork B) is deliberately
 * deferred.
 */
export function makeBookingMeta(
  draftJobId?: string
): WrapMeta<BookingWrapInput> {
  const isUpgrade = !!draftJobId;
  return {
    actionName: isUpgrade
      ? "upgradeDraftToBookingAction"
      : "createQuickBookingAction",
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
      // A CREATE booking with no site still mints a bare site, so a quick
      // add gets the optimistic Dexie write + offline sync (the server
      // creates the same bare site on replay, addressed by site_id_new).
      // Upgrade is unchanged (it always carries a resolved site).
      const needNewSite =
        modeSite === "new" || (!isUpgrade && !s(formData, "site_id"));
      const newSiteId = needNewSite ? newId() : null;
      const customerId =
        modeCustomer === "new" ? newCustomerId! : s(formData, "customer_id");
      const siteId = needNewSite ? newSiteId! : s(formData, "site_id");

      // Minimum for a local booking: a customer + a date (the site is always
      // resolved above). call_type and the other now-optional fields no
      // longer gate the local write, so a sparse quick add is written
      // locally and queued for sync exactly like a full booking.
      if (!jobDate || !customerId || !siteId) return null;

      return {
        // Upgrade reuses the draft's id (the row already exists); create
        // mints a fresh one.
        jobId: draftJobId ?? newId(),
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
          job_time_end: s(formData, "job_time_end"),
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
      if (isUpgrade) {
        // UPGRADE: mutate the existing draft in place. site_id null →
        // resolved site, status draft → scheduled, booking fields filled.
        // capture_note is deliberately NOT touched (persists); the server
        // fills reference_number on replay (UI falls back to short id).
        await db.jobs.update(input.jobId, {
          site_id: input.siteId,
          job_date: f.job_date,
          job_time: f.job_time.trim() || null,
          job_time_end: f.job_time_end.trim() || null,
          call_type: (f.call_type || null) as Job["call_type"],
          pest_species: f.pest_species,
          report_notes: f.report_notes.trim() || null,
          value: f.value.trim() ? Number(f.value) : null,
          job_status: "scheduled",
          updated_at: now,
        });
      } else {
        // CREATE: insert the job. reference_number is null until the
        // server computes it on sync (UI falls back to the short id).
        await db.jobs.add({
          id: input.jobId,
          site_id: input.siteId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          job_date: f.job_date,
          job_time: f.job_time.trim() || null,
          job_time_end: f.job_time_end.trim() || null,
          capture_note: null,
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
          report_emailed_to: null,
          report_emailed_at: null,
          reference_number: null,
          parent_job_id: null,
          is_archived: false,
        } as Job);
      }
    },
    entityId: (input) => input.jobId,
    // CREATE: every newly-created id (incl. the job) so discard-revert is
    // surgical. UPGRADE: ONLY the new customer/site — the draft job
    // pre-exists, so it must NOT be in the revert set (and op:"update"
    // means revertLocalCreate won't fire anyway — see the doc above).
    entityIds: (input) =>
      (isUpgrade
        ? [input.newCustomerId, input.newSiteId]
        : [input.newCustomerId, input.newSiteId, input.jobId]
      ).filter((id): id is string => !!id),
    op: isUpgrade ? "update" : "create",
    // Carry every form field plus the generated ids, so the server
    // (outbox replay) writes the same rows. Upgrade addresses the draft
    // via `draft_job_id`; create injects the new job id as `job_id`.
    replayArgs: (input, formData) => ({
      ...formDataToObject(formData),
      ...(isUpgrade
        ? { draft_job_id: input.jobId }
        : { job_id: input.jobId }),
      customer_id_new: input.newCustomerId ?? "",
      site_id_new: input.newSiteId ?? "",
    }),
  };
}

/** Create-mode meta (no draft). Stable module ref for the create default
 *  and the booking-meta unit tests. */
export const bookingMeta: WrapMeta<BookingWrapInput> = makeBookingMeta();

// Optimistic close: providing `localSuccessState` puts the booking on the
// wrapper's optimistic path — the modal closes the instant the local Dexie
// write + outbox entry land, regardless of connectivity, and the engine
// syncs to the server in the background. No server action runs at submit.
const bookingLocalFirstOpts: LocalFirstOptions<ActionState, BookingWrapInput> =
  {
    localSuccessState: () => ({
      success: true,
      errors: {},
      message: "Booking saved",
    }),
  };

// ─── Smart contact match for draft upgrades (Track 2, Half 2) ───────
//
// When a draft carries a captured caller name/phone, classify it against
// the synced customers BEFORE defaulting the customer step. REUSES the
// existing offline customer search (searchCustomersLocal — name/company
// substring, soft-delete-excluded); no new lookup, no server call.
//
//   strong → an exact (case-insensitive) name match, OR a candidate whose
//            phone/mobile matches the captured number — a returning caller.
//            The upgrade preselects them so they're not duplicated.
//   weak   → a partial name hit (substring, not exact) — kept as a "new"
//            default but surfaced as a tappable hint.
//   none   → nothing matched (or no contact captured) → "new", as-is.
type ContactMatch =
  | { kind: "none" }
  | { kind: "weak"; customer: Customer }
  | { kind: "strong"; customer: Customer };

function digitsOnly(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

async function matchCapturedContact(
  name: string,
  phone: string
): Promise<ContactMatch> {
  const nm = name.trim();
  const ph = digitsOnly(phone);
  if (!nm && !ph) return { kind: "none" };
  // Name-driven (the everyday capture). Phone, when present, strengthens a
  // partial name hit to a confident match among those candidates.
  const candidates = nm ? await searchCustomersLocal(nm) : [];
  if (candidates.length === 0) return { kind: "none" };
  const lowerNm = nm.toLowerCase();
  const strong =
    candidates.find((c) => (c.name ?? "").trim().toLowerCase() === lowerNm) ??
    (ph
      ? candidates.find(
          (c) => digitsOnly(c.phone) === ph || digitsOnly(c.mobile) === ph
        )
      : undefined);
  if (strong) return { kind: "strong", customer: strong };
  return { kind: "weak", customer: candidates[0] };
}

interface BookingModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional — prefill customer / site (e.g. when opened from a site page). */
  presetCustomer?: Customer | null;
  presetSite?: Site | null;
  /** Q3 attach-to-draft mode: the draft job's id. When set, the modal
   *  UPGRADES this draft (UPDATE on the existing row) instead of creating
   *  a new job, and the title / CTA / prefill switch to upgrade semantics. */
  draftJobId?: string;
  /** Read-only context shown at the top in upgrade mode — the operator's
   *  original quick-capture phrase. Never written back (persists on the row). */
  presetCaptureNote?: string;
  /** Prefill the date from the draft (Q5). Create mode → today. */
  presetJobDate?: string;
  /** Prefill the arrival window from the draft (Q5). Create mode → blank. */
  presetWindow?: { start: string; end: string };
  /** Upgrade mode (Track 2 Half 2): the draft's captured caller name/phone.
   *  Used ONLY to DEFAULT + PREFILL the customer step on open (smart match);
   *  never written back as-is — the operator confirms the customer. */
  presetContactName?: string;
  presetContactPhone?: string;
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
  draftJobId,
  presetCaptureNote,
  presetJobDate,
  presetWindow,
  presetContactName,
  presetContactPhone,
}: BookingModalProps) {
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
  const [jobTimeEnd, setJobTimeEnd] = useState("");
  const [callType, setCallType] = useState("");
  const [value, setValue] = useState("");
  const [reportNotes, setReportNotes] = useState("");
  const [selectedPests, setSelectedPests] = useState<string[]>([]);

  // Client-side required-field validation. Offline, the server action that
  // normally returns field errors never runs (or fails as a network error),
  // so without this a missing required field is a silent no-op. Merged with
  // any server-returned errors for display.
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // Smart-match hint (Track 2 Half 2): a possible existing customer for the
  // captured contact, offered inline in "new" mode. Tapping it switches to
  // that customer instead of creating a duplicate.
  const [matchHint, setMatchHint] = useState<Customer | null>(null);

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
  // Meta closes over draftJobId, so rebuild it only when that changes
  // (wrap.ts requires a stable ref otherwise). The serverAction arg below
  // is UNUSED at submit: this modal is on the optimistic path
  // (localSuccessState set), so the server is reached only via the outbox
  // registry keyed by meta.actionName — never this direct ref. Kept as
  // createQuickBookingAction to avoid an extra import.
  const meta = useMemo(() => makeBookingMeta(draftJobId), [draftJobId]);
  const [state, action, isPending] = useLocalFirstAction<
    ActionState,
    BookingWrapInput
  >(createQuickBookingAction, initialState, meta, bookingLocalFirstOpts);

  /** When a customer has no sites but the customer record itself has an
   *  address, swing the form into "new site" mode and pre-fill it from
   *  the customer record. Saves the operator from re-typing what they
   *  already entered when adding the customer.
   *
   *  Declared above the effects that call it (the open-effect below and
   *  pickCustomer) so the reference is lexically valid — it's a hoisted
   *  function declaration, so this is purely a lexical-order tidy with no
   *  behaviour change. */
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

  // Reset state on every fresh open. The guard means re-renders while open
  // don't wipe the user's input.
  useEffect(() => {
    if (!open) {
      lastOpenRef.current = false;
      return;
    }
    if (lastOpenRef.current) return;
    lastOpenRef.current = true;

    // Reset-on-open: when the modal transitions closed→open we deliberately
    // reset every field to its default in this effect. It's guarded by
    // lastOpenRef so it runs exactly once per open — an intentional
    // synchronous reset, not the cascading-render pattern the rule targets.
    // (This warning was previously masked by the use-before-declare error
    // that the prefillSiteFromCustomer reorder just cleared.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomerMode("existing");
    setSiteMode("existing");
    setCustomerQuery("");
    setSelectedCustomer(presetCustomer ?? null);
    setSelectedSite(presetSite ?? null);
    setSites([]);
    setSelectedPests([]);
    setClientErrors({});
    setMatchHint(null);
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
    // Upgrade mode (Q5): hydrate date + arrival window from the draft so
    // the operator doesn't re-enter them. Create mode → today + blank.
    // call_type / pest_species stay blank in both (drafts carry neither).
    // (setJobTimeEnd here also fixes a latent create-mode bug: the end
    // time wasn't cleared on reopen, leaving a stale window.)
    setJobDate(presetJobDate ?? todayIso());
    setJobTime(presetWindow?.start ?? "");
    setJobTimeEnd(presetWindow?.end ?? "");
    setCallType("");
    setValue("");
    setReportNotes("");

    // Upgrade (attach-to-draft, Track 2 Half 2): the everyday trigger is a
    // usually-new caller, so DEFAULT to "new" and prefill from the captured
    // contact. Then run a smart local match (Dexie, offline): a clear match
    // switches to "existing" + preselect (no duplicate); a partial match is
    // offered as an inline hint; no match stays "new". Takes precedence over
    // the search-only / presetCustomer branches below.
    if (draftJobId && !presetCustomer) {
      setCustomerMode("new");
      setSiteMode("new");
      setNewCustomerName(presetContactName ?? "");
      setNewCustomerPhone(presetContactPhone ?? "");
      setCustomerResults([]);
      setLoadingCustomers(false);
      void matchCapturedContact(
        presetContactName ?? "",
        presetContactPhone ?? ""
      ).then(async (m) => {
        if (m.kind === "strong") {
          // Returning caller — switch to existing + preselect, don't duplicate.
          setCustomerMode("existing");
          setSelectedCustomer(m.customer);
          setSiteMode("existing");
          const list = await getSitesForCustomerLocal(m.customer.id);
          setSites(list);
          if (list.length > 0) setSelectedSite(list[0]);
          else prefillSiteFromCustomer(m.customer);
        } else if (m.kind === "weak") {
          setMatchHint(m.customer);
        }
        // none → stay "new" (prefilled), no hint.
      });
      return;
    }

    if (!presetCustomer) {
      // Search-only picker: no list until the user types (≥1 char). Just
      // clear any prior results and focus the box on open.
      setCustomerResults([]);
      setLoadingCustomers(false);
      setTimeout(() => customerInputRef.current?.focus(), 50);
    } else {
      setLoadingSites(true);
      void getSitesForCustomerLocal(presetCustomer.id).then((s) => {
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
  }, [
    open,
    presetCustomer,
    presetSite,
    presetJobDate,
    presetWindow,
    draftJobId,
    presetContactName,
    presetContactPhone,
  ]);

  // Close on successful submission — and that's it. The post-save NEVER
  // touches the network. router.refresh() used to live here, but it's the
  // wrong tool: on the FIRST offline booking serverReachable is still `true`
  // (it only flips false after a sync fails), so even a serverReachable-gated
  // refresh fired an offline RSC fetch → route error → "something went
  // wrong". A later booking skipped it (serverReachable now false) — that
  // page-dependence was the tell.
  //
  // We don't need a refresh: every place the new booking shows reads Dexie
  // via useLiveQuery (Jobs, Customers, the customer profile, the side panel,
  // the dashboard's Upcoming/Service-sheets sections) and updates the instant
  // applyLocal writes. Only the dashboard's server-rendered cards (e.g.
  // Revenue) wait until the next navigation — acceptable, and consistent with
  // the dashboard-stale decision. Keeping the save fully connectivity-
  // independent is the whole point of the optimistic redesign.
  useEffect(() => {
    if (!state.success) return;
    onClose();
  }, [state.success, onClose]);

  const runCustomerSearch = useCallback((v: string) => {
    setCustomerQuery(v);
    if (customerDebounceRef.current) {
      clearTimeout(customerDebounceRef.current);
    }
    // Search-only: an empty box shows no list (and skips the lookup).
    if (!v.trim()) {
      setCustomerResults([]);
      setLoadingCustomers(false);
      return;
    }
    customerDebounceRef.current = setTimeout(() => {
      setLoadingCustomers(true);
      void searchCustomersLocal(v).then((data) => {
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
    const list = await getSitesForCustomerLocal(c.id);
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

  // Required-field check — mirrors the server's Zod requirements (customer,
  // location, date, call type) so the operator gets the same gating offline
  // as online. Returns a field→message map; empty means valid.
  function validateBooking(): Record<string, string> {
    const errs: Record<string, string> = {};
    // Always required: a rough customer + a date.
    if (customerMode === "existing") {
      if (!selectedCustomer) errs.customer_id = "Choose a customer";
    } else if (!newCustomerName.trim()) {
      errs.customer_name = "Enter the customer's name";
    }
    if (!jobDate) errs.job_date = "Pick a date";
    // Site address + call type are required ONLY when upgrading a draft.
    // A normal booking is a quick add — name + date is enough (Pass 1);
    // a bare site is created server-side when no address is given.
    if (draftJobId) {
      if (siteMode === "existing") {
        if (!selectedSite) errs.site_id = "Add a location";
      } else {
        if (!newSiteLine1.trim()) errs.site_line1 = "Add an address";
        if (!newSiteTown.trim()) errs.site_town = "Add a town";
        if (!newSitePostcode.trim()) errs.site_postcode = "Add a postcode";
      }
      if (!callType) errs.call_type = "Choose a call type";
    }
    return errs;
  }

  // Validate before dispatching. On a missing required field, block the
  // submit and surface inline + summary errors — never a silent no-op (which
  // is what happened offline, when the server validation couldn't run).
  async function handleSubmit(formData: FormData) {
    const errs = validateBooking();
    if (Object.keys(errs).length > 0) {
      setClientErrors(errs);
      return;
    }
    // Q3c — offline-checkable clash guard (covers create AND upgrade).
    // Only an EXISTING site can clash; a brand-new site has no id yet, so
    // it's impossible. Block inline BEFORE the optimistic write so a
    // duplicate never becomes a stuck outbox entry. The conflict inbox
    // stays as the server-side backstop for the rare offline race.
    const resolvedSiteId =
      siteMode === "existing" ? selectedSite?.id ?? "" : "";
    if (resolvedSiteId && callType && jobDate) {
      const clash = await findClashingJobLocal(
        resolvedSiteId,
        jobDate,
        callType,
        draftJobId // exclude the draft's own row (upgrade mode)
      );
      if (clash) {
        setClientErrors({
          job_date:
            "There's already a job of this type for this site on this date.",
        });
        return;
      }
    }
    setClientErrors({});
    await action(formData);
  }

  if (!open) return null;

  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelClass = "block text-xs font-medium text-gray-600";

  // Server-returned errors (online) overlaid with client validation errors.
  const errors: Record<string, string> = { ...state.errors, ...clientErrors };
  const hasClientErrors = Object.keys(clientErrors).length > 0;

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
          <h2 className="text-base font-semibold text-gray-900">
            {draftJobId ? "Upgrade to booking" : "New Booking"}
          </h2>
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

        <form action={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* All values are now sent via controlled hidden inputs derived from
              state — that way a failed submit + re-submit doesn't wipe what
              the user typed. */}
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Upgrade mode: addresses the draft to UPDATE. Empty in create
              mode (the create action ignores it). replayArgs also injects
              it, so replay works even without this field. */}
          <input type="hidden" name="draft_job_id" value={draftJobId ?? ""} />
          {/* Read-only context (Q4): the operator's original quick-capture
              phrase, shown so they can read their own jotting while filling
              in the real customer/site. Never written back — it persists
              untouched on the upgraded row. */}
          {draftJobId && presetCaptureNote && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
              <span className="font-medium">From your note:</span>{" "}
              “{presetCaptureNote}”
            </div>
          )}
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
          <input type="hidden" name="job_time_end" value={jobTimeEnd} />
          <input type="hidden" name="call_type" value={callType} />
          <input type="hidden" name="value" value={value} />
          <input type="hidden" name="report_notes" value={reportNotes} />
          <input
            type="hidden"
            name="pest_species"
            value={JSON.stringify(selectedPests)}
          />

          {hasClientErrors && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              Please complete the highlighted fields.
            </div>
          )}
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
                    {/* Search-only: the results list appears only once the
                        operator types — an empty box shows nothing beneath. */}
                    {customerQuery.trim() && (
                    <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-gray-100">
                      {loadingCustomers ? (
                        <p className="px-3 py-4 text-center text-xs text-gray-400">
                          Searching…
                        </p>
                      ) : customerResults.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-gray-400">
                          No matches. Try “+ New” above.
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
                    )}
                    {errors.customer_id && (
                      <p className="mt-1 text-xs text-red-500">
                        {errors.customer_id}
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="mt-2">
                {/* Smart-match hint (Track 2 Half 2): the captured contact
                    partially matches an existing customer. Offer them inline
                    so a returning caller isn't duplicated — tapping switches
                    to that customer (existing mode, preselected). */}
                {matchHint && (
                  <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="min-w-0 text-xs text-amber-800">
                      Looks like an existing customer:{" "}
                      <span className="font-medium">{matchHint.name}</span>
                      {matchHint.company_name ? ` (${matchHint.company_name})` : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const c = matchHint;
                        setMatchHint(null);
                        setCustomerMode("existing");
                        void pickCustomer(c);
                      }}
                      className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
                    >
                      Use them
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  {errors.customer_name && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.customer_name}
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
                  {errors.customer_email && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.customer_email}
                    </p>
                  )}
                </div>
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
                {errors.site_id && (
                  <p className="mt-1 text-xs text-red-500">
                    {errors.site_id}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="bn-site_line1" className={labelClass}>
                    Address Line 1
                    {draftJobId && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    id="bn-site_line1"
                    type="text"
                    value={newSiteLine1}
                    onChange={(e) => setNewSiteLine1(e.target.value)}
                    placeholder="Street address"
                    className={inputClass}
                  />
                  {errors.site_line1 && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.site_line1}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="bn-site_town" className={labelClass}>
                    Town
                    {draftJobId && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    id="bn-site_town"
                    type="text"
                    value={newSiteTown}
                    onChange={(e) => setNewSiteTown(e.target.value)}
                    className={inputClass}
                  />
                  {errors.site_town && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.site_town}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="bn-site_postcode" className={labelClass}>
                    Postcode
                    {draftJobId && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    id="bn-site_postcode"
                    type="text"
                    value={newSitePostcode}
                    onChange={(e) => setNewSitePostcode(e.target.value)}
                    placeholder="e.g. SW1A 1AA"
                    className={inputClass}
                  />
                  {errors.site_postcode && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.site_postcode}
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
              <div className="sm:col-span-2">
                <label htmlFor="bn-job_date" className={labelClass}>
                  Date <span className="text-red-500">*</span>
                  <span className="ml-2 font-normal text-gray-400">
                    / Arrival window
                  </span>
                </label>
                <div className="mt-1">
                  <input
                    id="bn-job_date"
                    type="date"
                    value={jobDate}
                    onChange={(e) => setJobDate(e.target.value)}
                    required
                    className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand sm:max-w-xs"
                  />
                </div>
                {errors.job_date && (
                  <p className="mt-1 text-xs text-red-500">
                    {errors.job_date}
                  </p>
                )}
                <div className="mt-2">
                  <TimeWindowPicker
                    idPrefix="bn-window"
                    value={{ start: jobTime, end: jobTimeEnd }}
                    onChange={({ start, end }) => {
                      setJobTime(start);
                      setJobTimeEnd(end);
                    }}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="bn-call_type" className={labelClass}>
                  Call Type
                  {draftJobId && <span className="text-red-500"> *</span>}
                </label>
                <select
                  id="bn-call_type"
                  value={callType}
                  onChange={(e) => setCallType(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Not set</option>
                  {CALL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CALL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                {errors.call_type && (
                  <p className="mt-1 text-xs text-red-500">
                    {errors.call_type}
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
              {isPending
                ? "Saving…"
                : draftJobId
                  ? "Upgrade to booking"
                  : "Add Booking"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
