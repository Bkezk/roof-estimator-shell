-- Phase 2 (part 1): General admin settings — schema + prefill from the legacy app.
-- Idempotent: safe whether applied by the migration runner or directly.

-- Shared RLS helper is is_admin() from the phase-1 migration.

-- 1. Singleton company/bid settings ------------------------------------------
create table if not exists public.company_settings (
  id integer primary key default 1,
  company_name text,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  dl_account text,
  master_elite boolean not null default true,
  sales_tax_rate numeric not null default 0,
  only_tax_material boolean not null default true,
  labor_display text not null default 'man_hours' check (labor_display in ('man_hours','man_days')),
  hours_per_man_day numeric not null default 9,
  shipping_method text not null default 'stepped' check (shipping_method in ('stepped','percent')),
  shipping_percent numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint company_settings_singleton check (id = 1)
);

-- 2. Stepped shipping table --------------------------------------------------
create table if not exists public.shipping_steps (
  id uuid primary key default gen_random_uuid(),
  material_threshold numeric not null,   -- 0 represents the "Minimum" row
  shipping_cost numeric not null default 0,
  sort integer not null default 0
);

-- 3. Labor & markup presets --------------------------------------------------
create table if not exists public.markup_options (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hourly_rate numeric not null default 0,
  markup_amount numeric not null default 0,
  markup_type text not null default 'gross_profit'
    check (markup_type in ('dollar_manday','percent_cost','gross_profit')),
  include_per_diem boolean not null default false,
  include_commission boolean not null default false,
  is_default boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- 4. Warranties --------------------------------------------------------------
create table if not exists public.warranties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_per_sqft numeric not null default 0,
  non_master_elite_surcharge numeric not null default 0,
  sort integer not null default 0
);

-- 5. High-wind upcharges -----------------------------------------------------
create table if not exists public.high_wind_upcharges (
  id uuid primary key default gen_random_uuid(),
  term_years integer not null,
  wind_band text not null,
  mech_per_sqft numeric not null default 0,
  adhered_per_sqft numeric not null default 0,
  sort integer not null default 0
);

-- 6. Estimator commission lives on the user profile --------------------------
alter table public.profiles add column if not exists commission_pct numeric not null default 0;

-- updated_at trigger for settings
drop trigger if exists update_company_settings_updated_at on public.company_settings;
create trigger update_company_settings_updated_at
before update on public.company_settings
for each row execute function public.update_updated_at_column();

-- RLS: any signed-in user may READ (estimators need settings to price bids);
-- only admins may WRITE. No anon access.
do $$
declare t text;
begin
  foreach t in array array[
    'company_settings','shipping_steps','markup_options','warranties','high_wind_upcharges'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true);', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', t||'_write', t);
  end loop;
end $$;

-- ---- Prefill (only when empty, so re-runs never duplicate) -----------------
insert into public.company_settings (id, company_name, address, city, state, zip, phone, dl_account,
  master_elite, sales_tax_rate, only_tax_material, labor_display, hours_per_man_day, shipping_method, shipping_percent)
select 1, 'JBK, Inc', 'PO Box 466', 'Corbin', 'KY', '40702', '888-317-7003', '495000',
  true, 0.0625, true, 'man_hours', 9, 'stepped', 0
where not exists (select 1 from public.company_settings);

insert into public.shipping_steps (material_threshold, shipping_cost, sort)
select * from (values
  (0::numeric, 800::numeric, 0), (5001,975,1), (7500,1050,2), (10000,1100,3), (15001,1200,4),
  (20001,1300,5), (40001,2000,6), (80001,2600,7), (120001,3300,8), (170000,4000,9)
) v(material_threshold, shipping_cost, sort)
where not exists (select 1 from public.shipping_steps);

insert into public.markup_options (name, hourly_rate, markup_amount, markup_type, include_per_diem, include_commission, is_default, sort)
select 'Default', 45, 35, 'gross_profit', false, false, true, 0
where not exists (select 1 from public.markup_options);

insert into public.warranties (name, price_per_sqft, non_master_elite_surcharge, sort)
select * from (values
  ('10 Yr Ballast',0::numeric,0::numeric,0), ('10 Yr International',0,0,1), ('10 Yr Material Only',0,0,2),
  ('15 + 5 Yr Material & Labor',0.18,0.03,3), ('15 + 5 Yr Material Only',0.08,0.03,4),
  ('15 Yr Hail',0.13,0,5), ('15 Yr Hail & High Wind',0.13,0,6), ('15 Yr High Wind',0,0,7),
  ('15 Yr International',0,0,8), ('15 Yr Material Only',0,0,9), ('15 Yr NDL',0,0,10),
  ('15 Yr Residential',0,0,11), ('20 Yr High Wind',0.13,0,12), ('20 Yr Material Only',0,0,13),
  ('20 Yr NDL',0.13,0,14), ('20 Yr Pro-Rated',0,0,15)
) v(name, price_per_sqft, non_master_elite_surcharge, sort)
where not exists (select 1 from public.warranties);

insert into public.high_wind_upcharges (term_years, wind_band, mech_per_sqft, adhered_per_sqft, sort)
select * from (values
  (15,'55-72',0::numeric,0::numeric,0),(15,'73-80',0.07,0.08,1),(15,'81-90',0.09,0.10,2),
  (15,'91-100',0.11,0.12,3),(15,'101-110',0.13,0.14,4),(15,'111-120',0.15,0.16,5),
  (20,'55-72',0,0,6),(20,'73-80',0.09,0.10,7),(20,'81-90',0.11,0.12,8),
  (20,'91-100',0.13,0.14,9),(20,'101-110',0.15,0.16,10),(20,'111-120',0.17,0.18,11)
) v(term_years, wind_band, mech_per_sqft, adhered_per_sqft, sort)
where not exists (select 1 from public.high_wind_upcharges);
