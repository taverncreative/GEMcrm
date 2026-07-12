# GEM CRM — Database Restore Runbook

**When to use this:** the app is showing wrong, missing, or corrupted data
across the board (not one record — a widespread problem), and you need to
roll the database back to last night's good copy.

This is written so a calm helper who is **not** a developer can follow it.
Take it one step at a time. Nothing here is urgent to the second — read the
whole page first.

---

## What you're working with

- The live database is hosted on **Supabase**. There is **one** database; it
  holds every customer, site, job, agreement, task, invoice and report.
- Supabase takes an **automatic backup once a day** (overnight). We are on the
  **daily-backup** plan — there is **no** point-in-time (to-the-minute)
  recovery. So a restore goes back to **the most recent nightly backup**.
- **This means up to ~24 hours of work can be lost.** Anything entered since
  last night's backup (new bookings, completed service sheets, edits) will be
  **gone** after a restore. That is the trade-off. Only restore if the current
  state is worse than losing a day.

> If the problem is a **single** wrong record, do **NOT** restore the whole
> database. Fix that record in the app instead, or call the developer. A
> full restore is a big hammer.

---

## Before you restore — pause the team (5 minutes)

A restore replaces everything, so anyone using the app during it will either
have their work discarded or hit errors.

1. **Message Nate and anyone else who uses GEM CRM: "Stop using the app — do
   not add or change anything until I say it's back."**
2. Ask them to **close the app** (phone and computer). It's fine if they can't
   all be reached — the restore still works — but their unsynced offline
   changes on their own devices may reappear later and conflict. Fewer people
   active = cleaner restore.
3. Note the **current time** and roughly **what was entered today** (so you
   know what will need re-entering afterwards).

---

## Restore, step by step (Supabase dashboard)

1. Go to **https://supabase.com/dashboard** and sign in with the GEM Services
   Supabase account.
2. Open the project named **gemcrm-staging**
   (project ref `ubyiiffkfqfzffigahrk` — despite the name, this **is** the live
   production database).
3. In the left sidebar: **Database → Backups**
   (direct link: `https://supabase.com/dashboard/project/ubyiiffkfqfzffigahrk/database/backups`).
4. You'll see a list of daily backups by date/time. Pick the **most recent one
   from before the problem started** (usually last night's).
5. Click **Restore** next to it. Supabase will ask you to **confirm** — it
   warns that this overwrites the current database. Confirm.
6. The restore runs for **a few minutes**. **Do not close the tab.** Wait for
   Supabase to show it as complete.

If there is no **Restore** button (only a download), or you're unsure which
backup to pick, **stop and call the developer** rather than guessing.

---

## After the restore — check the app (10 minutes)

Sign in to the live app at **https://gemcrm.vercel.app** and confirm the basics:

1. **You can log in.** (If not, wait 2 minutes and try again — the database may
   still be settling.)
2. **Customers list loads** and looks like it did *yesterday* (recent stuff
   from today will be missing — that's expected).
3. **Open one customer** → their sites and jobs show.
4. **Create a test booking**, then **delete it** — confirms writing and
   deleting still work. (Delete it so it isn't left behind.)
5. **The sync indicator** (top-right) settles on green **"Synced"**, not a red
   "stuck" dot.

If all five pass, the restore worked. Tell the team **"App is back — you can
use it again"** and give them the list of **what was entered today that needs
re-entering** (from your note before you started).

---

## The reports / photos caveat (important)

The restore covers the **database** (all the records). It does **not** touch
**Storage** — the bucket called **`reports`** that holds the **PDF reports,
signed agreements, invoices, site photos, and signatures**.

- Storage files are **not** rolled back and are **not** lost by a database
  restore — they stay exactly as they are.
- The mismatch to watch for: if you restore to last night, any **report/photo
  created today** still exists as a file in Storage, but the **database row
  that points to it is gone** — so it won't show in the app. And any database
  row restored from last night still points at its file, which is fine.
- **You don't need to do anything about this** in the moment. Just know that a
  handful of today's PDFs/photos may be "orphaned" (file present, not linked).
  Note it and mention it to the developer — they can relink or clean up later.
- Customer email links to reports use short-lived signed URLs; a link that was
  emailed today may stop working after a restore. Nate can re-send the report
  from the app once things are stable.

---

## If it goes wrong

- Restore didn't finish / errored → **do not retry blindly.** Leave the app
  paused and call the developer with the exact error text.
- App still broken after a successful restore → the problem may not have been
  the database. Call the developer.
- **Developer contact:** _(fill in name + number/email here)_.

---

## One-line summary

Pause the team → Supabase dashboard → **Database → Backups** → **Restore** last
night's backup → wait → check login + customers + a test booking → tell the
team it's back → note that up to a day's entries and a few of today's
PDFs/photos may need re-doing.
