# Offline-first PWA conversion — Architecture Audit

Recon for converting GEM Services CRM to an offline-first PWA so field operators can work without signal. **No code changes have been made.** This document is reconnaissance only.

---

## 1. Project structure & package.json

**Framework**: Next.js **16.2.1** — App Router (the new file conventions, `app/` directory, server components by default). Confirmed by:

- `package.json` line 13: `"next": "16.2.1"`
- `app/` directory exists; no `pages/` directory
- Middleware file is **`proxy.ts`** at the repo root — Next 16's renamed convention (was `middleware.ts` in older versions)

**Language**: TypeScript strict. React 19.2.4.

**Top-level directory tree** (depth 3, ignoring node_modules/.next/.git/.claude/.vercel):

```
app/                          App Router
  (app)/                      Authenticated app shell (route group)
    agreements/  bookings/  calendar/  customers/  dashboard/
    invoices/    jobs/       reports/   reviews/    settings/  sites/
  (auth)/login/               Unauthenticated route group
  api/cron/  api/pdf/         Cron + PDF endpoints (only API routes)
  auth/callback/              Supabase OAuth/magic-link landing
components/                   ~44 client components grouped by feature
  agreements/  bookings/  calendar/  customers/  dashboard/
  invoices/    jobs/       reports/   settings/   sites/  ui/
lib/
  auth/        requireUser helper
  config/      env validation
  constants/   branding, routes, job-labels
  data/        14 Supabase query modules (server-side reads + writes)
  hooks/       useIsMobile
  pdf/         puppeteer + HTML templates
  services/    email (Resend), job-events, agreement-renewal
  storage/     base64 upload to Supabase Storage
  supabase/    4 clients (admin, browser, proxy, server)
  utils/       date/address/time formatters
  validation/  Zod schemas, one file per entity
public/        logo/ + robots.txt only
supabase/      setup.sql + 28 incremental migrations
types/         database.ts (hand-written row types)
```

**Notable dependencies** (`package.json`):

| Package | Version | Role |
|---|---|---|
| `next` | 16.2.1 | Framework |
| `react` / `react-dom` | 19.2.4 | UI runtime |
| `@supabase/ssr` | ^0.9.0 | SSR-aware Supabase client (cookie handling for App Router) |
| `@supabase/supabase-js` | ^2.100.1 | Underlying Supabase SDK |
| `zod` | ^4.3.6 | Form / API payload validation |
| `resend` | ^6.12.3 | Transactional email |
| `puppeteer-core` + `@sparticuz/chromium` | ^25 / ^148 | Serverless PDF rendering |
| `puppeteer` | ^25 (devDep) | Full puppeteer for local PDF dev |
| `tailwindcss` | ^4 | Styling |

**Notably absent**:
- No ORM (no Prisma, no Drizzle, no Kysely) — raw Supabase query builder everywhere.
- No form library (no React Hook Form, no Formik) — uses native `<form>` + React 19 `useActionState`.
- No client-side data fetching library (no SWR, no React Query, no axios).
- No state-management library (no Zustand, Redux, Jotai, Recoil).
- No existing PWA artefacts (no `manifest.json`, no `sw.ts`, no `next-pwa` / `@serwist/next`).

---

## 2. Database & ORM

**Database**: Supabase (Postgres + Auth + Storage). Project URL lives in `NEXT_PUBLIC_SUPABASE_URL`; region is `eu-central-1` (Frankfurt) — confirmed earlier by you, and the Vercel function region is matched to `fra1` in `vercel.json`.

**ORM**: **None.** All queries go through the Supabase JS client's query builder (`supabase.from('table').select(...)` / `.insert(...)` / `.update(...)`). Schema is maintained as raw SQL.

**Schema source of truth**: two files in sync:
- `supabase/setup.sql` — 554-line idempotent script that brings any DB up to current state. Every `create` is guarded with `if not exists`; triggers/policies use drop-then-create.
- `supabase/migrations/` — 28 incremental files (`001_...sql` through `028_...sql`), one per change.

**Type source of truth**: `types/database.ts` — 163 lines of hand-written TypeScript interfaces matching the row shapes Supabase returns. Not auto-generated. **This means schema drift between SQL and types is possible** — and there's a small example already: `Customer.address` is marked `@deprecated` because it was replaced by structured address columns in migration 026.

**Three Supabase client variants** in `lib/supabase/`:

| File | Lines | Role |
|---|---|---|
| `client.ts` | 1–7 | Browser client — `createBrowserClient` with cookies in `document.cookie` |
| `server.ts` | 1–28 | RSC / server-component client — reads cookies from `next/headers` |
| `proxy-client.ts` | 1–24 | Middleware client — reads/writes cookies on `NextRequest` / `NextResponse` |
| `admin.ts` | 1–37 | Service-role client (bypasses RLS) — used only for `auth.admin.inviteUserByEmail` |

**Full schema** is embedded in `supabase/setup.sql`. Summary of tables (all in the `public` schema):

```sql
customers           -- contact + structured address + customer_type
sites               -- per-customer service locations (1:N)
agreements          -- Pest Management Agreements (PMAs) — 1:1 with site
jobs                -- bookings + completed service sheets
tasks               -- to-do items (follow-ups, reviews, renewals)
reports             -- PDF outputs of service sheets
invoices            -- billing
daily_summaries     -- end-of-day totals (operator clicks "finish day")
feature_requests    -- in-app dev-feedback form
```

**Row-Level Security**: enabled on every table; the policy is `"Authenticated users full access" FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Single-tenant — every signed-in user can read/write everything.

---

## 3. Auth approach

**Provider**: Supabase Auth (email + password). No NextAuth / Auth.js / Clerk. Magic-link invites supported via `auth.admin.inviteUserByEmail` (Settings → Invite teammate, requires `SUPABASE_SERVICE_ROLE_KEY`).

**Library**: `@supabase/ssr@^0.9.0` — handles cookie-based session sync between SSR (RSC), middleware (proxy.ts), and the browser client.

**Session format**: JWT (Supabase issues a JWT access token + refresh token). Stored in HTTP cookies (`sb-<project>-auth-token` + companions) — Supabase's default cookie strategy via `@supabase/ssr`.

**Session lifetime**: Supabase defaults — access token TTL 1 hour, refresh token TTL 30 days, refresh sliding window. Refresh happens automatically via the SDK when a request comes in with a near-expired access token. Configurable in the Supabase dashboard (Authentication → Sessions).

**Middleware blocking** (CRITICAL for offline):

`proxy.ts` (lines 5–42):

```ts
export async function proxy(request: NextRequest) {
  const { supabase, response } = createProxyClient(request);
  const { pathname } = request.nextUrl;

  const { data: { user } } = await supabase.auth.getUser();   // ← NETWORK CALL

  if (!user && pathname !== ROUTES.LOGIN) {
    // …redirect to /login
  }
  …
}
```

The middleware calls `supabase.auth.getUser()` on every request. `getUser()` makes a **network round-trip to Supabase Auth servers** to validate the JWT. If offline, this fails — and the current code has no fallback, so the user gets redirected to `/login` (or sees a hang). **This is the single biggest auth-offline issue to fix.**

`requireUser()` in `lib/auth/require-user.ts` was recently changed to use `getSession()` (cookie-only, no network) — so server actions are already offline-tolerant for auth. But the proxy still uses `getUser()`.

The proxy matcher (line 50) excludes `_next/static`, `_next/image`, `favicon.ico`, `icon.png`, `logo/`, and `auth/callback` — but every app route runs through it.

---

## 4. Entity inventory

All schemas live in `supabase/setup.sql` with types mirrored in `types/database.ts`. All tables have:

- **IDs**: `uuid primary key default gen_random_uuid()` — server-generated by Postgres on insert
- **Timestamps**: `created_at timestamptz not null default now()` + `updated_at timestamptz not null default now()`
- **`updated_at` trigger**: every table has a `trg_*_updated_at` trigger (lines 118–129 of setup.sql) that fires `set_updated_at()` on every UPDATE, so `updated_at` is **always bumped** — even by code paths that don't explicitly touch it.
- **No `deleted_at`** anywhere. Hard delete via cascade. (`is_archived boolean` exists on customers/sites/jobs/agreements/tasks via migration 005, but it's a soft-hide flag, not a sync deletion marker.)

### Entities and their fields

#### `customers` — `setup.sql:19–27`, types `database.ts:6–31`
Primary fields: `name`, `company_name`, `email`, `phone`, `mobile`, `position`, `website`, `notes`, `customer_type` ('commercial'|'domestic'), `annual_contract_value`, `google_review_received`, `review_request_snoozed_until`, `review_email_sent_at`, structured address (`address_line_1`, `address_line_2`, `town`, `county`, `postcode`), legacy `address` (deprecated), `is_archived`.

No FKs (root entity).

#### `sites` — `setup.sql:29–39`, types `database.ts:33–43`
Per-customer service locations. Fields: `address_line_1`, `address_line_2`, `town`, `county`, `postcode`, `is_archived`.

FK: `customer_id → customers(id) ON DELETE CASCADE`.

#### `agreements` — `setup.sql:41–53`, types `database.ts:108–133`
PMAs. Fields: `start_date`, `end_date`, `contract_value`, `visit_frequency`, `pest_species[]`, `callout_terms`, `status` ('active'|'paused'|'cancelled'), `reference_number`, `mobile`, contact/signature/PDF fields, `is_archived`.

FKs: `customer_id → customers(id) ON DELETE CASCADE`, `site_id → sites(id) ON DELETE CASCADE`.

#### `jobs` — `setup.sql:55–73`, types `database.ts:49–83`
Bookings + completed service sheets. Fields: `job_date`, `job_time`, `call_type` ('routine'|'callout'|'followup'|'survey'|'other'), `pest_species[]`, `findings`, `recommendations`, `treatment`, `pesticides_used`, `risk_level`, `risk_comments`, `technician_signature_url`, `client_signature_url`, `job_status` ('scheduled'|'in_progress'|'completed'), `environmental_*`, `method_used[]`, `photo_urls[]`, `client_present`, `client_name`, `report_notes`, `value`, `is_invoiced`, `is_paid`, `reference_number`, `parent_job_id` (self-FK for follow-ups), `is_archived`.

FKs: `site_id → sites(id) ON DELETE CASCADE`, `agreement_id → agreements(id) ON DELETE SET NULL`, `parent_job_id → jobs(id) ON DELETE SET NULL`.

**Unique constraint** that affects sync (line 177–179):
```sql
create unique index idx_jobs_site_date_unique
  on jobs (site_id, job_date, call_type)
  where (is_archived = false AND agreement_id IS NULL);
```
Two offline writes for the same (site, date, call_type) would collide on sync. Need to handle this conflict.

#### `tasks` — `setup.sql:75–86`, types `database.ts:139–154`
`title`, `due_date`, `status`, `task_type`, `priority`, `priority_order`, `completed_at`, `is_archived`.

FKs (all `ON DELETE SET NULL`): `related_job_id`, `related_customer_id`, `agreement_id`, `site_id`.

#### `reports` — `setup.sql:88–95`, types `database.ts:156–163`
`report_type`, `pdf_url`. FK: `job_id → jobs(id) ON DELETE CASCADE`.

#### `invoices` — `setup.sql:282–292`, types `database.ts:87–104`
`amount`, `status` ('draft'|'sent'|'paid'), `issued_at`, `paid_at`, `invoice_number`, `description`, `due_date`, `pdf_url`, `subtotal_amount`, `vat_amount`, `vat_rate`.

FKs: `job_id → jobs(id) ON DELETE CASCADE`, `customer_id → customers(id) ON DELETE CASCADE`.

**Unique constraint** (line 349):
```sql
create unique index invoices_invoice_number_unique
  on invoices (invoice_number) where invoice_number is not null;
```
Plus a sequence `invoice_number_seq` for generating server-side numbers (`INV-YYYY-NNNN`) — meaning offline insert can't know the next invoice number. **Either generate offline as a temp string and renumber on sync, or accept that invoices can only be created online.**

#### `daily_summaries` — `setup.sql:185–191`
Operator's "finish day" pushes an aggregate. `summary_date` (date, unique), `jobs_completed`, `tasks_completed`. **No `updated_at` here** — only `created_at`.

#### `feature_requests` — `setup.sql:372–382`
Dev feedback inbox. `request_type`, `message`, `status`, `submitter_email`. **No `updated_at` here either.**

---

## 5. API surface

### API routes — only **3 in the entire app**

| Route | File | Method | Purpose |
|---|---|---|---|
| `/api/cron/review-sends` | `app/api/cron/review-sends/route.ts` | GET | Vercel cron worker — sends pending domestic review-request emails. Auth via `Authorization: Bearer ${CRON_SECRET}`. |
| `/api/pdf/job/[id]` | `app/api/pdf/job/[id]/route.ts` | GET | Renders + streams a service-report PDF (puppeteer). |
| `/api/pdf/agreement/[id]` | `app/api/pdf/agreement/[id]/route.ts` | GET | Renders + streams a PMA PDF (puppeteer). |

All three return JSON or PDF buffers. No client-generated-ID expectations (the IDs in URL params are server-generated UUIDs).

### Server actions — **14 files, 33 exported functions**

Every write operation goes through a server action — there are **zero API routes for writes**. List below is grouped by file (all under `app/(app)/.../actions.ts`):

| File | Actions | Operates on |
|---|---|---|
| `customers/actions.ts` | 6 | createCustomerAction, getCustomerDetailAction, setReviewReceivedAction, getDeleteImpactAction, deleteCustomerAction, setCustomerTypeAction |
| `customers/[id]/sites/actions.ts` | 1 | createSiteAction |
| `bookings/actions.ts` | 3 | createQuickBookingAction, searchCustomersAction, getSitesForCustomerAction |
| `sites/[id]/bookings/actions.ts` | 1 | createBookingAction |
| `sites/[id]/agreements/actions.ts` | 1 | createAgreementAction |
| `agreements/[id]/actions.ts` | 1 | updateAgreementStatusAction |
| `jobs/[id]/actions.ts` | 1 | updateJobStatusAction |
| `jobs/[id]/complete/actions.ts` | 2 | completeServiceSheetAction, approveServiceSheetAction |
| `jobs/[id]/report/actions.ts` | 1 | generateReportAction |
| `invoices/actions.ts` | 4 | createInvoiceDraftAction, markInvoicePaidAction, sendInvoiceFollowUpAction, sendInvoiceAction |
| `reviews/actions.ts` | 2 | snoozeReviewAction, markReviewReceivedAction |
| `dashboard/actions.ts` | 3 | completeTaskAction, bulkCompleteTasksAction, finishDayAction |
| `dashboard/review-actions.ts` | 2 | sendReviewSMSAction, sendReviewEmailAction |
| `settings/actions.ts` | 5 | runRenewalCheckAction, finishDayAction, submitFeatureRequestAction, changePasswordAction, inviteUserAction |

All call `await requireUser()` at the top — defence-in-depth on top of the proxy auth check.

---

## 6. Data-fetching pattern

**One single consistent pattern**:

- **Reads**: React Server Components import functions from `lib/data/*.ts` (14 modules), each of which calls `await createClient()` from `lib/supabase/server.ts` and runs Supabase queries. Data lands in props for client components below.
- **Writes**: client components dispatch a server action via `<form action={action}>` + `useActionState`.

Confirmed by grep:
- `grep "fetch(" components/ app/` → **zero results** in client code
- `grep "useQuery\|useSWR\|axios"` → **zero results**
- `grep "supabase.channel\|.on('postgres"` → **zero results** (no realtime subscriptions)
- 44 client components total; **none of them fetch data themselves**

Implications for offline:
- The "data flow into UI" path is entirely server-rendered. Without a service worker, an offline user gets a blank page (RSC payload can't be regenerated).
- The good news: only one shape to teach about reading locally — `lib/data/*.ts`. Wrap or shadow these with local-first variants and most of the UI keeps working unchanged.

---

## 7. Photo handling

**Storage backend**: Supabase Storage, bucket `reports` (public bucket — emailed PDF links work without signed URLs). Bucket created in `setup.sql:497–500`.

**Upload pattern**:

1. `components/ui/photo-upload.tsx` — client component. Reads each file as a base64 data-URL via `FileReader.readAsDataURL`. Caps: 8 MB per file, 10 files max, accepts `jpeg/png/webp/heic/heif`. Pushes the array of data-URLs up to the parent via `onChange`.
2. Parent form submits the array as part of FormData (the data-URLs are strings).
3. The server action (e.g. `completeServiceSheetAction`) calls `uploadBase64Image(dataUrl, path)` from `lib/storage/upload.ts`, which decodes the base64, calls `supabase.storage.from('reports').upload(...)`, and returns the public URL.
4. The URL is then written into the row (`jobs.photo_urls[]`, `jobs.technician_signature_url`, etc).

**Metadata**: only the storage path — e.g. `reports/${jobId}/${Date.now()}.png`. No EXIF preservation, no captured-at timestamp on the storage object itself. The `created_at` on the parent row is the closest proxy.

**Notable**: signatures (technician + client) use the same base64-data-URL pattern via `components/ui/signature-pad.tsx`. PDFs are also uploaded via the same `lib/storage/upload.ts > uploadPdf`.

---

## 8. Forms & validation

**Form library**: **none** — native `<form>` + React 19's `useActionState`. Every form follows the same pattern:

```tsx
const [state, action, isPending] = useActionState(someServerAction, INITIAL_STATE);
return <form action={action}>…</form>;
```

`state` carries `{ success, errors, message }`; per-field errors are rendered below each input. Representative example: `components/customers/add-customer-form.tsx:40–55`.

**Validation library**: **Zod 4.3** (`zod` in `package.json`). Schemas live in `lib/validation/`:

```
agreement.ts   booking.ts   customer.ts   site.ts
service-sheet.ts            account.ts
```

Pattern: server action receives `FormData`, builds a `raw` object via `formData.get()`, runs `SomeSchema.safeParse(raw)`, returns field errors on failure or proceeds on success. All validation is server-side; the browser only enforces `required` / `type=email` / `pattern` HTML attributes.

**Submit target**: server actions exclusively. No `fetch('/api/…')` POSTs from any form.

---

## 9. State management

**None.** No Zustand, Redux, Jotai, Recoil, Valtio. No React Context providers anywhere (`grep "createContext"` returns zero hits in `components/` or `app/`).

The only client-side persistent state is **localStorage**, used in two places:

- `components/dashboard/widget-frame.tsx` — per-widget hidden/minimised state (`gemcrm-dashboard-widgets-v1` key)
- `components/dashboard/dashboard-grid.tsx` — widget DnD order (`gemcrm-dashboard-widget-order-v1`)

Each uses a small singleton store with a listener set — a tiny custom hook (`useWidgetStore`). Pattern is similar to what we'd do for offline metadata.

---

# Architecture answers

## Q1 — Service worker library

**`@serwist/next@9.x`** is the most actively-maintained Next.js-aware service worker generator. The latest 9.x releases explicitly support Next 15 App Router; **Next 16 support is unverified from this audit alone** — I'd want to check Serwist's release notes / open an issue before committing. The Next 16 internals around `proxy.ts` (renamed from middleware) and the new build pipeline could affect SW injection.

**Alternatives if `@serwist/next` doesn't work on Next 16**:
- **Workbox directly** (`workbox-build` + a hand-written `sw.ts`) — more boilerplate but framework-agnostic. Next 16 has no opinion about a static `/sw.js` served from `/public`.
- **Next-PWA** (`next-pwa`) — older, maintenance-mode; Pages Router heritage; unlikely to support Next 16 cleanly.

**My recommendation**: Try `@serwist/next` first. If it doesn't install/build against Next 16, fall back to a hand-written `sw.ts` registered via a `<Script>` tag in `app/layout.tsx` — that's ~50 extra lines and avoids any framework-coupling risk.

**Existing PWA artefacts**: **none**. No `manifest.json`, no `sw.ts`, no `next-pwa` config. Greenfield.

---

## Q2 — Schema mirroring strategy

**Hand-written.** There's no Prisma / Drizzle / Kysely schema to generate from — the source of truth is raw SQL (`supabase/setup.sql`) with hand-written TypeScript interfaces in `types/database.ts`.

Lowest-risk path:
- Mirror `types/database.ts` into an IndexedDB schema (likely Dexie). Same names, same nullable shapes.
- Skip the tables that don't need to be available offline: `feature_requests`, `daily_summaries`, `reports` (PDF URLs only useful when online anyway).
- For tables that go offline: add the offline-sync metadata columns the client-side store needs (`_pending`, `_op`, `_dirty_at`, `_synced_at` — exact shape decided in the design phase).

We could later auto-generate types via Supabase's CLI (`supabase gen types typescript`) — that would lock the TS types to the live DB schema and eliminate the drift risk we already have (e.g. `Customer.address` marked `@deprecated`). But that's an orthogonal improvement and shouldn't block this work.

---

## Q3 — ID strategy

**All entities already use UUIDs** (`uuid primary key default gen_random_uuid()`). No integer autoincrement anywhere.

**Current issue for offline**: even though the column type is right, IDs are **generated by Postgres on insert**, not by the client. So an offline write can't know its own ID until sync completes. That makes referential writes ugly (you'd insert a job with `site_id: <local-temp-id>` and have to fix up later).

**Migration cost**: trivial. Change two things:
1. Switch every `insert()` call in `lib/data/*.ts` to generate the ID client-side with `crypto.randomUUID()` and pass it in the insert payload. Postgres accepts whatever UUID you give it; the `default gen_random_uuid()` only fires when you don't.
2. Ensure all the client-side write paths have access to `crypto.randomUUID()` — they do (universal in browsers + Node 19+).

**Backfill / existing data**: zero. Existing rows already have valid UUIDs; nothing changes for them.

This is a ~30-minute refactor across the 14 `lib/data/*.ts` insert call sites and the handful of server actions that do their own inserts.

---

## Q4 — Timestamp columns

**Every syncable table has `updated_at`**:
- `customers`, `sites`, `agreements`, `jobs`, `tasks`, `reports`, `invoices` — all have `updated_at timestamptz not null default now()` plus a `trg_*_updated_at` trigger (defined in `setup.sql:118–129`) that fires `set_updated_at()` on EVERY UPDATE.

That means **every code path that updates a row bumps `updated_at` automatically** — even the bare `.update({ status })` calls in `lib/data/agreements.ts:249` and similar. No code-side discipline required.

**Tables without `updated_at`** (informational):
- `daily_summaries` — only `created_at` (upsert by date, no edit pattern).
- `feature_requests` — only `created_at` (write-once).

Neither needs to sync from device — both are append-only or operator-driven server-side.

---

## Q5 — Soft deletes

**No `deleted_at` anywhere.** Deletes are hard via cascade. (`customers` → cascades to sites → cascades to jobs/agreements → cascades to invoices/reports.)

**`is_archived boolean`** does exist on customers, sites, jobs, agreements, tasks (added in migration 005). It's currently used as a soft-hide flag in queries (e.g. `.eq("is_archived", false)`) but not as a deletion marker.

**Recommendation** for offline sync:
- Add `deleted_at timestamptz` to the five syncable entities (customers, sites, jobs, agreements, tasks). Hard deletes become soft from the device's perspective; a server-side cleanup task (cron) can hard-delete archived/deleted rows older than N days if disk space matters.
- Don't repurpose `is_archived` — it's a UX flag for "hidden from default lists", semantically different from "deleted".

Migration cost: one new migration (`029_soft_delete_columns.sql`) plus updating each `.delete()` call site (~5 places) to instead do `.update({ deleted_at: new Date().toISOString() })`. Read queries pick up a `.is("deleted_at", null)` filter.

---

## Q6 — Auth offline

**The current `proxy.ts` will redirect an offline user to /login.**

`proxy.ts:9–11` calls `supabase.auth.getUser()`, which is a network call to Supabase Auth servers to validate the JWT. With no signal:
- Best case: the call fails fast, `user` is null, redirect to `/login` fires.
- Worst case: the call hangs until the proxy timeout, the user sees a blank or error page.

Either way the PWA is unusable offline.

**Minimum change**: swap `getUser()` for `getSession()` in `proxy.ts`. `getSession()` reads from the cookie locally — no network, near-instant. The JWT still needs validating eventually, but:
- The cookie carries the JWT directly; the SDK can decode it to find `exp` (expiry) without contacting Supabase.
- If the access token has expired, we attempt refresh; if refresh fails (offline), trust the cached JWT one more time and let the user through (degrade gracefully).

This mirrors the change already made to `requireUser()` in `lib/auth/require-user.ts` — that uses `getSession()` for exactly the same reason. The proxy was left on `getUser()` because it's the *outer* layer (one fresh-validation per request was cheap insurance against a misconfigured cookie). For offline-first, we need to move that fresh validation to the server actions only.

**Session lifetime headroom**: Supabase access tokens default to 1 hour; refresh tokens default to 30 days. As long as the user signs in within ~30 days, the refresh token will be in their cookie and we can sustain offline use through the 1-hour access token window. Refresh requires a network — so a >1-hour offline period with an expired access token would force the user to operate from the locally-cached JWT without rotation. Acceptable for the use case (~half-day in the van), risky for weeks of disconnection.

---

## Q7 — Server actions vs API routes

**This is the second-biggest architectural change** after auth.

Current state: **all 33 writes are server actions**, **zero are API routes**. Server actions need a live network round-trip — the browser POSTs encoded `FormData` to `/_next/data-action` (or the action handler endpoint), waits for the response, then the action runs server-side and returns. There's no way for a service worker to intercept and queue a server-action call cleanly because the route is generated by Next's build system and the action body lives only on the server.

**Three viable patterns** (in increasing effort, increasing cleanness):

**A. Reroute every write through API routes.**
Convert each server action into an API route (`POST /api/customers`, `POST /api/jobs`, etc). The form submits via `fetch('/api/...')`. The service worker intercepts on network failure, stuffs the payload into IndexedDB outbox, replays when online. This is the "textbook" PWA write pattern.
*Cost*: every form (~14 files) and every server action (~33 functions) refactored. Lots of mechanical work.

**B. Keep server actions for online writes, add a parallel local-first write path for offline.**
Forms write to the local IndexedDB store first (always). A sync worker (running in a service worker or in the foreground tab) reads the outbox and calls the existing server actions when online. Server actions stay as-is; we add a thin wrapper that decides "local-first or call action directly".
*Cost*: build the outbox + sync worker; instrument each form to write locally first (one new helper).

**C. Hybrid: API routes for things that must work offline, server actions for things that don't.**
"Must work offline" = creating bookings, completing service sheets, uploading photos, marking tasks done. "Doesn't need to work offline" = settings, password change, invite user, PDF generation, invoice send. Convert ~10 of the 33 actions to API routes.
*Cost*: middle ground.

**My recommendation: B**. The server actions are working well; converting them to API routes just to satisfy the PWA shape is throwing away ergonomics. The outbox-then-replay pattern is cleaner and means the existing actions become the "sync transport" automatically.

---

## Q8 — Photo storage migration

**Current pattern**: photos read as base64 in the browser → submitted as part of FormData strings → server action decodes + uploads to Supabase Storage → URL written to the row. See `lib/storage/upload.ts:5–28`.

**For offline**: the base64 data-URL pattern is actually *perfect* for offline. We already have the photo data in memory; we just stash it in IndexedDB (with the parent row) instead of submitting immediately. When sync runs:
1. Browser Supabase client (`lib/supabase/client.ts` — already exists) can call `supabase.storage.from('reports').upload(path, blob, { contentType })` directly from the device — no server round-trip needed for the upload itself.
2. Once the storage upload succeeds, the row gets `photo_urls: [<publicUrl>]` and gets pushed via the regular sync queue.

**Changes required**:
- Add a parallel `uploadBase64ImageFromBrowser` helper in `lib/storage/upload-client.ts` that uses the browser Supabase client.
- Sync worker calls it before pushing the row insert.
- Storage RLS policies need to allow `authenticated` users to upload to the `reports` bucket from the browser. Currently they're set this way (`setup.sql:506–510`: `for insert to authenticated with check (bucket_id = 'reports')`) — already works.

**Signed upload URLs not required** — the bucket is public and write access is gated by the Supabase auth cookie. Photos will upload from the device directly.

**Caveat**: signatures (`technician_signature_url`, `client_signature_url`) use the same base64 pattern and need the same treatment. Same fix applies — they're just smaller payloads.

---

## Q9 — Bundle size

**Current bundle** (from the last `next build`):

- Total static output: **~1.8 MB** in `.next/static/`
- Largest individual chunks: **264 KB, 227 KB, 197 KB, 144 KB** (these are obfuscated names — likely the React runtime, Tailwind, the Supabase SDK, and the booking modal which is the heaviest single client file)

**Trimming candidates I'd look at while adding offline tooling**:

- `@supabase/supabase-js` is ~80 KB gzipped — already in the bundle, unavoidable.
- `@supabase/ssr` is ~10 KB gzipped — necessary.
- `zod` is ~13 KB gzipped — necessary, used in client validation chains.
- **No heavy avoidable deps spotted.** No moment.js, no lodash, no charting library, no rich text editor. The bundle is lean.

**Adding for offline** (rough estimates, gzipped):
- `dexie` (IndexedDB wrapper) — ~35 KB
- `@serwist/next` or Workbox — ~25–35 KB
- Internal sync engine code — ~5–10 KB

**Total addition: ~70–80 KB gzipped.** Acceptable on top of the current bundle. Nothing in the current bundle is screaming "trim me" — the addition will sit on top, not displace.

---

## Q10 — Other concerns

Things I noticed during the audit that will make the conversion harder, easier, or just need calling out:

### 🟠 Server-action redirects after success
Most action files end with `redirect(ROUTES.CUSTOMERS)` (or similar) after a successful write. Offline, there's no fresh server-rendered destination to redirect to. The redirected URL will either:
- Hit the cached version (fine, but data the user just wrote isn't visible)
- Fail to load (worse)

**Plan**: client-side optimistic navigation after a local-first write. The Next router's `router.push()` followed by reading from the local store. Server-action redirects become "redirect on online replay, route-push on offline write".

### 🟠 PDF generation is server-only
`/api/pdf/job/[id]` and `/api/pdf/agreement/[id]` use puppeteer/chromium serverlessly. Cannot run in the browser. Offline = no PDF preview, no PDF download.

**Plan**: queue PDF-generation requests in the sync engine. The PDF preview pages (`reports` tab, agreement detail) need a "PDF queued — available when you're back online" state. The service report can still be filled out and stored offline; the PDF gets generated when the row syncs and Vercel processes the queued request.

### 🟠 Server-rendered detail pages have no client equivalent
Pages like `/customers/[id]`, `/sites/[id]`, `/jobs/[id]` are RSCs that fetch on render. Offline = the SW can serve a cached HTML snapshot, but only of the *last URL the user visited* — not arbitrary deep links. If the operator hasn't viewed a specific customer recently, the page won't render offline.

**Plan**: aggressive precaching — when sites/jobs/customers data syncs down on app open, pre-render or pre-cache the most likely-visited pages (e.g. all sites for today's jobs). Or — bigger move — convert the detail pages to client components that read from IndexedDB, so they render whatever data exists locally.

### 🟢 No realtime subscriptions
`grep "supabase.channel"` returns zero. No live-update wiring to refactor. Sync can be entirely pull-based / on-replay.

### 🟢 No global state, no Context, no Redux
Every component reads from props or its own local state. Means we can introduce IndexedDB-as-data-source incrementally — wrap one screen at a time, no global refactor.

### 🟠 Cron-only data: review_email_sent_at
`processDomesticReviewSends()` runs on a Vercel cron and updates `customers.review_email_sent_at`. If the device's locally-cached customers list lags, the operator might see an old "send review" prompt. Sync will catch up on next pull; live UI mismatch is minor.

### 🟠 Hard delete + cascade
A customer delete cascades to sites/jobs/agreements/invoices. Offline-then-online delete via the outbox would replay this cascade server-side — fine *if* the customer hasn't been edited locally elsewhere in the meantime. Two clients deleting the same customer = no conflict. One client deleting + one client adding a child row = lost child row. Probably acceptable for a small team but worth a one-liner in the UX (a 5-second undo toast).

### 🟠 `jobs` unique constraint on (site_id, job_date, call_type)
Two offline writes to schedule a "routine" job at the same site on the same date will collide on sync. Need a conflict handler that surfaces this to the operator (rare in practice — same operator, same calendar — but possible if two operators were ever using the app).

### 🟠 Invoice numbers use a Postgres sequence
`INV-YYYY-NNNN` numbers come from `nextval('invoice_number_seq')`. Cannot be assigned offline. **Either**: don't allow invoice creation offline (acceptable — invoicing is desk work, not field work). **Or**: assign a temp `DRAFT-<uuid-suffix>` locally, swap to a real number on sync.

### 🟢 Photos are already client-readable + storage is browser-uploadable
The infrastructure for client-direct uploads to Supabase Storage already exists (the `lib/supabase/client.ts` browser client + the public `reports` bucket with `authenticated` write policy). No new bucket configuration, no signed-URL infra to build.

### 🟢 Migrations are idempotent
`supabase/setup.sql` is already safe to re-run. Adding `deleted_at` columns or any other offline-support schema changes can ship as a new numbered migration without affecting existing data.

---

# Summary of changes the conversion implies

Ordered roughly by "must-fix to make offline work" → "polish":

1. **Auth**: switch `proxy.ts` from `getUser()` to `getSession()` so offline users with valid cookies stay signed in.
2. **IDs**: generate UUIDs client-side on insert, not server-side.
3. **Soft deletes**: add `deleted_at` to the 5 syncable entities.
4. **Local store**: introduce Dexie + a schema mirror for customers, sites, jobs, agreements, tasks (skip reports/invoices/feature-requests/daily-summaries — desk-only).
5. **Sync engine**: outbox table in IndexedDB; foreground worker drains it through the existing server actions when online.
6. **Service worker**: precache app shell + static assets; serve cached HTML for visited routes; route `/api/*` POSTs through the outbox on network failure.
7. **Client-side reads**: convert the field-critical detail pages (jobs/[id], jobs/[id]/complete, customer side panel) to read from IndexedDB instead of RSC.
8. **Manifest + install prompt**: `manifest.json`, app icons, "Add to Home Screen".
9. **PDF queueing**: explicit "PDF will be generated when you're online" UI on the few screens that show PDFs.
10. **Conflict surface**: simple "couldn't sync this — review and retry" inbox if any writes fail.

The audit suggests this is **a meaningful refactor but not a rewrite** — the code shape is already favourable (single read pattern, single write pattern, no state libs to displace, UUID-ready schema, public Storage with browser-writable policies). The biggest *new* thing to build is the outbox + sync worker; everything else is targeted edits to existing files.

I'd estimate **2–3 weeks of focused work** for a usable PWA with offline create/edit on the core entities, deferring the trickier bits (PDF queueing, conflict UI polish, invoice number generation offline).

---

**Audit ends here. No code has been modified. Awaiting your review before any implementation.**
