-- An additional service asked for on site (owner, Nov 18: "they should be able to sign others up
-- for a plan or additional service and get credit", and "credit is just a name").
--
-- Whoever is at the property, a technician included, types what the customer wants. It becomes an
-- opportunity for the office, with nobody on it yet, and the name of the person who took it down
-- in the new column referred_by. A technician cannot write opportunities, so the function does
-- it for them, for a property they have a ticket at and no other.
--
-- The list of services to tick is not settled (docs/roof-care-plans.md), so the request is typed
-- in words. The public QR form will fill referred_by from its "who referred you" box.
--
-- Safe to run twice.
alter table public.crm_opportunities add column if not exists referred_by text;

create or replace function public.request_additional_service(
  p_site uuid,
  p_services text,
  p_details text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_site public.crm_sites%rowtype;
  v_name text;
  v_days integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_site from public.crm_sites where id = p_site and deleted_at is null;
  if not found or v_site.account_id is null then
    raise exception 'That property was not found';
  end if;
  if not (public.has_access('customers')
          or (public.has_access('service')
              and (not public.is_technician() or public.tech_sees_site(p_site))))
  then
    raise exception 'You can take a request at a property you have a ticket at' using errcode = '42501';
  end if;
  if coalesce(trim(p_services), '') = '' then
    raise exception 'Type what the customer is asking for';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  begin
    v_days := public.opportunity_close_days();
  exception when others then
    v_days := 30;
  end;
  insert into public.crm_opportunities (
    account_id, site_id, title, description, status, lead_source, referred_by,
    expected_close, updated_by_name)
  values (
    v_site.account_id, p_site,
    left('Additional service: ' || regexp_replace(trim(p_services), '\s+', ' ', 'g'), 200),
    nullif(trim(coalesce(p_details, '')), ''),
    'open', 'On-site request', nullif(v_name, ''),
    (now() at time zone 'America/New_York')::date + coalesce(v_days, 30),
    v_name)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.request_additional_service(uuid, text, text) from public, anon;
grant execute on function public.request_additional_service(uuid, text, text) to authenticated;
