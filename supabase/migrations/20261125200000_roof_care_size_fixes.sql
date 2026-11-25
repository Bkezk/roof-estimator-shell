-- Roof Care: the edges of "Correct the roof size" and of the refund at a plan's end (owner,
-- Nov 25, of the full audit's findings: "go on ... 5, 6, 7, 8, 9, 10, 11, 12, 13, 14"). The
-- lead ran the whole sequence on the live database that day and every amount was right; these
-- are the cases around it.
--
--   5   The plan year in force is not corrected while its renewal waits to be paid: the renewal
--       copied the size and the price when it was made, and would keep the wrong ones.
--   7   Ending a plan no longer forgives a bigger roof's difference that was not paid, for the
--       inspections already done: that part comes off the refund (roof_care_refund_worked:
--       size_unpaid, size_off). What the refund could not cover stays owed on the ended plan
--       (size_left; the trigger roof_care_plans_size_at_end keeps it). The part for the
--       inspections not done is dropped with the plan.
--   8   A correction bills only what comes from the size. The plan's new price is its price now,
--       plus today's price at the new size, less today's price at the size it has
--       (roof_care_size_worked). A change of the price list since the sign-up is no longer
--       billed or refunded with it. Typing the size the plan was signed at gives back the price
--       it was signed at, to the dollar.
--   9   A plan year renewed with money taken off for an inspection not done is not corrected
--       here: what was taken off depends on the size too.
--   10  A size invoice settles what it was paid and no more (invoices.size_settled), and a
--       payment marked on one by mistake can be taken off again: the size invoice is left out
--       of "the plan is running on this invoice's payment" (invoices_plan_guard).
--   12  Record the refund is told the amount the screen showed, and refuses when what is owed
--       has changed since (roof_care_size_refund_sent).
--   13  The card fee on the refund at a plan's end is decided by the plan year's own invoice,
--       never by a size invoice, and a plan paid from a bank account has no card fee.
--   14  Each correction keeps what the payments covered at that moment (`covered`) and which
--       correction of the plan it is (`nth`), so the email and the record add up.
--
-- Also: a plan that waits is not corrected while a bank payment for it is on its way.
--
--   roof_care_size_offer(plan, sqft)   what a corrected size would do, for the window, before
--                                      Save: the same arithmetic and the same refusals as Save.
--
-- Not replaced here: roof_care_end and roof_care_end_refund (patched in place on the live
-- database). No plan has a correction, a renewal or a size invoice yet, so no row is changed.
--
-- Applied on the live database by hand (AGENTS.md).

-- The two columns of 20261125100000 that are read here, so this file also runs alone.
alter table public.roof_care_plans
  add column if not exists paid_by_bank boolean not null default false,
  add column if not exists bank_pending_at timestamptz;

-- What a size invoice's payment moved the plan's settled price by: taken back exactly when the
-- payment is.
alter table public.invoices
  add column if not exists size_settled numeric;

-- 1 ── What a corrected size would do ───────────────────────────────────────────────────────
--
-- One place for the arithmetic and for every refusal, read by the window (roof_care_size_offer)
-- and by Save (roof_care_correct_size). It changes nothing. Not called from outside.
create or replace function public.roof_care_size_worked(p_plan uuid, p_sqft numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  p public.roof_care_plans%rowtype;
  v_waits boolean;
  v_at jsonb;
  v_was jsonb;
  v_row jsonb;
  v_old jsonb;
  v_first jsonb;
  v_new numeric;
  v_list numeric;
  v_base numeric;
  v_owed numeric;
begin
  select * into p from public.roof_care_plans where id = p_plan;
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
  -- The renewal copied this year's size and price when it was made.
  if not v_waits and exists (select 1 from public.roof_care_plans r
                              where r.renewed_from = p_plan and r.status = 'awaiting_payment') then
    raise exception 'This plan has a renewal waiting to be paid. Cancel the renewal, correct the size here, then renew again.';
  end if;
  -- What was taken off this year for last year's inspections depends on the size too.
  if not v_waits and coalesce(p.renewal_credit, 0) > 0 then
    raise exception 'This plan year was renewed with money taken off for an inspection we did not do, so its roof size is not corrected here. Correct the size on next year''s plan once its renewal is paid, or ask an admin if it cannot wait.';
  end if;
  if v_waits and p.bank_pending_at is not null then
    raise exception 'A payment from the customer''s bank account is on its way. Wait until it clears or fails, then correct the size.';
  end if;
  if v_waits then
    if exists (select 1 from public.invoices i
                where i.roof_care_plan_id = p_plan and i.status <> 'void'
                  and coalesce(i.paid_amount, 0) > 0) then
      raise exception 'A payment is already recorded on this plan''s invoice. Take the payment off the invoice first, then correct the size.';
    end if;
  elsif exists (select 1 from public.invoices i
                 where i.roof_care_plan_id = p_plan and i.plan_part = 'size'
                   and i.status in ('draft', 'final') and coalesce(i.paid_amount, 0) > 0) then
    raise exception 'Part of the invoice for the last correction is paid. Record the rest of that payment or take it off, then correct the size.';
  end if;

  -- Today's prices, for the plan's own drive, at the new size and at the size it has.
  v_at := public.roof_care_price(p_sqft, p.drive_hours, p.drive_miles);
  if not coalesce((v_at->>'ready')::boolean, false) then
    raise exception 'The Roof Care plan prices are not set up yet. Ask an admin.';
  end if;
  if coalesce((v_at->>'custom_quote')::boolean, false) then
    raise exception 'A roof this size gets a custom quote, so the plan cannot be priced at it here. End the plan and quote it by hand.';
  end if;
  select e into v_row from jsonb_array_elements(v_at->'plans') e where e->>'plan' = p.plan;
  if v_row is null then
    raise exception 'The price for this plan could not be worked out. Ask an admin.';
  end if;

  v_first := coalesce(p.size_changes, '[]'::jsonb)->0;
  if v_first is not null
     and nullif(v_first->>'from_sqft', '') is not null
     and nullif(v_first->>'from_price', '') is not null
     and round(p_sqft) = round((v_first->>'from_sqft')::numeric)
  then
    -- Back at the size the plan was signed at: the price it was signed at, whatever the price
    -- list has done since.
    v_new := (v_first->>'from_price')::numeric;
    v_list := coalesce(nullif(v_first->>'from_list', '')::numeric, p.list_price + (v_new - p.price));
  else
    v_was := public.roof_care_price(p.roof_sqft, p.drive_hours, p.drive_miles);
    if coalesce((v_was->>'ready')::boolean, false)
       and not coalesce((v_was->>'custom_quote')::boolean, false) then
      select e into v_old from jsonb_array_elements(v_was->'plans') e where e->>'plan' = p.plan;
    end if;
    if v_old is null then
      raise exception 'The size on this plan now gets a custom quote, so the difference cannot be priced here. End the plan and quote it by hand.';
    end if;
    -- Only the part that comes from the size (owner, Nov 25).
    v_new := p.price + ((v_row->>'price')::numeric - (v_old->>'price')::numeric);
    v_list := p.list_price + ((v_row->>'list')::numeric - (v_old->>'list')::numeric);
  end if;
  if v_new is null or v_new <= 0 then
    raise exception 'The price for this plan could not be worked out. Ask an admin.';
  end if;

  if not v_waits then
    -- What the payments cover so far: the price, unless an earlier correction is not settled.
    v_base := coalesce(p.size_paid_price, p.price);
    v_owed := round(v_new - v_base, 2);
  end if;
  return jsonb_build_object(
    'plan', p.plan,
    'plan_number', p.plan_number,
    'from_sqft', p.roof_sqft,
    'to_sqft', p_sqft,
    'from_price', p.price,
    'to_price', v_new,
    'from_list', p.list_price,
    'from_travel', p.travel_price,
    'to_list', v_list,
    'to_travel', v_new - v_list,
    'would_be', (v_row->>'price')::numeric,
    'repriced', true,
    'paid', not v_waits,
    'covered', v_base,
    'owed', v_owed,
    'nth', jsonb_array_length(coalesce(p.size_changes, '[]'::jsonb)) + 1);
end;
$function$;

revoke all on function public.roof_care_size_worked(uuid, numeric) from public, anon, authenticated;

-- For the window, before Save: a manager's or an admin's.
create or replace function public.roof_care_size_offer(p_plan uuid, p_sqft numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin corrects a plan''s roof size' using errcode = '42501';
  end if;
  return public.roof_care_size_worked(p_plan, p_sqft);
end;
$function$;

revoke all on function public.roof_care_size_offer(uuid, numeric) from public, anon;
grant execute on function public.roof_care_size_offer(uuid, numeric) to authenticated;

-- 2 ── Save a corrected size ────────────────────────────────────────────────────────────────
--
-- Replaces the function of 20261124990000. The price and every refusal are roof_care_size_worked's.
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
  v jsonb;
  v_name text;
  v_new numeric;
  v_waits boolean;
  v_change jsonb;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin corrects a plan''s roof size' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  v := public.roof_care_size_worked(p_plan, p_sqft);
  v_new := (v->>'to_price')::numeric;
  v_waits := p.status = 'awaiting_payment';
  -- Saved at the price the manager was shown, or not at all.
  if p_shown_price is not null and round(p_shown_price) <> round(v_new) then
    raise exception 'The price changed: at this size the plan is now $%, not the $% shown. Press Show the new price again.',
      trim(to_char(round(v_new), '999,999,990')), trim(to_char(round(p_shown_price), '999,999,990'));
  end if;

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();

  if v_waits then
    delete from public.invoices where roof_care_plan_id = p_plan and status = 'draft';
    update public.invoices
       set status = 'void', updated_by_name = v_name
     where roof_care_plan_id = p_plan and status = 'final' and coalesce(paid_amount, 0) = 0;
  else
    -- Already paid. The invoice of an earlier correction that is not paid yet is made again
    -- for what is owed now.
    delete from public.invoices
     where roof_care_plan_id = p_plan and plan_part = 'size' and status = 'draft';
    update public.invoices
       set status = 'void', updated_by_name = v_name
     where roof_care_plan_id = p_plan and plan_part = 'size' and status = 'final'
       and coalesce(paid_amount, 0) = 0;
  end if;

  v_change := jsonb_build_object(
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'on', v_today,
    'by_name', coalesce(v_name, ''),
    'from_sqft', p.roof_sqft,
    'to_sqft', p_sqft,
    'from_price', p.price,
    'to_price', v_new,
    'from_list', p.list_price,
    'from_travel', p.travel_price,
    'would_be', (v->>'would_be')::numeric,
    'repriced', true,
    'paid', not v_waits,
    'covered', v->'covered',
    'owed', v->'owed',
    'nth', (v->>'nth')::integer,
    'note', nullif(left(trim(coalesce(p_note, '')), 500), '')
  );
  update public.roof_care_plans
     set roof_sqft = p_sqft,
         list_price = (v->>'to_list')::numeric,
         travel_price = (v->>'to_travel')::numeric,
         price = v_new,
         size_paid_price = case when v_waits then size_paid_price
                                else (v->>'covered')::numeric end,
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

-- 3 ── The refund for a smaller roof was sent ───────────────────────────────────────────────
--
-- Now told the amount the screen showed: a size corrected again in between is caught.
drop function if exists public.roof_care_size_refund_sent(uuid, date, text);

create or replace function public.roof_care_size_refund_sent(
  p_plan uuid,
  p_on date,
  p_ref text default null,
  p_shown_amount numeric default null
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
  if p_shown_amount is not null and round(p_shown_amount, 2) <> v_owed then
    raise exception 'The amount owed back changed to $%. Check the plan and press Record the refund again.',
      trim(to_char(v_owed, '999,999,990.00'));
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

revoke all on function public.roof_care_size_refund_sent(uuid, date, text, numeric) from public, anon;
grant execute on function public.roof_care_size_refund_sent(uuid, date, text, numeric) to authenticated;

-- 4 ── A size invoice settles what it was paid ──────────────────────────────────────────────
--
-- Paid: the plan's settled price goes up by the invoice's total, never above the plan's price,
-- and the invoice keeps by how much (size_settled). No longer Paid (the payment taken off, or
-- the invoice gone): it goes back down by that same amount. A part payment moves nothing, as
-- before.
create or replace function public.invoices_size_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_price numeric;
  v_covered numeric;
  v_up numeric;
begin
  if tg_op = 'DELETE' then
    if old.plan_part = 'size' and old.status = 'paid' then
      update public.roof_care_plans
         set size_paid_price = size_paid_price - coalesce(old.size_settled, old.total, 0),
             updated_at = now()
       where id = old.roof_care_plan_id and size_paid_price is not null;
    end if;
    return old;
  end if;
  if new.plan_part is distinct from 'size' then
    return new;
  end if;
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    select p.price, p.size_paid_price into v_price, v_covered
      from public.roof_care_plans p where p.id = new.roof_care_plan_id for update;
    if found and v_covered is not null then
      v_up := least(greatest(coalesce(new.total, 0), 0), greatest(v_price - v_covered, 0));
      update public.roof_care_plans
         set size_paid_price = v_covered + v_up, updated_at = now()
       where id = new.roof_care_plan_id;
      new.size_settled := v_up;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'paid' and new.status <> 'paid' then
    update public.roof_care_plans
       set size_paid_price = size_paid_price - coalesce(old.size_settled, old.total, 0),
           updated_at = now()
     where id = new.roof_care_plan_id and size_paid_price is not null;
    new.size_settled := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.invoices_size_paid() from public, anon, authenticated;

-- Before the row is written, so the invoice can keep what it settled.
drop trigger if exists invoices_size_paid on public.invoices;
create trigger invoices_size_paid
  before insert or update or delete on public.invoices
  for each row execute function public.invoices_size_paid();

-- 5 ── The plan runs on its own invoice, not on a size invoice ──────────────────────────────
--
-- Replaces the function of 20261120800000, with one change: an invoice for a size difference
-- (plan_part = 'size') is left out of "the plan is running on this invoice's payment", so a
-- payment marked on one by mistake can be taken off. Voiding and deleting follow the ordinary
-- invoice rules. The trigger itself is as it was.
create or replace function public.invoices_plan_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_person boolean := auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role';
  v_status text;
  v_number integer;
  v_refund numeric;
  v_money boolean;
  v_allow numeric;
  v_other numeric;
  v_waived numeric;
  v_travel numeric;
begin
  if tg_op = 'UPDATE' and old.status = 'void' and new.status <> 'void' then
    raise exception 'A void invoice stays void. Make a new invoice instead.';
  end if;

  -- A draft made final: the plan's lines cover no more than the invoice bills.
  if tg_op = 'UPDATE' and old.status = 'draft' and new.status in ('final', 'paid') then
    select coalesce(sum(-l.total) filter (where l.source like 'roof-care-allowance:%'), 0),
           coalesce(sum(-l.total) filter (where l.source like 'roof-care-travel:%'), 0),
           coalesce(sum(l.total) filter (where l.kind = 'travel'), 0)
      into v_allow, v_waived, v_travel
      from public.invoice_lines l where l.invoice_id = new.id;
    -- What the plan's minor repairs may cover here (20261120800000): on a repair's invoice its
    -- other lines; on a plan inspection's own invoice the return trips, each at no more than
    -- it was worked out at, and a billed storm inspection.
    v_other := public.roof_care_credit_cover(new.id);
    if v_allow > greatest(v_other, 0) + 0.005 then
      raise exception 'The Roof Care plan''s minor repairs take $% off this invoice, and the plan can cover $% of it. Save the invoice so the amount is worked again, then finalise it.',
        trim(to_char(v_allow, '999,999,990.00')), trim(to_char(v_other, '999,999,990.00'));
    end if;
    if v_waived > greatest(v_travel, 0) + 0.005 then
      raise exception 'The Roof Care plan''s leak call takes $% of travel off this invoice, and the invoice charges $% of travel. Save the invoice so the amount is worked again, then finalise it.',
        trim(to_char(v_waived, '999,999,990.00')), trim(to_char(v_travel, '999,999,990.00'));
    end if;
  end if;

  -- The invoice of a plan year, changed by a person.
  if old.roof_care_plan_id is not null and v_person then
    select p.status, p.plan_number, coalesce(p.refund_due, 0)
      into v_status, v_number, v_refund
      from public.roof_care_plans p where p.id = old.roof_care_plan_id;
    if found then
      v_money := coalesce(old.paid_amount, 0) > 0;
      -- Not the invoice of a size difference (Nov 25): the plan does not run on that payment.
      if v_status = 'active' and old.status = 'paid'
         and old.plan_part is distinct from 'size'
         and (tg_op = 'DELETE'
              or new.status <> 'paid'
              or coalesce(new.paid_amount, 0) + 0.005 < coalesce(new.total, 0)
              or new.roof_care_plan_id is distinct from old.roof_care_plan_id)
      then
        raise exception 'Roof Care plan RC-% is running on this invoice''s payment. End the plan first: open the property, press Care Plan, then End plan. The refund is worked there.',
          v_number;
      end if;
      if v_status = 'awaiting_payment' and v_money
         and (tg_op = 'DELETE' or new.status = 'void'
              or new.roof_care_plan_id is distinct from old.roof_care_plan_id)
      then
        raise exception 'This invoice has a payment recorded toward Roof Care plan RC-%. Take the payment off before it is voided or deleted.',
          v_number;
      end if;
      if v_status = 'ended' and v_refund > 0 and (v_money or old.status = 'paid')
         and (tg_op = 'DELETE'
              or new.status = 'void'
              or (old.status = 'paid' and new.status <> 'paid')
              or coalesce(new.paid_amount, 0) + 0.005 < coalesce(old.paid_amount, 0)
              or new.roof_care_plan_id is distinct from old.roof_care_plan_id)
      then
        raise exception 'Roof Care plan RC-% ended with a refund of $% worked from this payment. The payment stays on the invoice while that refund stands.',
          v_number, trim(to_char(v_refund, '999,999,990.00'));
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.invoices_plan_guard() from public, anon, authenticated;

-- 6 ── The refund at a plan's end ───────────────────────────────────────────────────────────
--
-- Replaces the function of 20261124990000. Three changes:
--   size_unpaid   a bigger roof's difference that was not paid, for the inspections done: half
--                 of it for each. size_off is what of it comes off the refund, after the minor
--                 repairs and the travel; size_left is what the refund could not cover.
--   size_back     what is still owed back for a smaller roof: said beside the refund, and sent
--                 by itself as before.
--   card_fee      decided by the plan year's own invoice (not a size invoice), and nothing for
--                 a plan paid from a bank account.
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
  v_size_part numeric := 0;
  v_owed_back numeric := 0;
  v_size_unpaid numeric := 0;
  v_size_off numeric := 0;
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
  select coalesce(sum(i.paid_amount), 0),
         coalesce(sum(i.paid_amount) filter (where i.status in ('draft', 'final')), 0)
    into v_size_paid, v_size_part
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void' and i.plan_part = 'size';
  select coalesce(sum((e->>'amount')::numeric), 0) into v_size_back
    from jsonb_array_elements(coalesce(p.size_refunds, '[]'::jsonb)) e;
  v_owed_back := greatest(coalesce(p.size_paid_price, p.price) - p.price, 0);
  v_paid := greatest(v_paid + v_size_paid - v_size_back - v_owed_back, 0);
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
  -- A bigger roof's difference that was not paid (Nov 25): the customer had the inspections
  -- done at the bigger roof's price, so half of the unpaid difference for each comes off the
  -- refund. A part payment on its open invoice is already counted as paid above.
  v_size_unpaid := round(
    greatest(p.price - coalesce(p.size_paid_price, p.price) - v_size_part, 0) * v_done / 2.0, 2);
  v_size_off := least(v_size_unpaid, v_before);
  v_before := v_before - v_size_off;
  -- Paid by card: online, or the plan year's invoice marked paid by card, or said at the
  -- sign-up with no invoice saying otherwise. The card company keeps its fee on what is sent
  -- back. The invoice of a size difference does not decide it (Nov 25), and a plan paid from a
  -- bank account has no card fee.
  v_card := not coalesce(p.paid_by_bank, false)
    and (p.card_paid_on is not null
      or exists (select 1 from public.invoices i
                  where i.roof_care_plan_id = p_plan and i.status <> 'void'
                    and i.plan_part is null
                    and lower(coalesce(i.paid_method, '')) like '%card%')
      or (p.pay_method = 'card'
          and not exists (select 1 from public.invoices i
                           where i.roof_care_plan_id = p_plan and i.status <> 'void'
                             and i.plan_part is null
                             and coalesce(trim(i.paid_method), '') <> '')));
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
    'size_unpaid', v_size_unpaid,
    'size_off', v_size_off,
    'size_left', v_size_unpaid - v_size_off,
    'size_back', v_owed_back,
    'card_fee', v_fee,
    'refund', v_before - v_fee);
end;
$function$;

revoke all on function public.roof_care_refund_worked(uuid) from public, anon, authenticated;

-- 7 ── What stays owed for a bigger roof when a plan is ended by hand ───────────────────────
--
-- roof_care_end is not replaced (it is patched in place on the live database), so this runs
-- beside it. When a manager ends a plan in force that still owes a bigger roof's difference,
-- the part for the inspections done was taken off the refund as far as the refund reached
-- (above). Here the plan is settled down to what the refund could not cover (size_left), so
-- the ended plan shows that and nothing more. A plan that ends because it was renewed or its
-- year ran out had its whole year: the whole difference stays owed, and nothing is changed.
-- A smaller roof's money owed back is never changed here.
create or replace function public.roof_care_plans_size_at_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_left numeric;
begin
  if old.status = 'active' and new.status = 'ended'
     and old.size_paid_price is not null and old.price > old.size_paid_price
     and not (coalesce(new.ended_by_name, '') = 'Roof Care plans'
              and coalesce(new.ended_reason, '') in ('Renewed', 'Expired'))
  then
    -- Read while the plan is still in force and its unpaid invoice is still there: the same
    -- sum the End plan box showed.
    v_left := coalesce((public.roof_care_refund_worked(old.id)->>'size_left')::numeric, 0);
    new.size_paid_price :=
      new.price - least(greatest(v_left, 0), old.price - old.size_paid_price);
  end if;
  return new;
end;
$function$;

revoke all on function public.roof_care_plans_size_at_end() from public, anon, authenticated;

drop trigger if exists roof_care_plans_size_at_end on public.roof_care_plans;
create trigger roof_care_plans_size_at_end
  before update of status on public.roof_care_plans
  for each row execute function public.roof_care_plans_size_at_end();

notify pgrst, 'reload schema';
