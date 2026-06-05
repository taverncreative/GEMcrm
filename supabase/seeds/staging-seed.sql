-- ============================================================
-- GEM CRM — STAGING SEED (synthetic data)
-- ============================================================
--
--   ⚠️  DO NOT RUN AGAINST PRODUCTION.  ⚠️
--
-- This inserts obviously-fake test data so the app has something to
-- show when dev / the Vercel preview points at the STAGING Supabase
-- project. Every row uses a fixed, recognisable UUID and the script
-- is idempotent (`on conflict (id) do nothing`) so it's safe to
-- re-run on staging.
--
-- UUIDs use ONLY valid hex digits (0-9, a-f). The 8-char prefix block
-- identifies the entity type, the numeric suffix the instance:
--   aaaaaaaa… customers   bbbbbbbb… sites   cccccccc… agreements
--   dddddddd… jobs        eeeeeeee… tasks
-- (An earlier version used mnemonic letters like "…s1"/"…j1" — those
-- failed because s/j/t aren't hex. Fixed.)
--
-- No real customer data. Names, emails, phones, addresses are all
-- invented. Dates are relative to current_date so the scheduled /
-- in-progress / completed split stays meaningful whenever run:
--   - one SCHEDULED job a week out      (upcoming-visit chip)
--   - one IN_PROGRESS job today         ("Fill Service Sheet" entry)
--   - one COMPLETED job a week ago      (view-only locked sheet)
--
-- Apply: paste into Staging → SQL Editor → Run (after setup.sql).
-- ============================================================

begin;

-- ─── Customers ──────────────────────────────────────────────
-- C1: commercial (company + annual value + structured address).
-- C2: domestic (no company; structured address).
insert into customers (
  id, name, company_name, email, phone, customer_type,
  address_line_1, town, county, postcode, annual_contract_value
) values
  (
    'aaaaaaaa-0000-4000-8000-000000000001',
    'Sam Director', 'Acme Commercial Ltd',
    'sam@acme-staging.example', '01234 567890', 'commercial',
    '1 Industrial Way', 'Testford', 'Testshire', 'TF1 1AA', 4800
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000002',
    'Jane Householder', null,
    'jane@home-staging.example', '07700 900123', 'domestic',
    '22 Garden Lane', 'Testford', 'Testshire', 'TF2 2BB', null
  )
on conflict (id) do nothing;

-- ─── Sites ──────────────────────────────────────────────────
-- One site per customer.
insert into sites (
  id, customer_id, address_line_1, town, county, postcode
) values
  (
    'bbbbbbbb-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    '1 Industrial Way', 'Testford', 'Testshire', 'TF1 1AA'
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000002',
    '22 Garden Lane', 'Testford', 'Testshire', 'TF2 2BB'
  )
on conflict (id) do nothing;

-- ─── Agreement ──────────────────────────────────────────────
-- Active PMA on the commercial customer. No contract_pdf_url, so the
-- side panel's "Sign + generate agreement PDF" suggestion surfaces.
insert into agreements (
  id, customer_id, site_id, start_date, contract_value,
  visit_frequency, pest_species, callout_terms, status, reference_number
) values
  (
    'cccccccc-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    current_date - 30, 4800, 4,
    '{Mice,Rats}', '48-hour response within working hours',
    'active', 'PMA-STG-001'
  )
on conflict (id) do nothing;

-- ─── Jobs ───────────────────────────────────────────────────
-- J1 scheduled (next week)  → upcoming-visit chip on the lists/panel
-- J2 in_progress (today)    → "Fill Service Sheet" entry point
-- J3 completed (last week)  → view-only locked service sheet
--
-- Distinct (site_id, job_date, call_type) keeps clear of the partial
-- unique index; J3 also carries agreement_id (excluded from the index
-- predicate regardless).
insert into jobs (
  id, site_id, job_date, call_type, pest_species, job_status,
  reference_number, agreement_id, findings, recommendations,
  pesticides_used, risk_level, risk_comments, client_present, client_name
) values
  (
    'dddddddd-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    current_date + 7, 'routine', '{Mice}', 'scheduled',
    'JOB-STG-001', null,
    null, null, null, null, null, false, null
  ),
  (
    'dddddddd-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000002',
    current_date, 'callout', '{Wasps}', 'in_progress',
    'JOB-STG-002', null,
    null, null, null, null, null, false, null
  ),
  (
    'dddddddd-0000-4000-8000-000000000003',
    'bbbbbbbb-0000-4000-8000-000000000001',
    current_date - 7, 'routine', '{Rats}', 'completed',
    'JOB-STG-003', 'cccccccc-0000-4000-8000-000000000001',
    'Droppings found in the rear store room.',
    'Bait stations installed; review in 7 days.',
    'Bromadiolone 0.005%', 'low',
    'Standard rodent treatment, no special hazards.',
    true, 'Sam Director'
  )
on conflict (id) do nothing;

-- ─── Task ───────────────────────────────────────────────────
-- Pending follow-up on the commercial customer → "Follow-ups" panel
-- section + a customer-to-contact signal.
insert into tasks (
  id, title, due_date, status, task_type,
  related_customer_id, site_id
) values
  (
    'eeeeeeee-0000-4000-8000-000000000001',
    'Call Acme to confirm next quarterly visit',
    current_date + 3, 'pending', 'follow_up',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001'
  )
on conflict (id) do nothing;

commit;

-- ─── Verification (run after the inserts) ───────────────────
-- Expected: customers 2, sites 2, agreements 1, jobs 3, tasks 1.
-- select 'customers' as t, count(*) from customers
-- union all select 'sites', count(*) from sites
-- union all select 'agreements', count(*) from agreements
-- union all select 'jobs', count(*) from jobs
-- union all select 'tasks', count(*) from tasks;
