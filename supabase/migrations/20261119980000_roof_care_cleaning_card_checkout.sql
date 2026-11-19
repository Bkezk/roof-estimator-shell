-- Roof Care: four things the owner said "go" on, Nov 19, night.
--
--   1. The cleaning a plan includes is recorded at each inspection (drains and scuppers for Roof
--      Care and Roof Guard, gutters for Roof Guard), and the yearly budget forecast is marked
--      sent. Until now the site kept neither.
--   2. A refund of a year that was paid by card is less the card fee on what is refunded: the
--      card company keeps its fee whether or not the money goes back. The fee's rate is two of
--      the plan settings (card_fee_pct, card_fee_flat); blank takes nothing off.
--   3. A card payment taken online is recorded on the plan and starts it
--      (roof_care_card_paid). Only the server's own key can call it: the payment processor's
--      signed message is checked first (src/routes/api.stripe.webhook.ts).

alter table public.roof_care_visits
  add column if not exists drains_cleaned boolean,
  add column if not exists gutters_cleaned boolean,
  add column if not exists cleaning_note text,
  add column if not exists cleaning_by_name text,
  add column if not exists cleaning_at timestamptz;

comment on column public.roof_care_visits.drains_cleaned is
  'Were the drains and scuppers cleaned at this inspection: null until it is answered.';

alter table public.roof_care_plans
  add column if not exists forecast_sent_on date,
  add column if not exists forecast_sent_by_name text,
  add column if not exists card_paid_on date,
  add column if not exists card_paid_amount numeric,
  add column if not exists card_paid_ref text;

-- 1a. The cleaning at an inspection ---------------------------------------------------------------
create or replace function public.roof_care_set_cleaning(
  p_visit uuid,
  p_drains boolean default null,
  p_gutters boolean default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v record;
  v_name text;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select vi.id, vi.kind, vi.cleaning_note, p.plan, p.site_id into v
    from public.roof_care_visits vi
    join public.roof_care_plans p on p.id = vi.plan_id
   where vi.id = p_visit
     for update of vi;
  if not found then
    raise exception 'That inspection was not found';
  end if;
  -- Whoever may work its ticket: the office, or a technician with a ticket at the property.
  if not (public.has_access('customers')
          or (public.has_access('service')
              and (not public.is_technician() or public.tech_sees_site(v.site_id))))
  then
    raise exception 'That inspection is not yours to answer' using errcode = '42501';
  end if;
  if v.kind = 'storm' then
    raise exception 'A storm inspection has no cleaning with it';
  end if;
  if p_drains is not null and v.plan = 'watch' then
    raise exception 'Roof Watch does not include cleaning the drains';
  end if;
  if p_gutters is not null and v.plan <> 'guard' then
    raise exception 'Only Roof Guard includes cleaning the gutters';
  end if;
  v_note := case when p_note is null then v.cleaning_note else nullif(trim(p_note), '') end;
  if (p_drains is false or p_gutters is false) and v_note is null then
    raise exception 'Type why it was not cleaned';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  update public.roof_care_visits
     set drains_cleaned = coalesce(p_drains, drains_cleaned),
         gutters_cleaned = coalesce(p_gutters, gutters_cleaned),
         cleaning_note = v_note,
         cleaning_by_name = coalesce(v_name, ''),
         cleaning_at = now()
   where id = p_visit;
end;
$function$;

revoke all on function public.roof_care_set_cleaning(uuid, boolean, boolean, text) from public, anon;
grant execute on function public.roof_care_set_cleaning(uuid, boolean, boolean, text) to authenticated;

-- 1b. The yearly budget forecast -----------------------------------------------------------------
create or replace function public.roof_care_forecast_sent(p_plan uuid, p_sent boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office marks the budget forecast' using errcode = '42501';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  update public.roof_care_plans
     set forecast_sent_on = case when coalesce(p_sent, true) then v_today end,
         forecast_sent_by_name = case when coalesce(p_sent, true) then coalesce(v_name, '') end,
         updated_at = now()
   where id = p_plan and plan = 'guard';
  if not found then
    raise exception 'That plan was not found, or it is not Roof Guard: only Roof Guard includes a budget forecast';
  end if;
end;
$function$;

revoke all on function public.roof_care_forecast_sent(uuid, boolean) from public, anon;
grant execute on function public.roof_care_forecast_sent(uuid, boolean) to authenticated;

-- 2. The refund, less the card fee ---------------------------------------------------------------
create or replace function public.roof_care_refund_worked(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  p public.roof_care_plans%rowtype;
  v_paid numeric;
  v_done integer;
  v_storm integer;
  v_repairs numeric;
  v_travel numeric;
  v_share numeric;
  v_before numeric;
  v_card boolean;
  v_pct numeric;
  v_flat numeric;
  v_fee numeric := 0;
begin
  select * into p from public.roof_care_plans where id = p_plan;
  if not found then
    raise exception 'That plan was not found';
  end if;
  select coalesce(sum(i.paid_amount), 0) into v_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void';
  -- A card payment taken online before its invoice was marked paid.
  if v_paid = 0 and p.card_paid_amount is not null then
    v_paid := p.card_paid_amount;
  end if;
  -- The year's two inspections that are done, and the storm inspections that are: a storm
  -- inspection counts as an inspection done. Two at most.
  select count(*) filter (where v.kind in ('visit1', 'visit2')),
         count(*) filter (where v.kind = 'storm')
    into v_done, v_storm
    from public.roof_care_visits v
   where v.plan_id = p_plan and v.kind in ('visit1', 'visit2', 'storm')
     and exists (
       select 1 from public.service_jobs j
        where j.roof_care_visit_id = v.id and j.deleted_at is null
          and j.stage in ('done', 'authorized', 'invoiced', 'closed'));
  v_storm := least(v_storm, greatest(2 - v_done, 0));
  v_done := least(v_done + v_storm, 2);
  select coalesce(sum(-l.total), 0) into v_repairs
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-allowance:' || p_plan::text and i.status <> 'void';
  v_repairs := greatest(v_repairs, 0);
  -- The travel of the plan's leak calls that was not charged.
  select coalesce(sum(-l.total), 0) into v_travel
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-travel:' || p_plan::text and i.status <> 'void';
  v_travel := greatest(v_travel, 0);
  v_share := round(v_paid * (2 - v_done) / 2.0, 2);
  v_before := greatest(v_share - v_repairs - v_travel, 0);
  -- Paid by card: online, or an invoice marked paid by card, or said at the sign-up with no
  -- invoice saying otherwise. The card company keeps its fee on what is sent back.
  v_card := p.card_paid_on is not null
    or exists (select 1 from public.invoices i
                where i.roof_care_plan_id = p_plan and i.status <> 'void'
                  and lower(coalesce(i.paid_method, '')) like '%card%')
    or (p.pay_method = 'card'
        and not exists (select 1 from public.invoices i
                         where i.roof_care_plan_id = p_plan and i.status <> 'void'
                           and coalesce(trim(i.paid_method), '') <> ''));
  if v_card and v_before > 0 then
    select greatest(coalesce(nullif(s.data->>'card_fee_pct', '')::numeric, 0), 0),
           greatest(coalesce(nullif(s.data->>'card_fee_flat', '')::numeric, 0), 0)
      into v_pct, v_flat
      from public.roof_care_settings s
     order by s.updated_at desc nulls last limit 1;
    v_fee := least(v_before, round(v_before * coalesce(v_pct, 0) / 100.0 + coalesce(v_flat, 0), 2));
  end if;
  return jsonb_build_object(
    'paid', v_paid,
    'inspections_done', v_done,
    'storm_counted', v_storm,
    'share', v_share,
    'repairs', v_repairs,
    'travel', v_travel,
    'card_fee', v_fee,
    'refund', v_before - v_fee);
end;
$function$;

revoke all on function public.roof_care_refund_worked(uuid) from public, anon, authenticated;

-- 3. A card payment taken online ------------------------------------------------------------------
-- What happened: 'already' (this payment was recorded before), 'not_waiting' (the plan was not
-- waiting for a payment: recorded, nothing started), 'invoice_paid' (its final invoice is now
-- paid, which starts the plan), 'started' (no final invoice yet: the plan is started, and the
-- office finalises the invoice and marks it paid).
create or replace function public.roof_care_card_paid(
  p_plan uuid,
  p_amount numeric,
  p_ref text,
  p_on date default null
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_on date := least(coalesce(p_on, (now() at time zone 'America/New_York')::date),
                     (now() at time zone 'America/New_York')::date);
  p public.roof_care_plans%rowtype;
  inv public.invoices%rowtype;
  v_has boolean;
  v_expected numeric;
  v_ref text := nullif(trim(coalesce(p_ref, '')), '');
begin
  if v_ref is null then
    raise exception 'A card payment needs its reference';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  if p.card_paid_ref = v_ref then
    return 'already';
  end if;
  select * into inv from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void'
   order by i.created_at desc limit 1;
  v_has := found;
  v_expected := case when v_has and inv.status = 'final'
                     then greatest(inv.total - coalesce(inv.paid_amount, 0), 0)
                     else greatest(p.price - coalesce(p.renewal_credit, 0), 0) end;
  if p.status = 'awaiting_payment' and coalesce(p_amount, 0) < v_expected - 0.005 then
    raise exception 'The card payment of % is less than the % owed for the plan', p_amount, v_expected;
  end if;
  update public.roof_care_plans
     set card_paid_on = v_on, card_paid_amount = p_amount, card_paid_ref = v_ref,
         pay_method = 'card', updated_at = now()
   where id = p_plan;
  if p.status <> 'awaiting_payment' then
    return 'not_waiting';
  end if;
  if v_has and inv.status = 'final' then
    -- Paid in full: the plan starts by the invoice's own rule (invoices_plan_paid).
    update public.invoices
       set status = 'paid', paid_on = v_on, paid_amount = inv.total, paid_method = 'Card',
           paid_ref = left(v_ref, 80), updated_by_name = 'Card payment'
     where id = inv.id;
    return 'invoice_paid';
  end if;
  perform public.roof_care_start(p_plan, v_on);
  return 'started';
end;
$function$;

revoke all on function public.roof_care_card_paid(uuid, numeric, text, date) from public, anon, authenticated;
grant execute on function public.roof_care_card_paid(uuid, numeric, text, date) to service_role;
