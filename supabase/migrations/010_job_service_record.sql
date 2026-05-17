-- Extend jobs for service record system
alter table jobs add column method_used text[] default '{}';
alter table jobs add column photo_urls text[] default '{}';
alter table jobs add column client_present boolean not null default false;
alter table jobs add column client_name text;
