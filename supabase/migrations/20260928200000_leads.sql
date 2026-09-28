-- Construction leads (owner, Sep 28): "is there any way to get data on new builds before
-- they're built, giving us time to submit a bid?" Two public feeds, pulled nightly and when a
-- Prospecting user opens the Leads page:
--   ky_planroom        The State of KY online planroom (Division of Engineering and Contract
--                      Administration): every state-funded project in bid phase, with pre-bid
--                      and bid dates. Public HTML, no login.
--   louisville_permits Louisville Metro's open-data feed of active construction permits
--                      (ArcGIS REST): Commercial New / Addition permits with sq ft, cost,
--                      address and contractor.
-- A lead is a row per (source, external_id); refreshes update what the source says and keep
-- the team's status. is_roof is the keyword match at fetch time. Nothing here touches bids.

create table if not exists public.lead_settings (
  id integer primary key default 1 check (id = 1),
  roof_keywords text[] not null default '{roof,roofing,re-roof,reroof,membrane,epdm,tpo,pvc,shingle,standing seam,metal roof,coping,parapet}',
  louisville_types text[] not null default '{Commercial New,Commercial Addition}',
  louisville_min_sqft numeric not null default 5000 check (louisville_min_sqft >= 0),
  louisville_days integer not null default 90 check (louisville_days between 7 and 365),
  last_fetch_at timestamptz,
  last_fetch_note text,
  updated_at timestamptz not null default now()
);
insert into public.lead_settings (id) values (1) on conflict (id) do nothing;
alter table public.lead_settings enable row level security;
drop policy if exists lead_settings_read on public.lead_settings;
create policy lead_settings_read on public.lead_settings for select to authenticated using (true);
drop policy if exists lead_settings_write on public.lead_settings;
create policy lead_settings_write on public.lead_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ky_planroom','louisville_permits')),
  external_id text not null,
  title text not null,
  agency text,
  location text,
  county text,
  address text,
  city text,
  lat double precision,
  lng double precision,
  project_type text,
  sqft numeric,
  project_cost numeric,
  contractor text,
  prebid_at timestamptz,
  bid_at timestamptz,
  issued_on date,
  url text,
  is_roof boolean not null default false,
  status text not null default 'new' check (status in ('new','watching','dismissed','added')),
  status_by_name text,
  status_at timestamptz,
  building_id uuid references public.buildings(id) on delete set null,
  note text,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  gone_at timestamptz,
  unique (source, external_id)
);
create index if not exists leads_bid_idx on public.leads (bid_at) where gone_at is null;
create index if not exists leads_seen_idx on public.leads (first_seen_at desc);
create index if not exists leads_status_idx on public.leads (status) where gone_at is null;
alter table public.leads enable row level security;
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate') or public.has_access('customers'));
drop policy if exists leads_write on public.leads;
create policy leads_write on public.leads for all to authenticated
  using (public.has_access('prospect')) with check (public.has_access('prospect'));

-- The fetch stamp, written by the throttled in-app pass as a Prospecting user.
create or replace function public.stamp_lead_fetch(note text)
returns void language sql security definer set search_path = public as $$
  update public.lead_settings set last_fetch_at = now(), last_fetch_note = note where id = 1
    and (auth.role() = 'service_role' or public.has_access('prospect'));
$$;
revoke all on function public.stamp_lead_fetch(text) from public;
grant execute on function public.stamp_lead_fetch(text) to authenticated, service_role;
