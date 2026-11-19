-- Roof Care, the owner's go of Nov 19 on three things:
--
--   1. How the customer pays is said at the sign-up: "the payment needs to be by check or card
--      either one during sign up". The plan keeps the choice and a note (a check's number).
--   2. The refund when a plan ends early: "a share for inspections not done, if we did one half
--      is refunded", and "i like the repairs coming off a refund rule". The share of what was
--      paid for the inspections not done, less the minor repairs the plan already covered, never
--      below nothing. A manager confirms the amount when ending the plan; it stays on the plan
--      until it is marked sent.
--   3. Roof Guard's leak calls: "two leak calls with the credit subtracting until it reaches 0
--      and on those two leak calls travel is not charged? then after that it is". The plan
--      keeps how many calls a year have no travel charge (from the price setup, as it keeps its
--      minor repairs allowance). A repair invoice carries one line that takes its travel off,
--      and the database lets no more invoices carry one than the plan has calls.

-- 1. The plan ---------------------------------------------------------------------------------
alter table public.roof_care_plans
  add column if not exists pay_method text,
  add column if not exists pay_note text,
  add column if not exists free_travel_calls integer not null default 0,
  add column if not exists refund_due numeric,
  add column if not exists refund_worked jsonb,
  add column if not exists refund_sent_on date,
  add column if not exists refund_ref text;

alter table public.roof_care_plans
  drop constraint if exists roof_care_plans_pay_method_check;
alter table public.roof_care_plans
  add constraint roof_care_plans_pay_method_check
  check (pay_method is null or pay_method in ('check', 'card'));
alter table public.roof_care_plans
  drop constraint if exists roof_care_plans_free_travel_calls_check;
alter table public.roof_care_plans
  add constraint roof_care_plans_free_travel_calls_check
  check (free_travel_calls between 0 and 24);
alter table public.roof_care_plans
  drop constraint if exists roof_care_plans_refund_due_check;
alter table public.roof_care_plans
  add constraint roof_care_plans_refund_due_check
  check (refund_due is null or refund_due >= 0);

-- 2. The invoice: whether its travel is one of the plan's leak calls --------------------------
alter table public.invoices
  add column if not exists care_travel_choice text;
alter table public.invoices
  drop constraint if exists invoices_care_travel_choice_check;
alter table public.invoices
  add constraint invoices_care_travel_choice_check
  check (care_travel_choice is null or care_travel_choice in ('auto', 'declined'));

-- 3. The sign-up keeps how they pay, and the plan's leak calls ---------------------------------
drop function if exists public.roof_care_sign_up_await_payment(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text);

create or replace function public.roof_care_sign_up_await_payment(
  p_site uuid, p_plan text, p_sqft numeric, p_hours numeric, p_miles numeric,
  p_estimated boolean, p_first text, p_days integer, p_agreed_by text, p_notes text, p_terms text,
  p_pay_method text default null, p_pay_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_site public.crm_sites%rowtype;
  v_price jsonb;
  v_row jsonb;
  v_plan uuid;
  v_name text;
  v_allowance numeric;
  v_calls integer;
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
  if exists (select 1 from public.roof_care_plans
              where site_id = p_site and status = 'active') then
    raise exception 'This property already has a Roof Care plan';
  end if;
  if exists (select 1 from public.roof_care_plans
              where site_id = p_site and status = 'awaiting_payment') then
    raise exception 'This property already has a Roof Care plan waiting to be paid';
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
  if p_pay_method is not null and p_pay_method not in ('check', 'card') then
    raise exception 'Pick how they are paying: by check or by card';
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

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  -- What the plan includes, as the price setup has it today: the minor repairs allowance, and
  -- for Roof Guard the leak calls a year with no travel charge.
  select coalesce(nullif(s.data->'plans'->p_plan->>'allowance', '')::numeric, 0),
         case when p_plan = 'guard'
              then least(greatest(round(coalesce(
                     nullif(s.data->>'guard_leak_calls', '')::numeric, 0))::integer, 0), 24)
              else 0 end
    into v_allowance, v_calls
    from public.roof_care_settings s
   order by s.updated_at desc nulls last limit 1;
  insert into public.roof_care_plans (
    account_id, site_id, plan, status, pay_first, plan_number, signed_on, renews_on,
    roof_sqft, drive_hours, drive_miles, price_estimated, list_price, travel_price, price,
    first_visit, first_days, agreed_by, sold_by, sold_by_name, notes, terms_version,
    repair_allowance, free_travel_calls, pay_method, pay_note)
  values (
    v_site.account_id, p_site, p_plan, 'awaiting_payment', true,
    nextval('public.roof_care_plan_number_seq')::integer, v_today,
    (v_today + interval '1 year')::date,
    p_sqft, p_hours, p_miles, coalesce(p_estimated, false),
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, (v_row->>'price')::numeric,
    p_first, case when p_first = 'days' then p_days end, trim(p_agreed_by),
    auth.uid(), coalesce(v_name, ''), coalesce(trim(p_notes), ''), trim(p_terms),
    greatest(coalesce(v_allowance, 0), 0), coalesce(v_calls, 0),
    p_pay_method, nullif(trim(coalesce(p_pay_note, '')), ''))
  returning id into v_plan;
  return v_plan;
end;
$function$;

revoke all on function public.roof_care_sign_up_await_payment(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text)
  from public, anon;
grant execute on function public.roof_care_sign_up_await_payment(
  uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text, text)
  to authenticated;

-- 4. The refund ----------------------------------------------------------------------------------
-- The sum itself. Not called by people: the two functions below call it.
create or replace function public.roof_care_refund_worked(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_paid numeric;
  v_done integer;
  v_repairs numeric;
  v_share numeric;
begin
  if not exists (select 1 from public.roof_care_plans where id = p_plan) then
    raise exception 'That plan was not found';
  end if;
  -- What was paid for the plan year: on the plan's own invoice. A plan signed the older way
  -- was never paid for ahead, so there is nothing to give back.
  select coalesce(sum(i.paid_amount), 0) into v_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void';
  -- The two inspections that are done on the roof.
  select count(*) into v_done
    from public.roof_care_visits v
   where v.plan_id = p_plan and v.kind in ('visit1', 'visit2')
     and exists (
       select 1 from public.service_jobs j
        where j.roof_care_visit_id = v.id and j.deleted_at is null
          and j.stage in ('done', 'authorized', 'invoiced', 'closed'));
  v_done := least(v_done, 2);
  -- The minor repairs the plan already covered.
  select coalesce(sum(-l.total), 0) into v_repairs
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-allowance:' || p_plan::text and i.status <> 'void';
  v_repairs := greatest(v_repairs, 0);
  v_share := round(v_paid * (2 - v_done) / 2.0, 2);
  return jsonb_build_object(
    'paid', v_paid,
    'inspections_done', v_done,
    'share', v_share,
    'repairs', v_repairs,
    'refund', greatest(v_share - v_repairs, 0));
end;
$function$;

revoke all on function public.roof_care_refund_worked(uuid) from public, anon, authenticated;

-- What ending the plan today would refund, for the people who handle invoices.
create or replace function public.roof_care_refund(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null
     or not (public.is_admin() or public.is_manager() or public.is_sales_pm())
  then
    raise exception 'Only the office sees a plan''s refund' using errcode = '42501';
  end if;
  return public.roof_care_refund_worked(p_plan);
end;
$function$;

revoke all on function public.roof_care_refund(uuid) from public, anon;
grant execute on function public.roof_care_refund(uuid) to authenticated;

-- A manager ends the plan and confirms the refund. Left out, the worked amount is taken. (The
-- amount has a default so a call that leaves it out still finds the function: seen in the
-- browser run, where ending a plan with the box left blank was refused.)
create or replace function public.roof_care_end_refund(
  p_plan uuid, p_reason text, p_refund numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_worked jsonb;
  v_amount numeric;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager ends a Roof Care plan' using errcode = '42501';
  end if;
  -- Worked before the plan ends: ending it removes an unpaid invoice.
  v_worked := public.roof_care_refund_worked(p_plan);
  v_amount := round(coalesce(p_refund, (v_worked->>'refund')::numeric), 2);
  if v_amount < 0 then
    raise exception 'A refund cannot be less than nothing';
  end if;
  if v_amount > (v_worked->>'paid')::numeric then
    raise exception 'The refund cannot be more than the $% that was paid.',
      trim(to_char((v_worked->>'paid')::numeric, '999,999,990.00'));
  end if;
  perform public.roof_care_end(p_plan, p_reason);
  update public.roof_care_plans
     set refund_due = v_amount,
         refund_worked = v_worked || jsonb_build_object('confirmed', v_amount),
         refund_sent_on = null,
         refund_ref = null,
         updated_at = now()
   where id = p_plan;
  return v_worked || jsonb_build_object('confirmed', v_amount);
end;
$function$;

revoke all on function public.roof_care_end_refund(uuid, text, numeric) from public, anon;
grant execute on function public.roof_care_end_refund(uuid, text, numeric) to authenticated;

-- The refund was sent to the customer.
create or replace function public.roof_care_refund_sent(p_plan uuid, p_on date, p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null
     or not (public.is_admin() or public.is_manager() or public.is_sales_pm())
  then
    raise exception 'Only the office marks a refund sent' using errcode = '42501';
  end if;
  if p_on is null or p_on > (now() at time zone 'America/New_York')::date then
    raise exception 'Pick the day the refund was sent, today or earlier';
  end if;
  update public.roof_care_plans
     set refund_sent_on = p_on,
         refund_ref = nullif(trim(coalesce(p_ref, '')), ''),
         updated_at = now()
   where id = p_plan and status = 'ended'
     and coalesce(refund_due, 0) > 0 and refund_sent_on is null;
  if not found then
    raise exception 'That plan has no refund waiting to be sent';
  end if;
end;
$function$;

revoke all on function public.roof_care_refund_sent(uuid, date, text) from public, anon;
grant execute on function public.roof_care_refund_sent(uuid, date, text) to authenticated;

-- 5. A plan's lines on invoices: the leak call line joins the two that were there -------------
create or replace function public.invoice_lines_care_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_other text;
  v_plan uuid;
  v_allow numeric;
  v_used numeric;
  v_calls integer;
  v_n integer;
begin
  if new.source is null or new.source not like 'roof-care%' then
    return new;
  end if;
  if new.source like 'roof-care:%' then
    select coalesce(i.display_number, '') into v_other
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and l.invoice_id <> new.invoice_id and i.status <> 'void'
     limit 1;
    if found then
      raise exception 'This inspection''s share of the plan is already on invoice #%. It is billed once.', v_other;
    end if;
    return new;
  end if;
  if new.source like 'roof-care-allowance:%' then
    begin
      v_plan := substring(new.source from 21)::uuid;
    exception when others then
      raise exception 'This allowance line does not name a Roof Care plan';
    end;
    select p.repair_allowance into v_allow
      from public.roof_care_plans p where p.id = v_plan for update;
    if not found then
      raise exception 'The Roof Care plan of this allowance line was not found';
    end if;
    if new.total > 0 then
      raise exception 'A plan allowance line takes money off the invoice. It cannot add to it.';
    end if;
    select coalesce(sum(-l.total), 0) into v_used
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and i.status <> 'void' and l.id is distinct from new.id;
    if v_used - new.total > v_allow + 0.005 then
      raise exception 'Only $% of this plan''s minor repairs allowance is left.',
        trim(to_char(greatest(v_allow - v_used, 0), '999,999,990.00'));
    end if;
  end if;
  -- A leak call with no travel charge: no more invoices carry the line than the plan has calls.
  if new.source like 'roof-care-travel:%' then
    begin
      v_plan := substring(new.source from 18)::uuid;
    exception when others then
      raise exception 'This leak call line does not name a Roof Care plan';
    end;
    select p.free_travel_calls into v_calls
      from public.roof_care_plans p where p.id = v_plan for update;
    if not found then
      raise exception 'The Roof Care plan of this leak call line was not found';
    end if;
    if new.total > 0 then
      raise exception 'A leak call line takes the travel off the invoice. It cannot add to it.';
    end if;
    select count(distinct l.invoice_id) into v_n
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and i.status <> 'void' and l.invoice_id <> new.invoice_id;
    if v_n >= coalesce(v_calls, 0) then
      raise exception 'This plan''s leak calls with no travel charge are used: % of %.',
        v_n, coalesce(v_calls, 0);
    end if;
  end if;
  return new;
end;
$function$;
