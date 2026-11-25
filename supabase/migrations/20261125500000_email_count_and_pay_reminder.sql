-- The day's email count and the "signed, not paid" reminder (the audit of Nov 25, 2026; owner,
-- Nov 25: "go on ... 25 (ill do the plan change later) ... 27"). The email plan and its limit
-- stay as they are: no number is changed here.
--
-- 1. Only an email the service accepted counts (fix 25).
--      - email_take is replaced. It does what it did, and its answer now also names the row it
--        counted (`id`). Nothing else in it changes: the limit, the four fifths, a customer's
--        email never held, a limit of 0 never holding.
--      - email_give_back(p_id, p_alerted) is new. The server calls it when the email service
--        refused the email or could not be reached: the row is taken out of the count again.
--        When that email was the one that reached four fifths (p_alerted), the "told at four
--        fifths" stamp is cleared too, so the admins are told by the email that really gets
--        there. Before, a failed send stayed counted: a service that refused every email had
--        staff emails held and the admins told "80 of today's 100 are used" with nothing sent.
--      - A staff email that waited for the count used to be kept on its notice as an email
--        error, and Admin › Reminders listed it under Recent failures. The server no longer
--        writes it there, and the ones already written are cleared (the notices themselves
--        are not touched). How many waited is on Setup › QR pages, as before.
--
-- 2. The "still not paid" reminder goes at 8:00, by the office's days (fix 27).
--      - roof_care_pay_remind_due(p_last, p_now, p_days) is new: the rule, with no table in
--        it. A plan last told (or last sent its payment link) on day D is due again on the
--        first working day that is at least p_days days after D, from 8:00 on the office's
--        clock. Before, the rule was "48 hours since": a plan signed on a Monday at 2:15 PM
--        was reminded on Wednesday afternoon, and one told at night was reminded at night.
--      - roof_care_pay_notice_claim is replaced, with the same four settings and the same
--        answer. The reminder asks the rule above. A plan whose bank payment is clearing
--        (bank_pending_at set) is not told while it clears; a bank payment that fails clears
--        the stamp, and the reminder starts again by itself. A stamp older than 10 days no
--        longer holds anything back: a payment that long on its way needs somebody to look.
--      - Unchanged: the notice of a sign-up, a card plan's 30 minutes, the payment link
--        starting the days over, and that only a plan that waits for its payment is told (a
--        plan in force with an open invoice for a roof size difference is never claimed).
--
-- The site's server alone calls these functions (service_role).
-- Applied on the live database by hand (AGENTS.md).

-- A bank payment in flight is stamped here by 20261125100000. Named again so that this file
-- also runs on its own.
alter table public.roof_care_plans add column if not exists bank_pending_at timestamptz;

-- ── 1. The email count ──────────────────────────────────────────────────────────────────────

/* Before an email goes out. `staff` is an email to one of us about a notice; `customer` is
   anything sent to somebody with no bell. Answers whether to send it, `alert` = 'near' the one
   time the count passes four fifths of the day's limit, and `id`: the row it counted, which
   the server gives back (email_give_back) when the email does not go. */
create or replace function public.email_take(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cap integer;
  v_hold integer;
  v_used integer;
  v_id bigint;
  s public.email_state;
  v_alert text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts emails' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('staff', 'customer') then
    raise exception 'An email is to staff or to a customer' using errcode = '22023';
  end if;
  select email_daily_cap into v_cap from public.public_form_settings where id = 1;
  v_cap := coalesce(v_cap, 100);
  delete from public.email_sends where at < now() - interval '60 days';
  -- One at a time: the next email waits for this one's count.
  select * into s from public.email_state where id = 1 for update;
  select count(*) into v_used from public.email_sends
   where at > now() - interval '24 hours' and not held;
  if v_cap <= 0 then
    -- A plan with no daily limit: counted, never held.
    insert into public.email_sends (kind) values (p_kind) returning id into v_id;
    return jsonb_build_object('send', true, 'used', v_used + 1, 'cap', 0, 'id', v_id);
  end if;
  -- The email service's own count, when it told us lately and it is the higher of the two.
  if s.resend_at is not null and s.resend_at > now() - interval '1 hour'
     and coalesce(s.resend_used, 0) > v_used
  then
    v_used := s.resend_used;
  end if;
  v_hold := floor(v_cap * 0.8)::integer;
  if p_kind = 'staff' and v_used >= v_hold then
    insert into public.email_sends (kind, held) values ('staff', true);
    return jsonb_build_object('send', false, 'why', 'held', 'used', v_used, 'cap', v_cap);
  end if;
  insert into public.email_sends (kind) values (p_kind) returning id into v_id;
  v_used := v_used + 1;
  if v_used >= v_hold
     and (s.near_told_at is null or s.near_told_at < now() - interval '24 hours')
  then
    update public.email_state set near_told_at = now() where id = 1;
    v_alert := 'near';
  end if;
  return jsonb_build_object(
    'send', true, 'alert', v_alert, 'used', v_used, 'cap', v_cap, 'id', v_id);
end;
$function$;

/* The email did not go: its row is taken out of the count. Only a row counted as sent, and
   only lately (an email is given back right after its send fails). With p_alerted, that email
   was the one that reached four fifths: the stamp is cleared, so the next one that gets there
   tells the admins. Answers whether a row was given back. */
create or replace function public.email_give_back(p_id bigint, p_alerted boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts emails' using errcode = '42501';
  end if;
  if p_id is null then
    return false;
  end if;
  -- One at a time with email_take: no email is counted between the two steps here.
  perform 1 from public.email_state where id = 1 for update;
  delete from public.email_sends
   where id = p_id and not held and at > now() - interval '1 hour';
  get diagnostics v_n = row_count;
  if v_n > 0 and coalesce(p_alerted, false) then
    update public.email_state set near_told_at = null where id = 1;
  end if;
  return v_n > 0;
end;
$function$;

revoke all on function public.email_take(text) from public, anon, authenticated;
grant execute on function public.email_take(text) to service_role;
revoke all on function public.email_give_back(bigint, boolean) from public, anon, authenticated;
grant execute on function public.email_give_back(bigint, boolean) to service_role;

-- A staff email that waited is not a failure: the ones written on a notice before today are
-- taken off Admin › Reminders' Recent failures. The notice stays as it is.
update public.notifications
   set email_error = null
 where email_error like 'Not emailed: most of today''s email limit is used%';

-- ── 2. The "still not paid" reminder ────────────────────────────────────────────────────────

/* Is a plan last told (or last sent its payment link) at p_last due for its reminder at p_now?
   By the office's days, not by hours: due from 8:00 on the first working day that is at least
   p_days days after the day of p_last. The twin of planPayReminderDue in
   src/lib/roof-care-pay-notice.ts. */
create or replace function public.roof_care_pay_remind_due(
  p_last timestamptz,
  p_now timestamptz,
  p_days integer default 2
)
returns boolean
language sql
stable
set search_path = public
as $function$
  select p_last is not null
     and p_now is not null
     -- A working day: Monday (1) to Friday (5) on the office's calendar.
     and extract(isodow from (p_now at time zone 'America/New_York')) < 6
     -- From 8:00 on the office's clock.
     and (p_now at time zone 'America/New_York')::time >= time '08:00'
     -- At least p_days days after the day it was last told.
     and (p_now at time zone 'America/New_York')::date
         >= (p_last at time zone 'America/New_York')::date + greatest(coalesce(p_days, 2), 1);
$function$;

revoke all on function public.roof_care_pay_remind_due(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.roof_care_pay_remind_due(timestamptz, timestamptz, integer) to service_role;

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
       -- A bank payment is clearing: nothing is said while it is on its way. One that fails
       -- clears the stamp, and one still "on its way" after 10 days is told again.
       and (p.bank_pending_at is null or p.bank_pending_at < now() - interval '10 days')
       and (
         -- Never told: the notice of the sign-up. A card plan waits out the card screen first.
         (p.pay_notified_at is null
          and (p.pay_method is distinct from 'card'
               or (p_plan is null
                   and p.created_at
                       <= now() - make_interval(mins => greatest(coalesce(p_card_wait, 30), 1)))))
         -- Told before: the reminder, from 8:00 on the first working day that is p_days days
         -- or more after the day it was last told or its payment link was last sent.
         or (p_plan is null
             and coalesce(p_reminders, false)
             and p.pay_notified_at is not null
             and public.roof_care_pay_remind_due(
                   greatest(p.pay_notified_at, coalesce(p.pay_link_sent_at, p.pay_notified_at)),
                   now(),
                   p_days))
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
