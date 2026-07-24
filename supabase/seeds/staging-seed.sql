-- ============================================================
-- GEM CRM — LOCAL/STAGING SEED (synthetic data)
-- ============================================================
--
--   ⚠️  DO NOT RUN AGAINST PRODUCTION.  ⚠️
--
-- Obviously-fake test data so the app has something to show when dev /
-- the Vercel preview / the local stack points at a non-prod database.
-- Every row uses a fixed, recognisable UUID; idempotent via
-- `on conflict (id) do nothing`, so it's safe to re-run.
--
-- TEST-DATA CONVENTION: synthetic customers/jobs use **John Lally** as the
-- name and **BSK** as the company, so test data is instantly recognisable
-- as ours and never mistaken for a real customer.
--
-- UUIDs use ONLY valid hex digits (0-9, a-f). The 8-char prefix block
-- identifies the entity type, the numeric suffix the instance:
--   aaaaaaaa… customers   bbbbbbbb… sites   cccccccc… agreements
--   dddddddd… jobs        eeeeeeee… tasks
--
-- Dates are relative to current_date so the scheduled / in-progress /
-- completed split stays meaningful whenever run:
--   - one SCHEDULED job a week out      (upcoming-visit chip)
--   - one IN_PROGRESS job today         ("Fill Service Sheet" entry)
--   - one COMPLETED job a week ago      (view-only locked sheet)
-- The completed job carries a FULLY-FILLED service sheet (incl.
-- method_used) so it satisfies the jobs_completed_requires_filled_sheet
-- check constraint (migration 035).
-- ============================================================

begin;

-- ─── Customers ──────────────────────────────────────────────
-- C1: commercial (company BSK + annual value + structured address).
-- C2: domestic (John's home account; no company).
insert into customers (
  id, name, company_name, email, phone, customer_type,
  address_line_1, town, county, postcode, annual_contract_value
) values
  (
    'aaaaaaaa-0000-4000-8000-000000000001',
    'John Lally', 'BSK',
    'john@bsk.example', '01234 567890', 'commercial',
    '1 Industrial Way', 'Testford', 'Testshire', 'TF1 1AA', 4800
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000002',
    'John Lally', null,
    'john@home.example', '07700 900123', 'domestic',
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
-- method_used is NOT NULL default '{}'. Non-completed jobs carry '{}'
-- (empty, passes the 035 constraint vacuously); the completed job carries
-- a real method so it satisfies the constraint.
insert into jobs (
  id, site_id, job_date, call_type, pest_species, method_used, job_status,
  reference_number, agreement_id, findings, recommendations,
  pesticides_used, risk_level, risk_comments, client_present, client_name
) values
  (
    'dddddddd-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001',
    current_date + 7, 'routine', '{Mice}', '{}', 'scheduled',
    'JOB-STG-001', null,
    null, null, null, null, null, false, null
  ),
  (
    'dddddddd-0000-4000-8000-000000000002',
    'bbbbbbbb-0000-4000-8000-000000000002',
    current_date, 'callout', '{Wasps}', '{}', 'in_progress',
    'JOB-STG-002', null,
    null, null, null, null, null, false, null
  ),
  (
    'dddddddd-0000-4000-8000-000000000003',
    'bbbbbbbb-0000-4000-8000-000000000001',
    current_date - 7, 'routine', '{Rats}', '{Baiting}', 'completed',
    'JOB-STG-003', 'cccccccc-0000-4000-8000-000000000001',
    'Droppings found in the rear store room.',
    'Bait stations installed; review in 7 days.',
    'Bromadiolone 0.005%', 'low',
    'Standard rodent treatment, no special hazards.',
    true, 'John Lally'
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
    'Call BSK to confirm next quarterly visit',
    current_date + 3, 'pending', 'follow_up',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001'
  )
on conflict (id) do nothing;

-- ─── Products (migration 047) ───────────────────────────────
-- REAL reference data (not synthetic) — the seed lives in setup.sql / the
-- 047 migration too, but the rebuild truncates all public tables AFTER
-- setup.sql, so it must be re-seeded here to survive a local rebuild. Same
-- fixed UUIDs as the migration; idempotent.
insert into products (id, brand_name, chemical_name) values
  ('39ca1c16-5efa-5117-972d-28b1af77afc0', 'Selontra', 'cholecalciferol 0.075% 20g block'),
  ('c2a8101c-af58-5765-88ee-0289fd68aa4c', 'Harmonix', 'cholecalciferol 0.075% 20g sachet'),
  ('8f84d904-ec2a-5f66-946f-e587b5096528', 'Talon Soft', 'brodifacoum 0.0025% paste'),
  ('f1026359-a301-5d00-ac59-976f8c9e4bec', 'Difen', 'difenacoum 0.005% grain'),
  ('a736e6a3-e022-532a-92c9-755c438c5e1d', 'Brodikill', 'brodifacoum 0.0029% grain'),
  ('b166651b-6790-58c4-bd5e-343c1c692dfb', 'Solo Blox', 'brodifacoum 0.005% 20g block'),
  ('67b49a64-25ba-5c1f-8d9d-a16af4d89503', 'Rodilon soft', 'difethialone 0.0025% 10g sachets'),
  ('a8549ba8-fa07-5530-af4e-15fc34340a54', 'Vulcan Dust', 'permethrin 0.5% dust'),
  ('74f0d3d9-63d2-5357-8c72-c4bec2d5813c', 'Digrain wasp and hornet destroyer', 'permethrin 0.25%, tetramethrin 0.24%'),
  ('ebb95b72-f0eb-5ac4-9f84-3dfaac398e51', 'Vazor wasp nest destroyer', 'trans phenothrin 0.1%, tetramethrin 0.3%'),
  ('8789925b-e706-53a5-a5ea-7f88654c5c2e', 'Cimetrol Super ew', 'cypermethrin 25%, tetramethrin 10%, piperonyl butoxide 20%, pyriproxyfen 1% (IGR)'),
  ('a6a9e353-049a-5c38-84bd-a749ba1c4aed', 'Phobi caps', 'cypermethrin 9.2%, prallethrin 0.46%')
on conflict (id) do nothing;

commit;

-- ─── Verification (run after the inserts) ───────────────────
-- Expected: customers 2, sites 2, agreements 1, jobs 3, tasks 1.
-- select 'customers' as t, count(*) from customers
-- union all select 'sites', count(*) from sites
-- union all select 'agreements', count(*) from agreements
-- union all select 'jobs', count(*) from jobs
-- union all select 'tasks', count(*) from tasks;
