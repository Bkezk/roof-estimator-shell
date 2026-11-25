-- Roof Care: card pages that can be closed, and bank payments followed on the plan (owner,
-- Nov 25, of the audit of that day: "go on 1, 2, 3 (do you want to just go ahead and build bank
-- payments too?), 4").
--
-- What was wrong:
--   1. A card payment page stayed open for a day and the site kept no word of it, so nothing
--      could close one. A page opened before a roof size was corrected still charged the old
--      price afterwards; the payment was then short, the plan did not start, and the money had
--      to be sent back.
--   3. A payment from a bank account was recorded as a card payment: the plan and its invoice
--      said Card, and a refund at the plan's end took a card fee off it. And nothing on the
--      site knew a bank payment was on its way, so the customer was still offered the Pay
--      button for the whole amount for the days it took to clear.
--
-- What this adds:
--   roof_care_plans.card_sessions       every card page the site made for the plan, the newest
--                                       twenty, oldest first: Stripe's name of it (id), the
--                                       cents it asks for, when it was made (at), from where
--                                       ('link' the customer's own, 'office'), when it closes
--                                       by itself (expires, seconds since 1970) and, once the
--                                       site closed it or found it over, closed_at.
--   roof_care_plans.paid_by_bank        true when the plan year was paid from a bank account.
--                                       pay_method stays 'card' ('paid online'): it is what a
--                                       renewal copies and what the screens ask to offer the
--                                       payment page. The refund at a plan's end reads
--                                       paid_by_bank to leave the card fee off.
--   roof_care_plans.bank_pending_ref    a bank payment that has started and not cleared: its
--   roof_care_plans.bank_pending_amount reference, its dollars and when it started. All three
--   roof_care_plans.bank_pending_at     empty when none is on its way.
--   roof_care_card_payments.bank        true on a payment that came from a bank account.
--
--   roof_care_card_session_keep(plan, id, cents, via, expires)   a page was made: kept once.
--   roof_care_card_sessions_closed(plan, ids)                    these pages are closed.
--   roof_care_bank_pending(plan, ref, amount, step)              a bank payment 'started' or
--                                                                'failed'.
--   roof_care_card_paid(plan, amount, ref, on, bank)             replaced, with one more
--     setting: p_bank. Everything else in it is as it was (20261120620000). A bank payment
--     marks the plan paid_by_bank and its invoice paid by 'Bank payment'; any payment that
--     starts the plan, and a bank payment that lands, takes the "on its way" stamp off.
--
-- The site's server alone calls the four functions (service_role). No row is changed by this
-- file itself.
--
-- Applied on the live database by hand (AGENTS.md).

alter table public.roof_care_plans
  add column if not exists card_sessions jsonb not null default '[]'::jsonb,
  add column if not exists paid_by_bank boolean not null default false,
  add column if not exists bank_pending_ref text,
  add column if not exists bank_pending_amount numeric,
  add column if not exists bank_pending_at timestamptz;

comment on column public.roof_care_plans.card_sessions is
  'Every card payment page the site made for this plan (the newest twenty): id, cents, at, via, expires, and closed_at once it is closed. Written by the site''s server only.';
comment on column public.roof_care_plans.paid_by_bank is
  'True when the plan year was paid from a bank account online, not by card. pay_method stays ''card'' for it.';
comment on column public.roof_care_plans.bank_pending_at is
  'When a bank payment for this plan started. Empty when none is on its way: it cleared, failed, or there was none.';

alter table public.roof_care_card_payments
  add column if not exists bank boolean not null default false;

-- ── 1. The card pages of a plan ─────────────────────────────────────────────────────────────

create or replace function public.roof_care_card_session_keep(
  p_plan uuid, p_id text, p_cents integer, p_via text, p_expires bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_list jsonb;
  v_id text := nullif(trim(coalesce(p_id, '')), '');
begin
  if v_id is null or char_length(v_id) > 255 then
    raise exception 'A card payment page needs its reference';
  end if;
  if p_cents is null or p_cents <= 0 then
    raise exception 'A card payment page needs its amount';
  end if;
  select case when jsonb_typeof(p.card_sessions) = 'array' then p.card_sessions else '[]'::jsonb end
    into v_list
    from public.roof_care_plans p
   where p.id = p_plan
     for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  -- The same page handed back a second time (the same ask within a quarter hour) is kept once,
  -- as it is: one that was closed stays closed.
  if exists (select 1 from jsonb_array_elements(v_list) e where e->>'id' = v_id) then
    return jsonb_array_length(v_list);
  end if;
  v_list := v_list || jsonb_build_array(jsonb_build_object(
    'id', v_id,
    'cents', p_cents,
    'at', now(),
    'via', case when p_via = 'link' then 'link' else 'office' end,
    'expires', p_expires));
  -- The newest twenty, oldest first.
  select coalesce(jsonb_agg(x.e order by x.n), '[]'::jsonb) into v_list
    from (select t.e, t.n
            from jsonb_array_elements(v_list) with ordinality as t(e, n)
           order by t.n desc
           limit 20) x;
  update public.roof_care_plans set card_sessions = v_list where id = p_plan;
  return jsonb_array_length(v_list);
end;
$function$;

revoke all on function public.roof_care_card_session_keep(uuid, text, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.roof_care_card_session_keep(uuid, text, integer, text, bigint) to service_role;

create or replace function public.roof_care_card_sessions_closed(p_plan uuid, p_ids text[])
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_list jsonb;
  v_new jsonb;
  v_n integer;
begin
  select case when jsonb_typeof(p.card_sessions) = 'array' then p.card_sessions else '[]'::jsonb end
    into v_list
    from public.roof_care_plans p
   where p.id = p_plan
     for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  select coalesce(jsonb_agg(
           case when t.e->>'id' = any(coalesce(p_ids, '{}')) and not (t.e ? 'closed_at')
                then t.e || jsonb_build_object('closed_at', now())
                else t.e end
           order by t.n), '[]'::jsonb),
         count(*) filter (where t.e->>'id' = any(coalesce(p_ids, '{}')) and not (t.e ? 'closed_at'))
    into v_new, v_n
    from jsonb_array_elements(v_list) with ordinality as t(e, n);
  if v_n > 0 then
    update public.roof_care_plans set card_sessions = v_new where id = p_plan;
  end if;
  return v_n;
end;
$function$;

revoke all on function public.roof_care_card_sessions_closed(uuid, text[]) from public, anon, authenticated;
grant execute on function public.roof_care_card_sessions_closed(uuid, text[]) to service_role;

-- ── 2. A bank payment on its way ────────────────────────────────────────────────────────────
--
-- 'started': the checkout is finished and the money has not cleared. A plan that waits is
--   stamped, and marked as told just now, so "signed, not paid: no payment has come through"
--   does not follow while the money is on its way. Answers 'started', 'already' (this payment
--   was stamped or recorded before) or 'not_waiting' (the plan was paid another way or ended:
--   nothing is stamped).
-- 'failed': it did not go through. The stamp of that payment is taken off. Answers 'cleared'
--   or 'none'.

create or replace function public.roof_care_bank_pending(
  p_plan uuid, p_ref text, p_amount numeric, p_step text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  p public.roof_care_plans%rowtype;
  v_ref text := nullif(trim(coalesce(p_ref, '')), '');
begin
  if v_ref is null then
    raise exception 'A bank payment needs its reference';
  end if;
  if p_step is null or p_step not in ('started', 'failed') then
    raise exception 'A bank payment has started or has failed';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  if p_step = 'failed' then
    if p.bank_pending_ref = v_ref then
      update public.roof_care_plans
         set bank_pending_ref = null, bank_pending_amount = null, bank_pending_at = null
       where id = p_plan;
      return 'cleared';
    end if;
    return 'none';
  end if;
  -- Told twice, or told after the payment itself was recorded: nothing changes.
  if p.bank_pending_ref = v_ref
     or p.card_paid_ref = v_ref
     or exists (select 1 from public.roof_care_card_payments c where c.ref = v_ref)
  then
    return 'already';
  end if;
  if p.status <> 'awaiting_payment' then
    return 'not_waiting';
  end if;
  update public.roof_care_plans
     set bank_pending_ref = v_ref,
         bank_pending_amount = case when p_amount > 0 then p_amount end,
         bank_pending_at = now(),
         pay_notified_at = now()
   where id = p_plan;
  return 'started';
end;
$function$;

revoke all on function public.roof_care_bank_pending(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.roof_care_bank_pending(uuid, text, numeric, text) to service_role;

-- ── 3. A payment is recorded: by card, or from a bank account ───────────────────────────────
--
-- The definition of 20261120620000 with p_bank added. The older four-setting function is
-- dropped first: left in place, a call that names only the first three settings would fit both
-- and be refused.

drop function if exists public.roof_care_card_paid(uuid, numeric, text, date);

create or replace function public.roof_care_card_paid(
  p_plan uuid, p_amount numeric, p_ref text, p_on date default null, p_bank boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_on date := least(coalesce(p_on, (now() at time zone 'America/New_York')::date),
                     (now() at time zone 'America/New_York')::date);
  p public.roof_care_plans%rowtype;
  inv public.invoices%rowtype;
  v_has boolean;
  v_fits boolean := false;
  v_price numeric;
  v_owed numeric;
  v_ref text := nullif(trim(coalesce(p_ref, '')), '');
  v_bank boolean := coalesce(p_bank, false);
begin
  if v_ref is null then
    raise exception 'A card payment needs its reference';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A card payment needs its amount';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  -- Taken once: the same payment told a second time changes nothing.
  if exists (select 1 from public.roof_care_card_payments c where c.ref = v_ref)
     or p.card_paid_ref = v_ref
  then
    return 'already';
  end if;
  -- The bank payment that was on its way has landed: it is no longer waited for, whatever it
  -- turns out to pay for below.
  if p.bank_pending_ref = v_ref then
    update public.roof_care_plans
       set bank_pending_ref = null, bank_pending_amount = null, bank_pending_at = null
     where id = p_plan;
  end if;
  v_price := round(greatest(p.price - coalesce(p.renewal_credit, 0), 0), 2);

  -- Not waiting for a payment: paid another way already, or ended. The plan is not touched.
  if p.status <> 'awaiting_payment' then
    insert into public.roof_care_card_payments (plan_id, ref, amount, paid_on, outcome, reason, owed, bank)
    values (p_plan, v_ref, p_amount, v_on, 'send_back',
            case when p.status = 'active' then 'paid_already' else 'ended' end, 0, v_bank);
    return 'send_back';
  end if;

  select * into inv from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void'
   order by i.created_at desc limit 1
     for update;
  v_has := found;
  -- The invoice is the plan's own when it is for the plan's amount, to the cent.
  v_fits := v_has and inv.status in ('draft', 'final') and round(coalesce(inv.total, 0), 2) = v_price;
  v_owed := case when v_fits then greatest(v_price - coalesce(inv.paid_amount, 0), 0) else v_price end;

  if p_amount + 0.005 < v_owed then
    insert into public.roof_care_card_payments (plan_id, ref, amount, paid_on, outcome, reason, owed, invoice_id, bank)
    values (p_plan, v_ref, p_amount, v_on, 'send_back', 'short', v_owed,
            case when v_has then inv.id end, v_bank);
    return 'send_back';
  end if;

  insert into public.roof_care_card_payments (plan_id, ref, amount, paid_on, outcome, owed, over, invoice_id, bank)
  values (p_plan, v_ref, p_amount, v_on, 'started', v_owed,
          greatest(round(p_amount - v_owed, 2), 0), case when v_fits then inv.id end, v_bank);
  -- The plan is paid: no bank payment is waited for any more, whichever one this was.
  update public.roof_care_plans
     set card_paid_on = v_on, card_paid_amount = p_amount, card_paid_ref = v_ref,
         pay_method = 'card', paid_by_bank = v_bank,
         bank_pending_ref = null, bank_pending_amount = null, bank_pending_at = null,
         updated_at = now()
   where id = p_plan;
  if v_fits then
    -- Final and paid in one step: the plan starts by the invoice's own rule.
    update public.invoices
       set status = 'paid',
           finalized_at = coalesce(finalized_at, now()),
           paid_on = v_on, paid_amount = inv.total,
           paid_method = case when v_bank then 'Bank payment' else 'Card' end,
           paid_ref = left(v_ref, 80),
           updated_by_name = case when v_bank then 'Bank payment' else 'Card payment' end
     where id = inv.id;
    return 'invoice_paid';
  end if;
  perform public.roof_care_start(p_plan, v_on);
  return 'started';
end;
$function$;

revoke all on function public.roof_care_card_paid(uuid, numeric, text, date, boolean) from public, anon, authenticated;
grant execute on function public.roof_care_card_paid(uuid, numeric, text, date, boolean) to service_role;

notify pgrst, 'reload schema';
