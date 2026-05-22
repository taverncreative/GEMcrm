# Step 6 — Sync engine + conflict inbox + sync status UI (notes)

Branch: `offline-pwa`
Commits: 11 in this step (see hash list at the bottom of this file).

## Architecture overview

The offline rollout's central layer. Push the local outbox to the server, pull server changes into Dexie, upload photos in parallel, surface state in a header chip, expose stuck entries in a conflict inbox.

```
                        ┌──────────────────────────┐
                        │ <SyncBoot> (AppShell)    │
                        │                          │
   user signs in ──────►│ 1. detect user change?   │
                        │    → wipe local DB       │
                        │ 2. no cursors yet?       │
                        │    → InitialSyncScreen   │
                        │      + pullAll(progress) │
                        │ 3. else → wire triggers  │
                        │      online / focus /    │
                        │      interval(30s) /     │
                        │      mount               │
                        └────────────┬─────────────┘
                                     │ each trigger
                                     ▼
                        ┌──────────────────────────┐
                        │ runSync(reason)          │
                        │                          │
                        │ guards: online + !busy   │
                        │ syncStarted(reason)      │
                        │                          │
                        │ ┌──────────────────────┐ │
                        │ │ drainOutbox          │ │   ┌──────────┐
                        │ │  for each eligible   │─┼──►│ registry │
                        │ │  entry → invoke      │ │   │  4 entries│
                        │ │  via registry        │ │   └──────────┘
                        │ │  classify result     │ │
                        │ │  ok → delete         │ │
                        │ │  client-err N times  │ │
                        │ │   → mark stuck       │ │
                        │ │  auth → halt         │ │
                        │ │  server/network →    │ │
                        │ │   backoff + retry    │ │
                        │ └──────────────────────┘ │
                        │           ▼              │
                        │ ┌──────────────────────┐ │
                        │ │ pullAll              │ │   ┌──────────────────┐
                        │ │  per entity:         │─┼──►│ pull-actions     │
                        │ │   read cursor        │ │   │ → SECURITY DEF.  │
                        │ │   call RPC since X   │ │   │   RPC functions  │
                        │ │   merge LWW with     │ │   │   (migration 030)│
                        │ │   outbox guard       │ │   └──────────────────┘
                        │ │   advance cursor     │ │
                        │ └──────────────────────┘ │
                        │           ▼              │
                        │ ┌──────────────────────┐ │   ┌──────────────┐
                        │ │ drainPhotos          │ │   │ POST /api/   │
                        │ │  (fire-and-forget,   │─┼──►│ photos/      │
                        │ │  concurrency-2)      │ │   │ upload       │
                        │ └──────────────────────┘ │   └──────────────┘
                        │ syncFinished()           │
                        └──────────────────────────┘
                                     │
                        ┌────────────┴────────────┐
                        ▼                         ▼
            ┌────────────────────┐    ┌────────────────────┐
            │ SyncStatusIndicator│    │ /sync/conflicts    │
            │  (header chip)     │    │  list stuck entries│
            │  6 visual states   │    │  retry / discard   │
            └────────────────────┘    └────────────────────┘
```

## Push loop walkthrough (`lib/sync/push.ts`)

1. Read outbox entries where `next_attempt_at <= now AND stuck === false`, sorted by `created_at` (oldest first).
2. For each entry, invoke via the registry. Two dispatch shapes:
   - **form** entries (`completeTaskAction`, `updateJobStatusAction`, `updateAgreementStatusAction`, `completeServiceSheetAction`) — reconstruct FormData via `objectToFormData(args)`, invoke `action(initialState, fd)`.
   - **direct** entries (`setReviewReceivedAction`) — spread args as a tuple: `action(...args)`.
3. Classify the result via `classifyActionResult` / `classifyError`:
   - **ok** → delete the outbox entry.
   - **client-error** → bump attempts, set `next_attempt_at` via `nextAttemptAt(attempts)`. If attempts crosses 5, mark `stuck: true` (surfaces in conflict inbox).
   - **auth-expired** → record `last_error` on the entry (no bump — wasn't its fault), bubble halt up to the engine which calls `syncFailed("...", "auth")`.
   - **server-error / network** → bump + backoff, stays in queue. Next drain will try again.
4. `UnknownActionError` (action_name not in registry) → immediate stuck on first attempt with a clear "no implementation" message. No point retrying.

Single-pass drain — new entries enqueued during the loop wait for the next `runSync()` tick (30s by default).

## Pull loop walkthrough (`lib/sync/pull.ts`)

Sequential per entity, in order: customers → sites → jobs → agreements → tasks. Sequential because (a) auth-expired halts the rest, (b) cursor reads/writes don't benefit from parallelism at GEM scale.

Per entity:
1. Read cursor from `sync_meta` (e.g. `cursor.customers`).
2. Call the server action (`pullCustomersAction(since)`) which `requireUser()`s then calls the SECURITY DEFINER RPC.
3. RPC returns all rows where `updated_at > since` (or all if since is null), ordered by `updated_at ASC`, **including soft-deleted rows**.
4. For each row, **outbox guard**: if any non-stuck outbox entry references `(entity_type, row.id)`, skip the merge. The local row is dirty with an unsynced wrapper-write; the next push will sync local→server, the next pull will refresh us cleanly. Without this guard, pull could clobber an offline edit before it had a chance to sync.
5. Otherwise, last-write-wins on `updated_at`: write through if server's timestamp ≥ local's, else keep local.
6. After the loop, write the new cursor: `max(updated_at) of returned set` (gotcha 3 — using `now()` would re-import boundary rows).

Per-entity failure isolation: if one entity errors, the other four still complete and advance their cursors. The failed entity retries on the next pull cycle.

## Photos loop walkthrough (`lib/sync/photos.ts`)

Independent transport — fires from `runSync` as fire-and-forget after push+pull complete. Detached from the engine's status so a 10-minute photo upload doesn't pin the chip at "Syncing…".

1. Read `photos_pending` rows where `uploaded === false AND next_attempt_at <= now`, filter out stuck (attempts ≥ 5).
2. Worker pool of 2 — each worker pulls the next eligible photo, POSTs to `/api/photos/upload` as multipart (photoId + Blob).
3. Per result:
   - **ok** → mark `uploaded: true`, store `server_url`, reset attempts. If the photo is >7d old, also replace the local Blob with a 0-byte placeholder to reclaim IndexedDB space (`getPhotoSrcAsync` falls back to `server_url` in that state).
   - **auth-expired** → record `last_upload_error`, no bump, halt both workers.
   - **server-error / network / client-error** → bump `upload_attempts`, set `next_attempt_at` via shared backoff, record error.
4. After the workers finish, run `cleanupOldBlobs()` — sweeps already-uploaded photos whose blob is still non-empty and whose captured_at is >7d.

Photos land at the deterministic Storage path `photos/<photoId>.jpg` (the `reports` bucket, public). The server-side `writeServiceSheet` (modified in commit 4a) computes the public URL from the photo client UUID — so by the time `completeServiceSheetAction` replays from the outbox, the URL is correct whether the photo has uploaded yet or not. The brief broken-image window between push completion and photo upload is the documented trade-off.

## Conflict inbox (`/sync/conflicts`)

UI mounts at `app/(app)/sync/conflicts/page.tsx`. Auth-gated by the `(app)` route group.

Lists outbox entries where `stuck === true`. Per row: action_name, entity ref, attempts count, last_error message, expandable args JSON.

Two actions per entry:
- **Retry** — `unstickEntry(id)` resets attempts to 0, clears stuck flag, sets next_attempt_at to now. Then `runSync('manual')` so the operator sees the outcome immediately.
- **Discard** — 2-step confirm. Removes the outbox entry only. **Does NOT revert the local Dexie change** (warning copy explicit about the divergence). Safe revert is in POST_OFFLINE_FOLLOWUPS for step 7+; per-entity undo logic is genuinely hard to generalise.

The status indicator's "Conflicts (N)" button appears when stuckCount > 0 and links here.

## Initial sync screen (`components/sync/initial-sync-screen.tsx`)

Full-screen blocking overlay shown by `<SyncBoot>` when no cursors exist (fresh install or post-user-change wipe). Per-entity progress tiles: pending → syncing → done | error.

Disconnect handling (gotcha 8): the boot effect listens for the `offline` window event during initial pull. On disconnect, transitions to a "Connection lost — resume when online" state with a manual retry button. Retry button forces the boot sequence to re-run from scratch.

Server error handling: distinct red "Sync failed" block with the error message + Retry button.

Once `bootState === 'ready'`, the overlay unmounts and the app's normal triggers wire up.

## Sync status indicator (`components/sync/sync-status-indicator.tsx`)

Header chip with 6 visual states, priority-ordered:

1. `authExpired` → amber dot, "Session expired"
2. `!online` → grey dot, "Offline · N pending"
3. `stuck > 0` → red dot, "N stuck — tap"
4. `syncing` → blue pulsing dot, "Syncing…"
5. `pending > 0` → yellow dot, "N pending"
6. `lastSyncAt` → green dot, "Synced X min ago"
7. (no prior sync) → grey dot, "Not yet synced"

Tap → popover with full counts, last-error message, last-trigger reason, "Sync now" button, optional "Conflicts (N)" link when stuck > 0. The "Synced X min ago" label refreshes every 60s while idle so it doesn't go stale.

## Session-expired banner

Driven by `syncStatus.authExpired`. Amber bar above the QuickActions bar. "Sign in" link + manual dismiss. SyncBoot auto-clears the flag when it next runs with a valid user_id — that's the post-login auto-retry hook (edge case 12 from step 5).

## Edge case + gotcha resolutions

| # | Item | Resolution |
|---|---|---|
| 1 | RLS soft-delete pull blocked | Migration 030: 5 SECURITY DEFINER functions with `auth.uid() IS NOT NULL` check. EXECUTE revoked from public, granted to authenticated. ✅ applied. |
| 2 | Pull-vs-outbox merge race | `mergeRows` in pull.ts checks `db.outbox.where("[entity_type+entity_id]").equals([...]).count()` before LWW merge. Skip if outbox entry exists for the row. ✅ |
| 3 | `updated_at` strictly greater-than | Cursor advances to `max(updated_at) of returned set`, not `now()`. ✅ |
| 4 | `entity_ids[]` for multi-entity actions | Field added to OutboxEntry. Push dispatcher doesn't use it (action stays transactional). Pull-merge guard SHOULD check it — gap documented in POST_OFFLINE_FOLLOWUPS as a step-7 follow-up. |
| 5 | Compaction "create + update → merged" | Partial — current implementation keeps both entries (replay-in-order is still correct). True merge requires per-action callback. Documented. |
| 6 | bulkCompleteTasks fan-out | Direct handler in BulkCompleteButton enqueues N completeTaskAction entries. Bulk action only used for online efficiency. Registry stays clean. ✅ |
| 7 | objectToFormData reconstructor | Implemented in `lib/sync/registry.ts`. /dev/db-smoke gains a "FormData round-trip check" button that runs the inverse pair against a multi-key/multi-value/unicode FormData and shows pass/fail inline. ✅ |
| 8 | Initial-sync disconnect resilience | SyncBoot listens for `offline` event during initial pull. Shows "Connection lost — resume when online" with retry button. ✅ |
| 11 | Photos+action write race | Atomic patch via `db.photos_pending.update(id, patch)`. The parent record's `photo_urls` is set by writeServiceSheet at replay time, computed deterministically from photo IDs — photos loop never updates parent rows. No concurrent write. ✅ |
| 12 | Post-login auto-sync | `SyncBoot` calls `clearAuthExpired()` and runs `runSync('mount')` on every mount with a valid user_id. Re-login → new mount → auto-trigger. ✅ |

## Things that surprised me

1. **The server-action bridge for sync-pull data layer.** I had `lib/data/sync-pulls.ts` using `createClient()` (cookies/next/headers — server-only) and `lib/sync/pull.ts` (client) importing it directly. The build was clean through `npx tsc --noEmit` but `npm run build` caught it — Next.js's webpack tracer flagged the server module being dragged into the client bundle. Fix: added `app/(app)/sync/pull-actions.ts` as a "use server" bridge. Auth is now belt-and-braces (server action `requireUser()` + RPC body `auth.uid()` check) — slightly redundant, cleaner error classification. **Lesson: typecheck doesn't catch server/client boundary violations; only the full Next build does.**

2. **`classifyError` couldn't return `kind: "ok"`** but TypeScript didn't know that, so every caller had to defensively handle the never-actually-returned case. Narrowed the return type to `Exclude<SyncResultClass, {kind: "ok"}>` — cleared the noise in photos.ts. Worth doing for every "this function never returns variant X" case in the codebase but I limited scope to where it bit.

3. **Dexie boolean indexes "just work" in modern browsers.** I'd planned to store `stuck` as 0/1 (the classic IDB-compatible-boolean trick) but Dexie v4 + modern Chrome/Firefox/Safari handle boolean keys fine. Left it as a real `boolean` for type clarity. The compound `[entity_type+entity_id]` index on the outbox is still the workhorse — `stuck` is a secondary scan attribute.

4. **The clock-skew check landed in 6 lines.** I'd dreaded the design — turns out `fetch("/", {method: "HEAD"})` returns the Date header and `new Date(serverDate).getTime()` gives ms. Difference vs `Date.now()` is the skew. One-shot guard with a module-level flag so it only fires once per session.

5. **Photo path determinism made the offline path much simpler than I'd feared.** Once you commit to "the Storage path IS the photo client UUID," the entire question of "when does the parent record's `photo_urls` get the real URL?" dissolves — writeServiceSheet computes the URL from the UUID at replay time, photos loop fills the Storage object whenever it gets to it. The two operations don't need to coordinate.

6. **The initial-sync screen wasn't as scary as I'd thought.** I expected to write a complex state machine; the actual code is `useState<BootState>` with four kinds and a render switch. The disconnect-mid-sync resilience needed one extra useEffect listening for the offline event. Total ~250 lines including the overlay UI.

## Manual smoke test steps

All require a dev session (`npm run dev`) on `offline-pwa` with migration 030 applied to the Supabase project.

### Smoke A — push (online happy path)

1. Open `/dashboard`. Tick a task's "Complete" button. The "Done" pill should render immediately (local-first).
2. Open `/dev/db-smoke`. Outbox counter shows 1 entry (`completeTaskAction`).
3. Status chip in header shows "1 pending" → flips to "Syncing…" within ~30s (interval trigger) or sooner if you click "Sync now".
4. Once synced: chip shows "Synced just now", outbox empty.
5. SQL check in Supabase Studio: `SELECT status, completed_at FROM tasks WHERE id = '<task uuid>';` → `complete` with a timestamp.

### Smoke B — push (offline → online)

1. Open DevTools → Network → Offline.
2. Tick a task's "Complete". UI updates immediately. Status chip shows "Offline · 1 pending".
3. Outbox row appears in `/dev/db-smoke`.
4. Go back online. Status chip transitions to "Syncing…" via the `online` event → "Synced just now".
5. Supabase row reflects the change.

### Smoke C — pull

1. With the dev app open and synced, open Supabase Studio and edit a customer's `name` field directly. (Use a customer you can recognise.)
2. Wait up to 30s OR click "Sync now" in the indicator panel.
3. The customers list in the app reflects the new name (read via the existing data layer for now — step-7 will switch to Dexie reads, at which point a `useLiveQuery` would update instantly).
4. In `/dev/db-smoke`, dump to console and verify the local Dexie customer row has the new name.

### Smoke D — pull-with-outbox-guard

1. Take one customer offline-edit: tick its review checkbox. Outbox entry queued.
2. Without going online, edit the same customer's name in Supabase Studio.
3. Go online. Sync runs.
4. Verify: the server's name change DID arrive (via push completing the review change first, then pull bringing the name update) — and the review checkbox state is preserved. Without the outbox guard, the pull would clobber the unsynced review state.

### Smoke E — photos

1. With the dev app open, navigate to a job's Complete page. Capture a photo via PhotoUpload.
2. The photo lands in `photos_pending` (verify in `/dev/db-smoke` photos counter; +1).
3. Submit the service sheet (online). Photos loop fires alongside push.
4. Verify: `/api/photos/upload` receives the POST; `photos_pending` row's `uploaded` flips true; `server_url` populated.
5. The job's `photo_urls` server-side contains a public URL pointing at `photos/<uuid>.jpg`. Verify the URL is live by opening it in a browser tab.

### Smoke F — conflicts inbox

1. Force a sync failure: in DevTools, intercept a `completeTaskAction` call and return an error 5+ times in a row. The simplest way: temporarily break the action server-side (e.g. `throw new Error('test')` inside `completeTaskAction`). Trigger 5 ticks of the action offline → online cycles.
2. After 5 attempts the entry marks `stuck: true`. Status chip shows "1 stuck — tap".
3. Navigate to `/sync/conflicts`. The entry is visible with `last_error` showing the test error.
4. Revert the server-side break. Click "Retry". Entry unsticks, sync runs, entry deletes on success.
5. Re-create the stuck entry. Click "Discard" → confirm. Entry removed from outbox; local change stays as warned.

### Smoke G — initial sync (fresh install)

1. Open `/dev/db-smoke` → "Wipe local DB". This clears all Dexie tables including sync_meta.
2. Reload any `/(app)/*` page.
3. The InitialSyncScreen appears immediately. Per-entity tiles transition through pending → syncing → done as each pull completes.
4. Once all 5 entities are done, the screen unmounts and the app renders.
5. Verify in `/dev/db-smoke` that all 5 tables have rows matching the server state.

### Smoke H — initial sync disconnect

1. Wipe local DB as in G.
2. Reload — initial sync starts.
3. Switch to DevTools → Offline mid-pull (e.g. right after Customers complete but before Jobs).
4. The amber "Connection lost — resume when online" block appears with a Retry button.
5. Go back online. Click Retry. Initial sync resumes from where the cursors landed.

### Smoke I — auth expiry mid-sync

1. With the app synced, open Application → Cookies in DevTools → delete the `sb-*-auth-token` cookie.
2. Trigger a sync (toggle a wrapped action, or click "Sync now").
3. The sync attempt 401s. Status chip flips to "Session expired" (amber). Banner appears at top.
4. **Verify:** the user is NOT logged out, local data is NOT wiped, the failing outbox entry is preserved (no attempt bump).
5. Click "Sign in" in the banner → re-login.
6. Land back on `/(app)/*`. SyncBoot mounts → clears authExpired → runSync fires. The previously-failed entry replays successfully.

### Smoke J — queue compaction

1. Offline. Toggle a customer's review checkbox 3 times (off → on → off → on).
2. Verify in `/dev/db-smoke` outbox: only ONE entry exists for that customer (the compaction's `update+update → latest update` rule). `args.received` is the final value.
3. Online: sync. Server gets one PATCH, not three. Customer row reflects the final value.

### Smoke K — FormData round-trip check

1. `/dev/db-smoke` → click "FormData round-trip check".
2. Inline green box: "✓ FormData round-trip clean (5 keys)".
3. If it ever shows red: regression in `formDataToObject` / `objectToFormData` symmetry; investigate before shipping.

### Smoke L — clock skew warning

1. With the dev app open, shift your laptop's clock forward 10 minutes via System Settings → Date & Time.
2. Reload the app. First sync of the new session fires.
3. Browser console shows: `[sync] clock skew 600s detected ...`. Warning only — sync still runs.

## /dev/db-smoke additions in step 6

Beyond what step 5 added:
- "Sync now" button (manual `runSync('manual')`)
- "FormData round-trip check" button (gotcha 7's regression alarm)
- The outbox inspector now shows the new fields where present (op, entity_ids — visible in the JSON args dump)
- Diagnostic output area for the round-trip check result

## Commit list

In order:

```
d3a6fe6  step 6: SECURITY DEFINER sync-pull RPCs + data-layer shim
6048897  step 6: sync utility primitives — backoff, classify, registry
b8ba56c  step 6: push loop + sync status pub-sub + outbox stuck flag
2c35e9a  step 6: pull loop + engine orchestrator + photos stub
70baf01  step 6: photo bridge — upload route + path determinism + writeServiceSheet conditional
9015e4e  step 6: photos sync loop + Dexie v3 (next_attempt_at, server_url)
ae378fa  step 6: outbox queue compaction at enqueue time
049703c  step 6: sync status indicator chip + session-expired banner
47b4cd6  step 6: conflict inbox at /sync/conflicts
bea3e3f  step 6: triggers wiring + initial-sync screen + post-login hook + clock skew
b721117  step 6: multi-write outbox field + bulkCompleteTasks fan-out + completeServiceSheet wrapped
d918820  step 6 fix: server-action bridge for sync-pull data layer
(this)   step 6: smoke-page diagnostics + STEP_6_NOTES.md
```

## Awaiting your review

Step 6 done as code. Typecheck clean, lint clean (21 pre-existing warnings unchanged), `npm run build` clean (25 routes including `/sync/conflicts`).

Migration 030 has been applied via Studio (you confirmed before commit 1). No further DB migrations in this step.

When ready, tell me to proceed to **step 7: detail-page conversion (RSC → Dexie via useLiveQuery)** — this is where the wrapped actions' offline behaviour becomes fully observable in the app's main views.
