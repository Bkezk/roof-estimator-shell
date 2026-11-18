-- Roof Care plans: the terms the customer agreed to, and the new name of the button (owner,
-- Nov 18: "i like all 10 you came up with"; "lets have the two buttons Care Plan and
-- Additional Services").
--
--   - roof_care_plans.terms_version: which set of terms was agreed at sign-up. The terms
--     themselves are in the code (src/lib/roof-care-plan.ts ROOF_CARE_TERMS), dated.
--   - roof_care_sign_up takes the terms as its last argument and refuses a sign-up without
--     them. The older ten-argument form is dropped: nothing published calls it.
--   - The message for a care plan ticket dragged past its last day names the Care Plan button.
--
-- Safe to run twice.
alter table public.roof_care_plans add column if not exists terms_version text;

drop function if exists public.roof_care_sign_up(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text);

create or replace function public.roof_care_sign_up(
  p_site uuid,
  p_plan text,
  p_sqft numeric,
  p_hours numeric,
  p_miles numeric,
  p_estimated boolean,
  p_first text,
  p_days integer,
  p_agreed_by text,
  p_notes text,
  p_terms text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_site public.crm_sites%rowtype;
  v_price jsonb;
  v_row jsonb;
  v_plan uuid;
  v_from date; v_by date;
  v2_from date; v2_by date;
  v_renews date;
  v_name text;
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
    raise exception 'You can sign up a property you have a ticket at' using errcode = '42501';
  end if;
  if p_plan is null or p_plan not in ('watch', 'care', 'guard') then
    raise exception 'Pick the plan';
  end if;
  if exists (select 1 from public.roof_care_plans where site_id = p_site and status = 'active') then
    raise exception 'This property already has a Roof Care plan';
  end if;
  if coalesce(trim(p_agreed_by), '') = '' then
    raise exception 'Type the name of the person who agreed to the plan';
  end if;
  if coalesce(trim(p_terms), '') = '' then
    raise exception 'The customer has to agree to the plan''s terms';
  end if;
  if p_first is null or p_first not in ('now', 'days', 'window') then
    raise exception 'Pick when the first inspection is';
  end if;
  if p_first = 'days' and (p_days is null or p_days < 1 or p_days > 365) then
    raise exception 'Type how many days to push the first inspection back (1 to 365)';
  end if;
  if p_hours is null or p_miles is null then
    raise exception 'The drive to this address has not been worked out, so there is no price yet';
  end if;
  v_price := public.roof_care_price(p_sqft, p_hours, p_miles);
  if not coalesce((v_price->>'ready')::boolean, false) then
    raise exception 'The Roof Care plan prices are not set up yet. Ask an admin.';
  end if;
  if coalesce((v_price->>'custom_quote')::boolean, false) then
    raise exception 'A roof this size gets a custom quote. Call the office.';
  end if;
  select e into v_row from jsonb_array_elements(v_price->'plans') e where e->>'plan' = p_plan;

  -- The first inspection: today, in so many days, or in the next window to open.
  if p_first = 'now' then
    v_from := v_today; v_by := v_today;
  elsif p_first = 'days' then
    v_from := v_today + p_days; v_by := v_from;
  else
    select w.w_from, w.w_to into v_from, v_by
      from public.roof_care_windows(v_today) w
     where w.w_from > v_today
     order by w.w_from limit 1;
  end if;
  -- The second: the first window still open four months after the first, and inside the plan
  -- year when it fits. When it cannot fit, the plan year runs on to it.
  v_renews := (v_today + interval '1 year')::date;
  select greatest(w.w_from, v_from + 120), w.w_to into v2_from, v2_by
    from public.roof_care_windows(v_from + 120) w
   order by w.w_from limit 1;
  if v2_from <= v_renews then
    v2_by := least(v2_by, v_renews);
  else
    v_renews := v2_by;
  end if;

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  insert into public.roof_care_plans (
    account_id, site_id, plan, signed_on, renews_on, roof_sqft, drive_hours, drive_miles,
    price_estimated, list_price, travel_price, price, first_visit, agreed_by,
    sold_by, sold_by_name, notes, terms_version)
  values (
    v_site.account_id, p_site, p_plan, v_today, v_renews, p_sqft, p_hours, p_miles,
    coalesce(p_estimated, false),
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, (v_row->>'price')::numeric,
    p_first, trim(p_agreed_by), auth.uid(), coalesce(v_name, ''), coalesce(trim(p_notes), ''),
    trim(p_terms))
  returning id into v_plan;
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (v_plan, 'visit1', v_from, v_by, v_by, (v_row->>'visit1')::numeric),
         (v_plan, 'visit2', v2_from, v2_by, v2_by, (v_row->>'visit2')::numeric);
  perform public.roof_care_make_tickets(v_plan);
  return v_plan;
end;
$$;
revoke all on function public.roof_care_sign_up(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text) from public, anon;
grant execute on function public.roof_care_sign_up(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text) to authenticated;

create or replace function public.service_jobs_care_plan_rule()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_by date;
  v_person boolean := auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role';
begin
  if v_person
     and coalesce(current_setting('jbk.care_link', true), '') <> 'on'
     and ((tg_op = 'INSERT' and new.roof_care_visit_id is not null)
          or (tg_op = 'UPDATE' and new.roof_care_visit_id is distinct from old.roof_care_visit_id))
  then
    raise exception 'A care plan inspection is linked to its plan by the site' using errcode = '42501';
  end if;
  if new.roof_care_visit_id is not null and new.scheduled_date is not null
     and (tg_op = 'INSERT' or new.scheduled_date is distinct from old.scheduled_date)
  then
    select due_by into v_by from public.roof_care_visits where id = new.roof_care_visit_id;
    if v_by is not null and new.scheduled_date > v_by then
      raise exception 'This Roof Care plan inspection is due by %. To move it later, press Care Plan on the ticket and push it back.',
        to_char(v_by, 'Mon FMDD, YYYY');
    end if;
  end if;
  return new;
end;
$$;
