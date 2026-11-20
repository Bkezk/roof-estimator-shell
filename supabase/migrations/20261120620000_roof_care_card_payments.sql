-- Roof Care break test of Nov 20, fix 26: card payments, put right before Stripe is switched on.
--
-- What was wrong: the card function wrote the payment onto the plan before it looked at the
-- plan. A card payment for a plan already paid by check turned it into a card plan (so a later
-- refund kept a card fee that was never charged); a second charge wrote over the first one's
-- reference; a charge on a plan cancelled while it waited left nothing saying money was owed
-- back; an amount over what was owed was kept with no word; and a payment that started a plan
-- left its draft invoice unpaid.
--
-- Now:
--   - Every card payment is its own row in roof_care_card_payments. A payment reference is
--     taken once: the same message from Stripe a second time changes nothing.
--   - A payment for a plan that is not waiting (paid another way already, ended, or cancelled
--     while it waited) does not touch the plan. It is kept as money to send back, with why.
--   - A payment that does not cover what is owed does not start the plan. It is kept as money
--     to send back, with what was owed.
--   - A payment that covers what is owed starts the plan. Its waiting invoice, draft or final,
--     is made final and paid by card with the reference, and the plan starts by the invoice's
--     own rule (invoices_plan_paid). Anything over what was owed is kept on the row.
--   - A plan with no invoice, or with one that is not for the plan's own amount, starts
--     directly; that invoice is left for the office.
--
-- The table is written only here, by the service role. The office reads it.

create table if not exists public.roof_care_card_payments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.roof_care_plans (id) on delete cascade,
  -- Stripe's own reference of the payment: taken once.
  ref text not null,
  amount numeric not null check (amount > 0),
  paid_on date not null,
  -- 'started': it paid for the plan year. 'send_back': it is owed back to the customer.
  outcome text not null check (outcome in ('started', 'send_back')),
  -- Why it is owed back: the plan was 'paid_already', had 'ended', or the payment was 'short'.
  reason text check (reason in ('paid_already', 'ended', 'short')),
  -- What was owed for the plan year when it came in.
  owed numeric,
  -- How much of it is over what was owed (a 'started' payment).
  over numeric not null default 0,
  invoice_id uuid references public.invoices (id) on delete set null,
  -- Filled when the office has sent the money back.
  sent_back_on date,
  sent_back_ref text,
  created_at timestamptz not null default now(),
  constraint roof_care_card_payments_ref_key unique (ref),
  constraint roof_care_card_payments_send_back_check
    check ((outcome = 'send_back') = (reason is not null))
);

create index if not exists roof_care_card_payments_plan_idx
  on public.roof_care_card_payments (plan_id);

alter table public.roof_care_card_payments enable row level security;
revoke all on table public.roof_care_card_payments from public, anon, authenticated;
grant select on table public.roof_care_card_payments to authenticated;
grant all on table public.roof_care_card_payments to service_role;

drop policy if exists roof_care_card_payments_read on public.roof_care_card_payments;
create policy roof_care_card_payments_read on public.roof_care_card_payments
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_manager()) or (select public.is_sales_pm()));

create or replace function public.roof_care_card_paid(
  p_plan uuid, p_amount numeric, p_ref text, p_on date default null)
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
  v_price := round(greatest(p.price - coalesce(p.renewal_credit, 0), 0), 2);

  -- Not waiting for a payment: paid another way already, or ended. The plan is not touched.
  if p.status <> 'awaiting_payment' then
    insert into public.roof_care_card_payments (plan_id, ref, amount, paid_on, outcome, reason, owed)
    values (p_plan, v_ref, p_amount, v_on, 'send_back',
            case when p.status = 'active' then 'paid_already' else 'ended' end, 0);
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
    insert into public.roof_care_card_payments (plan_id, ref, amount, paid_on, outcome, reason, owed, invoice_id)
    values (p_plan, v_ref, p_amount, v_on, 'send_back', 'short', v_owed,
            case when v_has then inv.id end);
    return 'send_back';
  end if;

  insert into public.roof_care_card_payments (plan_id, ref, amount, paid_on, outcome, owed, over, invoice_id)
  values (p_plan, v_ref, p_amount, v_on, 'started', v_owed,
          greatest(round(p_amount - v_owed, 2), 0), case when v_fits then inv.id end);
  update public.roof_care_plans
     set card_paid_on = v_on, card_paid_amount = p_amount, card_paid_ref = v_ref,
         pay_method = 'card', updated_at = now()
   where id = p_plan;
  if v_fits then
    -- Final and paid in one step, by card: the plan starts by the invoice's own rule.
    update public.invoices
       set status = 'paid',
           finalized_at = coalesce(finalized_at, now()),
           paid_on = v_on, paid_amount = inv.total, paid_method = 'Card',
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

notify pgrst, 'reload schema';
