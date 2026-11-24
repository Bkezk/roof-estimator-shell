-- Roof Care: a roof size corrected on a plan that is already paid (owner, Nov 24: "1. yes but
-- then build the rest"). The step before this one (20261124980000) corrected the size and kept
-- the price that was paid. Now the plan takes the price of the right size, and the difference
-- is settled:
--
--   a bigger roof    the difference is billed on an invoice of its own, on the plan
--                    (invoices.plan_part = 'size'). The site makes it as a draft right after;
--                    the office finalises it and marks it paid as any invoice.
--   a smaller roof   the difference is owed back. The office sends it and records the day and
--                    the reference (roof_care_size_refund_sent).
--
--   roof_care_plans.size_paid_price   the year's price the customer's payments cover so far.
--                                     Null until a paid plan's size is first corrected. The
--                                     balance is price - size_paid_price: above 0 is owed to
--                                     us, below 0 is owed back.
--   roof_care_plans.size_refunds      each refund sent for a smaller roof: amount, day,
--                                     reference, who.
--   invoices.plan_part                'size' on an invoice for a size difference. The plan
--                                     year's own invoice has none, and stays the only one of
--                                     its kind per plan. One open size invoice per plan.
--
-- The refund worked when a plan ends (roof_care_refund_worked) is from what was paid for the
-- year at its right price: a size refund already sent is no longer paid, and one still owed is
-- settled by itself, in full, not shared out over the inspections.
--
-- Applied on the live database by hand (AGENTS.md).

alter table public.invoices
  add column if not exists plan_part text;

alter table public.invoices
  drop constraint if exists invoices_plan_part_check;
alter table public.invoices
  add constraint invoices_plan_part_check
  check (plan_part is null or (plan_part = 'size' and roof_care_plan_id is not null));

drop index if exists public.invoices_one_live_per_plan;
create unique index invoices_one_live_per_plan
  on public.invoices (roof_care_plan_id)
  where roof_care_plan_id is not null and status <> 'void' and plan_part is null;

create unique index if not exists invoices_one_open_size_per_plan
  on public.invoices (roof_care_plan_id)
  where plan_part = 'size' and status in ('draft', 'final');

alter table public.roof_care_plans
  add column if not exists size_paid_price numeric,
  add column if not exists size_refunds jsonb not null default '[]'::jsonb;

-- A size invoice paid in full: the plan is settled at its price.
create or replace function public.invoices_size_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.plan_part is distinct from 'size' or new.status <> 'paid'
     or (tg_op = 'UPDATE' and old.status = 'paid')
  then
    return null;
  end if;
  update public.roof_care_plans
     set size_paid_price = price, updated_at = now()
   where id = new.roof_care_plan_id and size_paid_price is not null;
  return null;
end;
$function$;

revoke all on function public.invoices_size_paid() from public, anon, authenticated;

drop trigger if exists invoices_size_paid on public.invoices;
create trigger invoices_size_paid
  after insert or update on public.invoices
  for each row execute function public.invoices_size_paid();

-- Correct a plan's roof size, for a plan that waits and for one already paid. Replaces the
-- function of 20261124980000: a plan in force now takes the new price too, and the answer says
-- what is owed (`owed`: above 0 to us, below 0 back to the customer).
create or replace function public.roof_care_correct_size(
  p_plan uuid,
  p_sqft numeric,
  p_shown_price numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_price jsonb;
  v_row jsonb;
  v_name text;
  v_new numeric;
  v_waits boolean;
  v_base numeric;
  v_owed numeric;
  v_change jsonb;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin corrects a plan''s roof size' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  if p.status not in ('awaiting_payment', 'active') then
    raise exception 'This plan has ended, so its roof size is not changed';
  end if;
  if p_sqft is null or p_sqft <= 0 or p_sqft = 'NaN'::numeric or p_sqft > 100000000 then
    raise exception 'Type the roof''s size in square feet: a number above 0';
  end if;
  if round(p_sqft) = round(p.roof_sqft) then
    raise exception 'That is the size the plan already has. To say it is right, press Confirm the roof size.';
  end if;
  v_waits := p.status = 'awaiting_payment';
  -- A renewal's price is last year's rule with a credit worked into it: it is renewed again
  -- at the right size, not re-priced here.
  if v_waits and p.renewed_from is not null then
    raise exception 'This is a renewal waiting to be paid. Cancel the renewal, correct the size on the plan year in force, and renew again.';
  end if;

  v_price := public.roof_care_price(p_sqft, p.drive_hours, p.drive_miles);
  if not coalesce((v_price->>'ready')::boolean, false) then
    raise exception 'The Roof Care plan prices are not set up yet. Ask an admin.';
  end if;
  if coalesce((v_price->>'custom_quote')::boolean, false) then
    raise exception 'A roof this size gets a custom quote, so the plan cannot be priced at it here. End the plan and quote it by hand.';
  end if;
  select e into v_row from jsonb_array_elements(v_price->'plans') e where e->>'plan' = p.plan;
  if v_row is null then
    raise exception 'The price for this plan could not be worked out. Ask an admin.';
  end if;
  v_new := (v_row->>'price')::numeric;
  -- Saved at the price the manager was shown, or not at all.
  if p_shown_price is not null and round(p_shown_price) <> round(v_new) then
    raise exception 'The price changed: at this size the plan is now $%, not the $% shown. Press Show the new price again.',
      trim(to_char(round(v_new), '999,999,990')), trim(to_char(round(p_shown_price), '999,999,990'));
  end if;

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();

  if v_waits then
    if exists (select 1 from public.invoices i
                where i.roof_care_plan_id = p_plan and i.status <> 'void'
                  and coalesce(i.paid_amount, 0) > 0) then
      raise exception 'A payment is already recorded on this plan''s invoice. Take the payment off the invoice first, then correct the size.';
    end if;
    delete from public.invoices where roof_care_plan_id = p_plan and status = 'draft';
    update public.invoices
       set status = 'void', updated_by_name = v_name
     where roof_care_plan_id = p_plan and status = 'final' and coalesce(paid_amount, 0) = 0;
  else
    -- Already paid. The invoice of an earlier correction that is not paid yet is made again
    -- for what is owed now; one with part of it paid stops the correction.
    if exists (select 1 from public.invoices i
                where i.roof_care_plan_id = p_plan and i.plan_part = 'size'
                  and i.status in ('draft', 'final') and coalesce(i.paid_amount, 0) > 0) then
      raise exception 'Part of the invoice for the last correction is paid. Record the rest of that payment or take it off, then correct the size.';
    end if;
    delete from public.invoices
     where roof_care_plan_id = p_plan and plan_part = 'size' and status = 'draft';
    update public.invoices
       set status = 'void', updated_by_name = v_name
     where roof_care_plan_id = p_plan and plan_part = 'size' and status = 'final'
       and coalesce(paid_amount, 0) = 0;
    v_base := coalesce(p.size_paid_price, p.price);
    v_owed := round(v_new - v_base, 2);
  end if;

  v_change := jsonb_build_object(
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'on', v_today,
    'by_name', coalesce(v_name, ''),
    'from_sqft', p.roof_sqft,
    'to_sqft', p_sqft,
    'from_price', p.price,
    'to_price', v_new,
    'would_be', v_new,
    'repriced', true,
    'paid', not v_waits,
    'owed', v_owed,
    'note', nullif(left(trim(coalesce(p_note, '')), 500), '')
  );
  update public.roof_care_plans
     set roof_sqft = p_sqft,
         list_price = (v_row->>'list')::numeric,
         travel_price = (v_row->>'travel')::numeric,
         price = v_new,
         size_paid_price = case when v_waits then size_paid_price else v_base end,
         size_unchecked = false,
         size_confirmed_on = v_today,
         size_confirmed_by_name = coalesce(v_name, ''),
         size_changes = coalesce(size_changes, '[]'::jsonb) || jsonb_build_array(v_change),
         updated_at = now()
   where id = p_plan;
  return v_change || jsonb_build_object('plan_number', p.plan_number, 'plan', p.plan);
end;
$function$;

revoke all on function public.roof_care_correct_size(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.roof_care_correct_size(uuid, numeric, numeric, text) to authenticated;

-- The refund for a smaller roof was sent: the day and the reference are kept, and the plan is
-- settled at its price.
create or replace function public.roof_care_size_refund_sent(
  p_plan uuid,
  p_on date,
  p_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_owed numeric;
  v_name text;
  v_entry jsonb;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin records a refund' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  v_owed := round(coalesce(p.size_paid_price, p.price) - p.price, 2);
  if v_owed <= 0 then
    raise exception 'No refund is owed for this plan''s roof size.';
  end if;
  if p_on is null or p_on > v_today then
    raise exception 'Type the day the refund was sent: today or earlier';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  v_entry := jsonb_build_object(
    'amount', v_owed,
    'on', p_on,
    'ref', nullif(left(trim(coalesce(p_ref, '')), 80), ''),
    'by_name', coalesce(v_name, ''),
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  update public.roof_care_plans
     set size_refunds = coalesce(size_refunds, '[]'::jsonb) || jsonb_build_array(v_entry),
         size_paid_price = price,
         updated_at = now()
   where id = p_plan;
  return v_entry;
end;
$function$;

revoke all on function public.roof_care_size_refund_sent(uuid, date, text) from public, anon;
grant execute on function public.roof_care_size_refund_sent(uuid, date, text) to authenticated;

-- The refund at a plan's end, from what was paid for the year at its right price.
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
  v_size_back numeric := 0;
  v_size_paid numeric := 0;
begin
  select * into p from public.roof_care_plans where id = p_plan;
  if not found then
    raise exception 'That plan was not found';
  end if;
  select coalesce(sum(i.paid_amount), 0) into v_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void' and i.plan_part is null;
  -- A card payment taken online before its invoice was marked paid.
  if v_paid = 0 and p.card_paid_amount is not null then
    v_paid := p.card_paid_amount;
  end if;
  -- The roof size corrected after the plan was paid (20261124990000): what was paid on the
  -- invoice of a bigger roof counts, what was sent back for a smaller roof no longer does, and
  -- what is still owed back for it is settled by itself.
  select coalesce(sum(i.paid_amount), 0) into v_size_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void' and i.plan_part = 'size';
  select coalesce(sum((e->>'amount')::numeric), 0) into v_size_back
    from jsonb_array_elements(coalesce(p.size_refunds, '[]'::jsonb)) e;
  v_paid := greatest(
    v_paid + v_size_paid - v_size_back
      - greatest(coalesce(p.size_paid_price, p.price) - p.price, 0), 0);
  -- The year's two inspections that are done, and the storm inspections the plan included that
  -- are: such a storm inspection counts as an inspection done. Two at most. A further storm
  -- inspection was billed by itself (amount above 0) and is not counted.
  select count(*) filter (where v.kind in ('visit1', 'visit2')),
         count(*) filter (where v.kind = 'storm' and v.amount = 0)
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

-- A changed refund is checked against the same sum.
create or replace function public.roof_care_change_refund(
  p_plan uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_paid numeric;
  v_new numeric;
  v_name text;
  v_entry jsonb;
  v_size_back numeric := 0;
  v_size_paid numeric := 0;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin changes a refund' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found or p.status <> 'ended' then
    raise exception 'That plan was not found, or it has not ended. A refund is worked when a plan is ended.';
  end if;
  if p.refund_due is null then
    raise exception 'This plan ended with no refund worked, so there is none to change.';
  end if;
  if p.refund_sent_on is not null then
    raise exception 'This refund was marked sent on %, so it cannot be changed.',
      to_char(p.refund_sent_on, 'Mon FMDD, YYYY');
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount < 0 then
    raise exception 'Type the refund: 0 or more';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Type why the refund is changed';
  end if;
  -- What was paid for the plan year: the sum the refund was worked from (roof_care_refund_worked).
  select coalesce(sum(i.paid_amount), 0) into v_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void' and i.plan_part is null;
  if v_paid = 0 and p.card_paid_amount is not null then
    v_paid := p.card_paid_amount;
  end if;
  -- The roof size corrected after the plan was paid (20261124990000): what was paid on the
  -- invoice of a bigger roof counts, what was sent back for a smaller roof no longer does, and
  -- what is still owed back for it is settled by itself.
  select coalesce(sum(i.paid_amount), 0) into v_size_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void' and i.plan_part = 'size';
  select coalesce(sum((e->>'amount')::numeric), 0) into v_size_back
    from jsonb_array_elements(coalesce(p.size_refunds, '[]'::jsonb)) e;
  v_paid := greatest(
    v_paid + v_size_paid - v_size_back
      - greatest(coalesce(p.size_paid_price, p.price) - p.price, 0), 0);
  v_new := round(p_amount, 2);
  if v_new > v_paid then
    raise exception 'The refund cannot be more than the $% paid for this plan year.',
      trim(to_char(v_paid, '999,999,990.00'));
  end if;
  if v_new = round(p.refund_due, 2) then
    raise exception 'The refund is already $%.', trim(to_char(v_new, '999,999,990.00'));
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  v_entry := jsonb_build_object(
    'from', round(p.refund_due, 2), 'to', v_new, 'reason', trim(p_reason),
    'by_name', coalesce(v_name, ''), 'on', v_today);
  update public.roof_care_plans
     set refund_due = v_new,
         refund_changes = coalesce(refund_changes, '[]'::jsonb) || jsonb_build_array(v_entry),
         updated_at = now()
   where id = p_plan;
  return v_entry;
end;
$function$;
