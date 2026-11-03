-- Service list reads (owner, Nov 3, service review items 41 and 48).
--
-- 41: the ticket list and the Tech Board showed each property's city and state through a second
-- query on every read (withPlaces, crm_sites by id). The ticket now snapshots them beside
-- site_name / site_address when it is saved, and a property whose city or state is corrected
-- carries the correction to its live tickets (a name change does not: the snapshot name is the
-- design since Oct 1). Filled in for existing tickets. Idempotent.
alter table public.service_jobs add column if not exists site_city text;
alter table public.service_jobs add column if not exists site_state text;
comment on column public.service_jobs.site_city is
  'The property''s city when the ticket was saved (kept in step when the property''s city changes).';
comment on column public.service_jobs.site_state is
  'The property''s state when the ticket was saved (kept in step when the property''s state changes).';

update public.service_jobs j
   set site_city = s.city, site_state = s.state
  from public.crm_sites s
 where s.id = j.site_id
   and (j.site_city is distinct from s.city or j.site_state is distinct from s.state);

create or replace function public.crm_site_place_to_tickets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.city is distinct from old.city or new.state is distinct from old.state then
    update public.service_jobs
       set site_city = new.city, site_state = new.state
     where site_id = new.id and deleted_at is null;
  end if;
  return new;
end; $$;
drop trigger if exists crm_sites_place_to_tickets on public.crm_sites;
create trigger crm_sites_place_to_tickets after update of city, state on public.crm_sites
  for each row execute function public.crm_site_place_to_tickets();

-- 48: the Tech Board's week read filters `deleted_at is null and technician_id is not null and
-- scheduled_date between`; the indexes so far lead on stage or cover the unassigned rows only.
create index if not exists service_jobs_week_idx
  on public.service_jobs (scheduled_date) where deleted_at is null and technician_id is not null;
