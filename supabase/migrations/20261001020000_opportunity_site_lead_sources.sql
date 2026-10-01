-- Opportunities (owner, Oct 1): the property (site) an opportunity is for, and the lead source as
-- a maintained list. Idempotent.
--
-- 1. crm_opportunities.site_id: the customer's site. Optional in the table (a prospect may not be
--    a customer yet); the app requires it when the customer is set and has more than one site,
--    and fills it when the customer has exactly one (opportunities.functions.ts saveOpportunity).
-- 2. lead_sources: the list the opportunity's Lead source box picks from (Settings › General ›
--    Lead sources). crm_opportunities.lead_source stays a text column holding the chosen name,
--    so old rows and reports keep working; there is no foreign key. Any signed-in user reads the
--    list; admins and Estimate Pricing edit it (as county_codes); anyone with Customers access
--    (who saves opportunities) may add a name from the opportunity form ("type to add").

alter table public.crm_opportunities
  add column if not exists site_id uuid references public.crm_sites(id) on delete set null;
create index if not exists crm_opportunities_site_idx on public.crm_opportunities (site_id);

create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_sources_sort_idx on public.lead_sources (sort, name);

drop trigger if exists lead_sources_updated_at on public.lead_sources;
create trigger lead_sources_updated_at before update on public.lead_sources
  for each row execute function public.update_updated_at_column();

alter table public.lead_sources enable row level security;
drop policy if exists lead_sources_read on public.lead_sources;
create policy lead_sources_read on public.lead_sources for select to authenticated
  using (true);
drop policy if exists lead_sources_write on public.lead_sources;
create policy lead_sources_write on public.lead_sources for all to authenticated
  using (public.is_admin() or public.has_access('pricing'))
  with check (public.is_admin() or public.has_access('pricing'));
-- Type-to-add on the opportunity form: the same access that saves an opportunity (Customers).
drop policy if exists lead_sources_add on public.lead_sources;
create policy lead_sources_add on public.lead_sources for insert to authenticated
  with check (public.has_access('customers'));

-- How many live opportunities use a name (any case), for the "in use" refusal on delete.
-- SECURITY DEFINER so an Estimate Pricing user without Customers access gets the true count.
create or replace function public.lead_source_use_count(p_name text)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.crm_opportunities
   where deleted_at is null
     and lower(btrim(lead_source)) = lower(btrim(p_name));
$$;
revoke all on function public.lead_source_use_count(text) from public;
grant execute on function public.lead_source_use_count(text) to authenticated;

-- Rename a list entry and the opportunities that carry its old name (the text column), so a
-- corrected spelling reaches every row. Admins and Estimate Pricing only; SECURITY DEFINER so a
-- Pricing user without Customers access still updates every opportunity. Returns how many
-- opportunities changed.
create or replace function public.rename_lead_source(p_id uuid, p_name text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_new text := btrim(coalesce(p_name, ''));
  v_count integer;
begin
  if not (public.is_admin() or public.has_access('pricing')) then
    raise exception 'Forbidden: Estimate Pricing access required';
  end if;
  if v_new = '' then
    raise exception 'The lead source needs a name';
  end if;
  select name into v_old from public.lead_sources where id = p_id;
  if v_old is null then
    raise exception 'Lead source not found';
  end if;
  update public.lead_sources set name = v_new where id = p_id;
  update public.crm_opportunities set lead_source = v_new
   where lower(btrim(lead_source)) = lower(btrim(v_old))
     and lead_source is distinct from v_new;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.rename_lead_source(uuid, text) from public;
grant execute on function public.rename_lead_source(uuid, text) to authenticated;

-- The owner's starting list (src/lib/lead-sources.ts LEAD_SOURCE_SEED). A name already present
-- (or since renamed back) is left alone.
insert into public.lead_sources (name, sort)
values
  ('Referral', 10),
  ('Website', 20),
  ('Cold call', 30),
  ('Storm', 40),
  ('Bid board', 50),
  ('Existing customer', 60)
on conflict (name) do nothing;
