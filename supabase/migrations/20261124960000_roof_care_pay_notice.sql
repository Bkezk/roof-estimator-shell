-- A Roof Care plan that is signed and not paid (owner, Nov 24: "will they get an notification
-- when there is a sign up but no payement? they should and then it should remind after 2 days if
-- no movement").
--
-- 1. roof_care_plans.pay_notified_at: when the admins and the managers were last told that the
--    plan waits for its payment. Empty = never told.
-- 2. roof_care_pay_notice_claim(p_plan, p_days): the plans to tell now, each stamped in the same
--    statement, so two passes at once tell a plan once between them.
--      - With p_plan: that plan alone, and only its first notice (at the sign-up).
--      - Without: every waiting plan never told, and every one last told p_days or more ago.
--        Sending the payment link again counts as movement: the days start over from it.
--    A plan that is paid or ended is not in status 'awaiting_payment', so it is never told.
-- 3. roof_care_pay_notice_release(p_plan, p_was): a send that failed puts the stamp back.
--
-- The site's server alone calls the two functions (service_role). No row is changed by this
-- file itself.

alter table public.roof_care_plans add column if not exists pay_notified_at timestamptz;

comment on column public.roof_care_plans.pay_notified_at is
  'When the office was last told this plan is signed and waits for its payment (the notice plan_needs_payment). Empty: never told.';

create or replace function public.roof_care_pay_notice_claim(
  p_plan uuid default null,
  p_days integer default 2
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
         p.pay_notified_at is null
         or (p_plan is null
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

revoke all on function public.roof_care_pay_notice_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.roof_care_pay_notice_claim(uuid, integer) to service_role;

create or replace function public.roof_care_pay_notice_release(p_plan uuid, p_was timestamptz)
returns void
language sql security definer set search_path = public as $$
  update public.roof_care_plans
     set pay_notified_at = p_was
   where id = p_plan and status = 'awaiting_payment';
$$;

revoke all on function public.roof_care_pay_notice_release(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.roof_care_pay_notice_release(uuid, timestamptz) to service_role;
