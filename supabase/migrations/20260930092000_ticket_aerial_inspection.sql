-- Ticket aerial view with markup, and inspection tickets (owner, Sep 30). Idempotent.
--
-- A. Aerial: the property's aerial on a ticket, annotated by the tech. Saving stores a PNG
--    snapshot as a service_job_photos row with role 'aerial' and the vector annotations as JSON
--    on that row (annotations), so the markup re-opens for editing. Two read-only lookups find
--    the building for a ticket's address in our map data (buildings, address_points), for
--    anyone with Service access (those tables' own RLS is Prospecting / Estimate only).
-- B. Inspections: the checklist (inspection_checklist_items, admin-edited), the answers on the
--    ticket (service_jobs.inspection), and the link from a repair ticket back to the inspection
--    it came from (service_jobs.from_job_id).

-- ── A. Aerial ─────────────────────────────────────────────────────────────────────────────

alter table public.service_job_photos drop constraint if exists service_job_photos_role_check;
alter table public.service_job_photos add constraint service_job_photos_role_check
  check (role in ('before','after','other','signature','aerial'));
alter table public.service_job_photos add column if not exists annotations jsonb;
create index if not exists service_job_photos_job_role_idx
  on public.service_job_photos (service_job_id, role, created_at desc);

-- Address lookups: a prefix on the upper-cased address (the house number) is indexable.
create index if not exists address_points_address_prefix_idx
  on public.address_points (upper(address) text_pattern_ops);
create index if not exists buildings_address1_prefix_idx
  on public.buildings (upper(address1) text_pattern_ops) where deleted_at is null;

-- Buildings and 911 points whose address starts with the house number and contains the street
-- word (both checked by the caller to be letters / digits only). The caller scores them
-- (src/lib/aerial-address.ts).
create or replace function public.service_aerial_address_candidates(
  p_house text, p_street_word text, p_limit integer default 60
)
returns table (
  source text, id uuid, address text, city text, zip text, state text,
  lat double precision, lng double precision, building_id uuid
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_access('service') or public.has_access('customers')
          or public.has_access('prospect') or public.has_access('estimate')) then
    raise exception 'Forbidden: Service access required';
  end if;
  if coalesce(p_house, '') !~ '^[0-9]{1,7}[A-Za-z]?$'
     or coalesce(p_street_word, '') !~ '^[A-Za-z0-9]{2,40}$' then
    return;
  end if;
  return query
    (select 'building'::text, b.id, b.address1, b.city, b.zip, b.state,
            b.centroid_lat, b.centroid_lng, b.id
       from public.buildings b
      where b.deleted_at is null
        and upper(b.address1) like upper(p_house) || ' %'
        and upper(b.address1) like '%' || upper(p_street_word) || '%'
      limit greatest(1, least(p_limit, 200)))
    union all
    (select 'point'::text, a.id, a.address, a.city, a.zip, null::text,
            a.lat, a.lng, a.building_id
       from public.address_points a
      where upper(a.address) like upper(p_house) || ' %'
        and upper(a.address) like '%' || upper(p_street_word) || '%'
      limit greatest(1, least(p_limit, 200)));
end;
$$;
revoke all on function public.service_aerial_address_candidates(text, text, integer) from public;
grant execute on function public.service_aerial_address_candidates(text, text, integer) to authenticated;

-- Stored buildings whose centre lies within p_radius_m of a point (centroid box; the caller
-- tests the outlines), with their footprints.
create or replace function public.service_aerial_buildings_near(
  p_lat double precision, p_lng double precision, p_radius_m double precision default 300
)
returns table (
  id uuid, address1 text, city text, state text, zip text,
  centroid_lat double precision, centroid_lng double precision,
  roof_sqft numeric, footprint jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  r double precision := greatest(10, least(coalesce(p_radius_m, 300), 1000));
  dlat double precision := r / 111320.0;
  dlng double precision := r / (111320.0 * greatest(cos(radians(p_lat)), 0.01));
begin
  if not (public.has_access('service') or public.has_access('customers')
          or public.has_access('prospect') or public.has_access('estimate')) then
    raise exception 'Forbidden: Service access required';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    return;
  end if;
  return query
    select b.id, b.address1, b.city, b.state, b.zip, b.centroid_lat, b.centroid_lng,
           b.roof_sqft::numeric, b.footprint::jsonb
      from public.buildings b
     where b.deleted_at is null
       and b.centroid_lat between p_lat - dlat and p_lat + dlat
       and b.centroid_lng between p_lng - dlng and p_lng + dlng
     limit 200;
end;
$$;
revoke all on function public.service_aerial_buildings_near(double precision, double precision, double precision) from public;
grant execute on function public.service_aerial_buildings_near(double precision, double precision, double precision) to authenticated;

-- ── B. Inspections ────────────────────────────────────────────────────────────────────────

alter table public.service_jobs
  add column if not exists inspection jsonb,
  add column if not exists from_job_id uuid references public.service_jobs(id) on delete set null;
create index if not exists service_jobs_from_job_idx on public.service_jobs (from_job_id)
  where from_job_id is not null;

create table if not exists public.inspection_checklist_items (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inspection_checklist_items_sort_idx
  on public.inspection_checklist_items (sort, label);
drop trigger if exists inspection_checklist_items_updated_at on public.inspection_checklist_items;
create trigger inspection_checklist_items_updated_at before update on public.inspection_checklist_items
  for each row execute function public.update_updated_at_column();
alter table public.inspection_checklist_items enable row level security;
drop policy if exists inspection_checklist_items_read on public.inspection_checklist_items;
create policy inspection_checklist_items_read on public.inspection_checklist_items
  for select to authenticated
  using (public.has_access('service') or public.has_access('customers') or public.is_admin());
-- Edited where the service settings are (Admin › Service Rates): admins and Estimate Pricing,
-- as service_settings.
drop policy if exists inspection_checklist_items_write on public.inspection_checklist_items;
create policy inspection_checklist_items_write on public.inspection_checklist_items
  for all to authenticated
  using (public.is_admin() or public.has_access('pricing'))
  with check (public.is_admin() or public.has_access('pricing'));

insert into public.inspection_checklist_items (label, sort)
select v.label, v.sort from (values
  ('Membrane condition', 10),
  ('Seams', 20),
  ('Flashings', 30),
  ('Drains/scuppers', 40),
  ('Penetrations', 50),
  ('Parapets/coping', 60),
  ('Ponding', 70),
  ('Debris', 80),
  ('Sealants', 90),
  ('Recommend repairs', 100)
) as v(label, sort)
where not exists (select 1 from public.inspection_checklist_items);
