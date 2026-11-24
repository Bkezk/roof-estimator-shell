-- Roof Care: correct a plan's roof size (owner, Nov 24: of a "Correct the roof size" button,
-- "1. yes but then build the rest. 2. send it but can it be combined with the new price payment?
-- 3. more than once but recorded").
--
-- Until this a plan's roof size could only be confirmed. A size that turned out wrong meant
-- ending the plan and signing it up again.
--
--   roof_care_plans.size_changes   every correction, oldest first: who, when, from what size and
--                                  price to what, and the office's own note. Never edited.
--
--   roof_care_correct_size(plan, sqft, shown price, note)
--     A manager's or an admin's. The size is theirs to say: they measured it, so the map is not
--     asked again, and the plan is marked confirmed by them.
--
--     A plan that waits for its payment is priced again at the new size, with the drive it was
--     signed at and today's prices. Its unpaid invoice goes, as it does when a plan is ended (a
--     draft is deleted, a final one with nothing paid is made void); the site makes a new one at
--     the new price right after. Refused while a payment is recorded on that invoice.
--
--     A plan in force keeps the price it was paid at: nothing is billed and nothing is refunded
--     here. The size is corrected, so the renewal is priced on the right roof, and the answer
--     says what this year would have cost at that size (`would_be`).
--
--     Any number of times; each is kept in size_changes.
--
-- Applied on the live database by hand (AGENTS.md).

alter table public.roof_care_plans
  add column if not exists size_changes jsonb not null default '[]'::jsonb;

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
  v_reprice boolean;
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
  v_reprice := p.status = 'awaiting_payment';
  -- A renewal's price is last year's rule with a credit worked into it: it is renewed again
  -- at the right size, not re-priced here.
  if v_reprice and p.renewed_from is not null then
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

  if v_reprice then
    if exists (select 1 from public.invoices i
                where i.roof_care_plan_id = p_plan and i.status <> 'void'
                  and coalesce(i.paid_amount, 0) > 0) then
      raise exception 'A payment is already recorded on this plan''s invoice. Take the payment off the invoice first, then correct the size.';
    end if;
    delete from public.invoices where roof_care_plan_id = p_plan and status = 'draft';
    update public.invoices
       set status = 'void', updated_by_name = v_name
     where roof_care_plan_id = p_plan and status = 'final' and coalesce(paid_amount, 0) = 0;
  end if;

  v_change := jsonb_build_object(
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'on', v_today,
    'by_name', coalesce(v_name, ''),
    'from_sqft', p.roof_sqft,
    'to_sqft', p_sqft,
    'from_price', p.price,
    'to_price', case when v_reprice then v_new else p.price end,
    'would_be', v_new,
    'repriced', v_reprice,
    'note', nullif(left(trim(coalesce(p_note, '')), 500), '')
  );
  update public.roof_care_plans
     set roof_sqft = p_sqft,
         list_price = case when v_reprice then (v_row->>'list')::numeric else list_price end,
         travel_price = case when v_reprice then (v_row->>'travel')::numeric else travel_price end,
         price = case when v_reprice then v_new else price end,
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
