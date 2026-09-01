-- Phase 2 (part 2a): Labor engines — Setup, Inspection, Templates, Curb.
-- Idempotent. RLS: authenticated read, admin-only write.

create table if not exists public.labor_setup (
  id integer primary key default 1,
  minimum_hours numeric not null default 16,
  constraint labor_setup_singleton check (id = 1)
);
create table if not exists public.labor_setup_steps (
  id uuid primary key default gen_random_uuid(),
  sqft numeric not null, multiplier numeric not null default 0, sort integer not null default 0
);
create table if not exists public.labor_inspection_steps (
  id uuid primary key default gen_random_uuid(),
  sqft numeric not null, hours numeric not null default 0, sort integer not null default 0
);
create table if not exists public.labor_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null, is_default boolean not null default false, sort integer not null default 0
);
create table if not exists public.labor_template_adjustments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.labor_templates(id) on delete cascade,
  area text not null, value numeric not null default 0, sort integer not null default 0
);
create table if not exists public.labor_curb (
  id integer primary key default 1,
  setup_minutes numeric not null default 8,
  constraint labor_curb_singleton check (id = 1)
);
create table if not exists public.labor_curb_deck (
  id uuid primary key default gen_random_uuid(),
  deck_type text not null, minutes numeric not null default 0, sort integer not null default 0
);
create table if not exists public.labor_curb_type (
  id uuid primary key default gen_random_uuid(),
  curb_type text not null, multiplier numeric not null default 1, sort integer not null default 0
);

do $$
declare t text;
begin
  foreach t in array array['labor_setup','labor_setup_steps','labor_inspection_steps',
    'labor_templates','labor_template_adjustments','labor_curb','labor_curb_deck','labor_curb_type'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true);', t||'_read', t);
    execute format('drop policy if exists %I on public.%I;', t||'_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', t||'_write', t);
  end loop;
end $$;

-- Prefill (only when empty) --------------------------------------------------
insert into public.labor_setup (id, minimum_hours) select 1, 16 where not exists (select 1 from public.labor_setup);
insert into public.labor_setup_steps (sqft, multiplier, sort)
select * from (values (6000::numeric,0.003::numeric,0),(20000,0.003,1),(100000,0.003,2)) v(a,b,c)
where not exists (select 1 from public.labor_setup_steps);

insert into public.labor_inspection_steps (sqft, hours, sort)
select * from (values (0::numeric,5::numeric,0),(5001,7,1),(10001,10,2),(20001,13,3),(50001,16,4),(100001,19,5),(150001,23,6)) v(a,b,c)
where not exists (select 1 from public.labor_inspection_steps);

with tpl as (
  insert into public.labor_templates (name, is_default, sort)
  select 'Standard', true, 0 where not exists (select 1 from public.labor_templates)
  returning id
)
insert into public.labor_template_adjustments (template_id, area, value, sort)
select tpl.id, a.area, 0, a.sort from tpl, (values
  ('Roof Section Labor',0),('Underlayment Labor',1),('Curbs Labor',2),('Parapets Labor',3),
  ('Tear-Off Labor',4),('Pipe Stacks Labor',5),('Drains Labor',6),('Setup Time Labor',7),
  ('Inspection Time Labor',8),('Edge Termination Labor',9)
) a(area, sort);

insert into public.labor_curb (id, setup_minutes) select 1, 8 where not exists (select 1 from public.labor_curb);
insert into public.labor_curb_deck (deck_type, minutes, sort)
select * from (values ('Wood',7.5::numeric,0),('Structural Metal',7.5,1),('Metal Retrofit',7.5,2),
  ('Concrete',10.5,3),('Gypsum',10.5,4),('LWC over Steel',7.5,5),('LWC over Concrete',10.5,6),
  ('LWC over Other',9,7),('Tectum',7.5,8),('Purlin Fastened',7.5,9)) v(a,b,c)
where not exists (select 1 from public.labor_curb_deck);
insert into public.labor_curb_type (curb_type, multiplier, sort)
select * from (values ('Open',1.1::numeric,0),('Closed',1,1),('Closed w/ Top',1.1,2),('Scupper',4,3),('Metal Scupper',3,4)) v(a,b,c)
where not exists (select 1 from public.labor_curb_type);
