-- A plan paid by card: "signed, not paid" is held back for a short while (owner, Nov 24, the
-- same night: "if someone pays by card we just need the notification they paid by card", and
-- "only drop that if they actually pay by card not if they open the menu then leave").
--
-- roof_care_pay_notice_claim is replaced, with two more settings; nothing else changes.
--   - A card plan is not claimed at its sign-up. The customer is at the card screen.
--   - When the card payment comes through, the plan starts and is never told "not paid": the
--     "paid by card" notice is its news.
--   - When no payment has come p_card_wait minutes after the sign-up (they opened the card
--     screen and left, or have not used their payment link), the next pass claims it and the
--     office gets the notice of the sign-up then, at any hour.
--   - The reminder every p_days days is claimed only when p_reminders is true: the server
--     passes true at 8:00 or later on a working day.
--   - A plan paid by check, or with no way of paying written down, is told at once as before.
--
-- The older two-setting function is dropped: with it left in place a call that names only
-- p_plan and p_days would fit both and be refused.

drop function if exists public.roof_care_pay_notice_claim(uuid, integer);

create or replace function public.roof_care_pay_notice_claim(
  p_plan uuid default null,
  p_days integer default 2,
  p_reminders boolean default false,
  p_card_wait integer default 30
)
returns table (
  plan_id uuid,
  plan text,
  plan_number integer,
  site_id uuid,
  site text,
  account text,
  signed_on date,
  pay_method text,
  sold_by_name text,
  renewal boolean,
  first boolean,
  was timestamptz,
  days_waiting integer
)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select p.id, p.pay_notified_at as told
      from public.roof_care_plans p
     where p.status = 'awaiting_payment'
       and (p_plan is null or p.id = p_plan)
       and (
         -- Never told: the notice of the sign-up. A card plan waits out the card screen first.
         (p.pay_notified_at is null
          and (p.pay_method is distinct from 'card'
               or (p_plan is null
                   and p.created_at
                       <= now() - make_interval(mins => greatest(coalesce(p_card_wait, 30), 1)))))
         -- Told before: the reminder, with the morning run.
         or (p_plan is null
             and coalesce(p_reminders, false)
             and p.pay_notified_at is not null
             and greatest(p.pay_notified_at, coalesce(p.pay_link_sent_at, p.pay_notified_at))
                 <= now() - make_interval(days => greatest(coalesce(p_days, 2), 1)))
       )
     order by p.created_at
     limit 200
       for update of p skip locked
  ), marked as (
    update public.roof_care_plans p
       set pay_notified_at = now()
      from due
     where p.id = due.id
    returning p.id, p.plan, p.plan_number, p.site_id, p.account_id, p.signed_on, p.pay_method,
              p.sold_by_name, p.renewed_from, due.told
  )
  select m.id, m.plan, m.plan_number, m.site_id, s.name, a.name, m.signed_on, m.pay_method,
         m.sold_by_name, m.renewed_from is not null, m.told is null, m.told,
         greatest(0, (now() at time zone 'America/New_York')::date - m.signed_on)::integer
    from marked m
    left join public.crm_sites s on s.id = m.site_id
    left join public.crm_accounts a on a.id = m.account_id
   order by m.signed_on, m.id;
end;
$$;

revoke all on function public.roof_care_pay_notice_claim(uuid, integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.roof_care_pay_notice_claim(uuid, integer, boolean, integer) to service_role;
