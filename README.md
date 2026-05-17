# GEM Services CRM

A pest-control CRM built for GEM Services. Bookings, service sheets, agreements (PMAs), invoices and review-chasing in a single phone-first app. Built by [Business Sorted Kent](mailto:hello@businesssortedkent.co.uk).

**Stack**

- Next.js 16 (App Router) + React 19
- Supabase (Postgres + Auth + Storage)
- Tailwind CSS v4
- Resend (transactional email)
- Puppeteer (`@sparticuz/chromium` on Vercel; full `puppeteer` for local dev) for PDF generation
- TypeScript strict, Zod validation, no UI framework
- Deployment target: Vercel

---

## Quick start (local development)

You need: Node 20+, npm, a Supabase project.

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env.local
# Edit .env.local — see "Environment variables" below.

# 3. Initialise the database
# In Supabase SQL editor, paste the contents of supabase/setup.sql
# and run. The script is idempotent — safe to re-run.

# 4. Create a user
# In the Supabase dashboard: Authentication → Users → "Add user".
# Email/password auth; no signup flow is exposed in the app.

# 5. Run the dev server
npm run dev    # → http://localhost:3000
```

You can run the app without `RESEND_API_KEY` — emails will log to console instead of sending. Useful for local dev. Set it in production.

---

## Environment variables

See `.env.example` for the full list and inline notes. Required in production:

| Var | Source | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Safe to expose to browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Safe to expose; RLS enforces auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` | **Server-only — never expose.** Required for Settings → Invite teammate. |
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys | Used by `lib/services/email.ts`. Missing → emails log to console. |
| `RESEND_FROM_EMAIL` | Must be a verified Resend sender | Format: `"GEM Services <nate@gemservices.uk>"`. |
| `CRON_SECRET` | Generated: `openssl rand -hex 32` | Protects `/api/cron/*` endpoints. Vercel cron sends this automatically as `Authorization: Bearer`. |

Optional:

| Var | Default | Notes |
|---|---|---|
| `REVIEW_LINK_URL` | hardcoded Google review URL in `lib/constants/branding.ts` | Override if you change Google Business listing. |

---

## Deploying to Vercel

1. **Push the repo to GitHub / GitLab / Bitbucket.**
2. In Vercel, **Import Project** and point it at the repo.
3. **Add all production env vars** from the table above to Vercel → Settings → Environment Variables (Production scope at minimum; ideally Preview too).
4. Vercel detects the Next.js framework and uses the default build settings — no overrides needed. `next.config.ts` already lists puppeteer/chromium under `serverExternalPackages` so the function bundle stays under the 50 MB cap.
5. **First deploy** triggers automatically. Confirm:
   - Login at `/` redirects you to `/login`.
   - After signing in, the dashboard loads.
   - Service-sheet completion generates a PDF (proves puppeteer works on serverless).
   - Submitting a feature request from Settings sends an email to the support address (proves Resend is wired).
6. **Verify the cron job** at Vercel → Project → Settings → Cron Jobs. `/api/cron/review-sends` runs at 09:00 UTC daily — sends review-request emails to domestic customers whose visit completed yesterday.

---

## Project layout

```
app/
  (app)/         # Authenticated app shell — dashboard, customers, jobs, etc.
  (auth)/        # Login (the only unauthenticated page).
  api/cron/      # Vercel cron endpoints (review-sends).
  global-error.tsx, not-found.tsx, error.tsx
components/      # React components grouped by feature.
lib/
  auth/          # `requireUser()` — call at the top of every server action.
  constants/     # branding, routes, job-labels, agreement-terms.
  data/          # Supabase query functions, one file per table area.
  hooks/         # Client hooks (useIsMobile).
  pdf/           # html-to-pdf + invoice/agreement/report templates.
  services/      # email (Resend), agreement-events, job-events, etc.
  storage/       # base64 upload helpers.
  supabase/      # SSR + browser + middleware Supabase clients.
  utils/         # format-address, format-time, today-uk.
  validation/    # Zod schemas per entity.
proxy.ts         # Next 16's renamed middleware — auth redirect.
supabase/
  setup.sql            # Idempotent full schema. Run once on fresh DB.
  migrations/*.sql     # Numbered incremental migrations (001 → 027).
  bucket-only.sql      # Storage bucket + policies only.
types/database.ts      # Row types matching the Supabase schema.
vercel.json            # Cron schedule.
```

---

## Operational notes

### Email

All outbound mail goes through `sendEmail()` in `lib/services/email.ts`. If you swap Resend for another provider, change only that file — invoice / agreement / service-report / review templates and helpers all delegate to it.

If `RESEND_API_KEY` is unset the call returns success and logs a one-line digest to console. That keeps dev flows testable without an account, but means **production must have the key** for customers to actually receive mail.

### PDFs

`lib/pdf/html-to-pdf.ts` auto-detects the environment:

- On Vercel (`process.env.VERCEL === "1"`): uses `puppeteer-core` + `@sparticuz/chromium`.
- Locally: uses the full `puppeteer` package (devDependency) which ships its own Chromium.

Both packages are listed in `next.config.ts > serverExternalPackages` so they aren't bundled into the function output — they're loaded dynamically from `node_modules` at runtime.

### Timezones

Server runs UTC on Vercel; the operator is in the UK. Anywhere you need "today" use `todayUk()` from `lib/utils/today-uk.ts`, not `new Date().toISOString().split("T")[0]` — the latter returns yesterday for UK users in the early morning hours.

### Auth

`proxy.ts` redirects unauthenticated visitors to `/login` for everything except auth callbacks + brand assets. Every server action additionally calls `await requireUser()` as defence in depth — if proxy is ever misconfigured, actions still refuse to run.

`requireUser()` reads the session from the request cookie (no network call). Validation of the JWT happens once per request inside `proxy.ts` via `supabase.auth.getUser()` — the second check would be a wasted ~150-300ms round-trip to Supabase.

RLS policies on every table are "Authenticated users full access" — correct for a single-tenant CRM. If multi-tenant ever becomes a need, scope by `auth.uid()` / team id.

### Adding users

Two paths:

- **Settings → Invite teammate** in the CRM UI. Requires `SUPABASE_SERVICE_ROLE_KEY` to be set in env (server-only). Sends an email link via Supabase's `auth.admin.inviteUserByEmail`. The invitee clicks → lands on `/auth/callback` → signed in → dashboard. They can set their own password from Settings → Change password.
- **Supabase dashboard** → Authentication → Users → "Add user". Manual; useful for the very first user (chicken-and-egg with the invite flow).

For invite links to work in production, Supabase must know the site URL. In your Supabase project: **Authentication → URL Configuration**:

- **Site URL**: `https://your-vercel-domain.vercel.app` (or your custom domain)
- **Redirect URLs** (allow-list): add `https://your-vercel-domain.vercel.app/auth/callback`

Without this, Supabase will send the invite link to localhost or to the previous project URL, and the recipient won't be able to sign in.

### Migrations

`supabase/setup.sql` is the canonical full schema and is **idempotent** — every `create` uses `if not exists` and triggers/policies are drop-then-create. Safe to re-run on an existing DB. For incremental changes, prefer running the latest `supabase/migrations/NNN_*.sql` only.

The migration sequence runs from `001_add_signatures_and_storage.sql` through `027_job_time.sql`. The numbering has no gaps.

### Branding

`lib/constants/branding.ts` exports `BUSINESS` — name, signoff, support email, review URL. Everything user-facing reads from here so re-skinning is one file.

### Observability

Not wired yet. To add Sentry:

```bash
npx @sentry/wizard@latest -i nextjs
```

Follow the prompts; the wizard creates the config files. Add `SENTRY_DSN` to Vercel env. Existing `app/global-error.tsx` has a `console.error` call where `Sentry.captureException(error)` should go.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server on `:3000`. |
| `npm run build` | Production build. Run before deploying to catch regressions. |
| `npm run start` | Serve the production build locally. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | `tsc --noEmit`. Should be clean before every PR. |

---

## License

Proprietary — Business Sorted Kent / GEM Services.
