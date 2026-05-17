-- Extend agreements into full pest management contracts
-- Run this in the Supabase SQL Editor

alter table agreements add column contact_name text;
alter table agreements add column contact_phone text;
alter table agreements add column contact_email text;
alter table agreements add column invoice_address text;
alter table agreements add column terms_text text;
alter table agreements add column client_signature_url text;
alter table agreements add column gem_signature_url text;
alter table agreements add column signed_date date;
alter table agreements add column contract_pdf_url text;
