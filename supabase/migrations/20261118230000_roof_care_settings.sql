-- Roof Care plans: the numbers the prices are worked from (owner, Nov 18;
-- docs/roof-care-plans.md). One row. What a crew member costs, what the list price of each plan
-- is, how long a roof of each size takes: the office's own figures, so they are typed on
-- Admin › Settings › Roof Care plans and kept here, never in the code.
--
-- Only an admin reads or changes the row. Prices for anyone else are worked out by the server.
-- The row starts empty: every box on the page is blank until an admin types it.
-- Safe to run twice.
create table if not exists public.roof_care_settings (
  id integer primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text
);
alter table public.roof_care_settings enable row level security;
revoke all on public.roof_care_settings from anon;
grant select, insert, update on public.roof_care_settings to authenticated;
grant all on public.roof_care_settings to service_role;
drop policy if exists roof_care_settings_admin on public.roof_care_settings;
create policy roof_care_settings_admin on public.roof_care_settings
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
insert into public.roof_care_settings (id) values (1) on conflict (id) do nothing;
