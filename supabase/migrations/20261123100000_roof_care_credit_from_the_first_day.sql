-- Roof Care, Nov 23 (owner: "credit only applies to work done after plans starts").
--
-- What a plan gives on an invoice, the minor repairs credit and Roof Guard's leak call with no
-- travel charge alike, goes only to work dated from the first day of the plan's year to its
-- last. Until now a plan in force also covered work dated BEFORE it started
-- (20261120800000 kept that as it had always been).
--
--   - The first day is the day the plan started; for an older plan with no start on record,
--     the day it was signed.
--   - The last day is the year's last day; for a plan that was ended early, the day it ended.
--   - A plan that ended because it was RENEWED runs to its year's last day, whenever the renewal
--     was paid. A renewal paid early is in force at once and its year is dated from the old
--     year's last day (20261120600000), so the days in between are still the old year's: work
--     done in them is covered by the old plan, never by neither.
--   - A plan inspection's own ticket carries only that plan's lines (its return trips, a billed
--     storm inspection). It is that plan's work, also when it was done a few days ahead of the
--     year's first day: the start of the year is asked only of other work.
--
-- The refusal says which it is, in plain words: before the plan started, or after its last day.

create or replace function public.roof_care_plan_covers(p_plan uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when p_day is null then false
    when p.status not in ('active', 'ended') then false
    when coalesce(p.starts_on, p.signed_on) is null then false
    when p_day < coalesce(p.starts_on, p.signed_on) then false
    when p.status = 'active' then p.renews_on is null or p_day <= p.renews_on
    when p.ended_reason = 'Renewed' then p.renews_on is not null and p_day <= p.renews_on
    else p.renews_on is not null
         and p_day <= least(coalesce(p.ended_on, p.renews_on), p.renews_on)
  end
    from public.roof_care_plans p where p.id = p_plan;
$function$;

revoke all on function public.roof_care_plan_covers(uuid, date) from public, anon, authenticated;

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
  v_rec uuid;
  v_charged boolean;
  v_job uuid;
  v_site uuid;
  v_visit uuid;
  v_own uuid;
  v_plan_site uuid;
  v_plan_status text;
  v_due numeric;
  v_sent date;
  v_worked jsonb;
  v_closed boolean := false;
  v_day date;
  v_last date;
  v_first date;
  v_waived numeric;
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
  -- The return trip after a visit we could not do: on one invoice, once, only for a visit that
  -- was charged, and never taking money off.
  if new.source like 'roof-care-trip:%' then
    select coalesce(i.display_number, '') into v_other
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and l.invoice_id <> new.invoice_id and i.status <> 'void'
     limit 1;
    if found then
      raise exception 'This return trip is already on invoice #%. It is billed once.', v_other;
    end if;
    if exists (select 1 from public.invoice_lines l
                where l.source = new.source and l.invoice_id = new.invoice_id
                  and l.id is distinct from new.id) then
      raise exception 'This return trip is already on this invoice. It is billed once.';
    end if;
    begin
      v_rec := substring(new.source from 16)::uuid;
    exception when others then
      raise exception 'This return trip line does not name a visit we could not do';
    end;
    select n.charged into v_charged from public.roof_care_no_access n where n.id = v_rec;
    if not found then
      raise exception 'The visit this return trip line names was not found';
    end if;
    if not coalesce(v_charged, false) then
      raise exception 'That visit was rescheduled at no charge, so there is no return trip to bill for it.';
    end if;
    if new.total < 0 then
      raise exception 'A return trip line charges the trip. It cannot take money off.';
    end if;
    return new;
  end if;
  if new.source like 'roof-care-allowance:%' then
    begin
      v_plan := substring(new.source from 21)::uuid;
    exception when others then
      raise exception 'This allowance line does not name a Roof Care plan';
    end;
    select p.repair_allowance, p.status, coalesce(p.refund_due, 0), p.refund_sent_on, p.refund_worked
      into v_allow, v_plan_status, v_due, v_sent, v_worked
      from public.roof_care_plans p where p.id = v_plan for update;
    if not found then
      raise exception 'The Roof Care plan of this allowance line was not found';
    end if;
    if new.total > 0 then
      raise exception 'A plan allowance line takes money off the invoice. It cannot add to it.';
    end if;
    -- A plan that ended with a refund, and the refund is sent (20261120800000): it gives no
    -- more than the refund counted, or the same money would be handed back twice.
    v_closed := v_plan_status = 'ended' and v_sent is not null and v_due > 0;
    if v_closed then
      v_allow := least(v_allow, greatest(coalesce((v_worked->>'repairs')::numeric, 0), 0));
    end if;
    select coalesce(sum(-l.total), 0) into v_used
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and i.status <> 'void' and l.id is distinct from new.id;
    if v_used - new.total > v_allow + 0.005 then
      if v_closed then
        raise exception 'This Roof Care plan ended and its refund was sent on %. The refund counted $% of minor repairs, and no more of the plan can come off an invoice.',
          to_char(v_sent, 'Mon FMDD, YYYY'),
          trim(to_char(v_allow, '999,999,990.00'));
      end if;
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
    select p.free_travel_calls, p.status, coalesce(p.refund_due, 0), p.refund_sent_on, p.refund_worked
      into v_calls, v_plan_status, v_due, v_sent, v_worked
      from public.roof_care_plans p where p.id = v_plan for update;
    if not found then
      raise exception 'The Roof Care plan of this leak call line was not found';
    end if;
    if new.total > 0 then
      raise exception 'A leak call line takes the travel off the invoice. It cannot add to it.';
    end if;
    -- The same for the leak call's travel once the plan's refund is sent (20261120800000).
    if v_plan_status = 'ended' and v_sent is not null and v_due > 0 then
      select coalesce(sum(-l.total), 0) into v_waived
        from public.invoice_lines l
        join public.invoices i on i.id = l.invoice_id
       where l.source = new.source and i.status <> 'void' and l.id is distinct from new.id;
      if v_waived - new.total > greatest(coalesce((v_worked->>'travel')::numeric, 0), 0) + 0.005 then
        raise exception 'This Roof Care plan ended and its refund was sent on %. No more of its leak calls can come off an invoice.',
          to_char(v_sent, 'Mon FMDD, YYYY');
      end if;
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
  -- This invoice has to be one of the plan's own: a ticket at the plan's property, or the
  -- plan's own inspection. And the plan has to cover the day the ticket's work was done
  -- (20261120800000, owner Nov 20): a plan in force covers work up to its last day; a plan that
  -- has ended covers work dated inside its year and nothing else. Until then a plan that had
  -- ended gave nothing, also for work done while it ran. Asked when the line is put on an
  -- invoice or takes more off; a line already there is left alone.
  if v_plan is not null
     and (tg_op = 'INSERT'
          or new.source is distinct from old.source
          or new.invoice_id is distinct from old.invoice_id
          or new.total < old.total)
  then
    select i.service_job_id into v_job from public.invoices i where i.id = new.invoice_id;
    if v_job is null then
      raise exception 'A Roof Care plan line goes on the invoice of a ticket at the plan''s property.';
    end if;
    select j.site_id, j.roof_care_visit_id into v_site, v_visit
      from public.service_jobs j where j.id = v_job;
    select p.site_id, p.status into v_plan_site, v_plan_status
      from public.roof_care_plans p where p.id = v_plan;
    if v_visit is not null then
      select v.plan_id into v_own from public.roof_care_visits v where v.id = v_visit;
      if v_own is distinct from v_plan then
        raise exception 'This invoice is for a Roof Care plan''s own inspection. Only that plan''s lines can go on it.';
      end if;
    elsif v_site is null or v_plan_site is distinct from v_site then
      raise exception 'This Roof Care plan is at another property. Nothing of it can come off this invoice.';
    end if;
    if v_plan_status = 'awaiting_payment' then
      raise exception 'This Roof Care plan is waiting for its payment, so it has not started. Nothing of it can come off an invoice yet.';
    end if;
    if v_plan_status not in ('active', 'ended') then
      raise exception 'This Roof Care plan is not in force. Nothing of it can come off an invoice.';
    end if;
    v_day := public.roof_care_work_day(v_job);
    select coalesce(p.starts_on, p.signed_on),
           case when p.status = 'ended' and p.ended_reason is distinct from 'Renewed'
                then least(coalesce(p.ended_on, p.renews_on), p.renews_on)
                else p.renews_on end
      into v_first, v_last
      from public.roof_care_plans p where p.id = v_plan;
    -- The plan's own inspection is that plan's work, also when it was done a few days ahead of
    -- the year's first day (20261123100000): the start of the year is asked only of other work.
    if v_visit is not null and v_first is not null and v_day < v_first then
      v_day := v_first;
    end if;
    if not public.roof_care_plan_covers(v_plan, v_day) then
      if v_first is not null and v_day < v_first then
        raise exception 'This ticket''s work is dated %, before the Roof Care plan started (%). A plan pays only toward work done from the day it starts. Nothing of the plan can come off this invoice.',
          to_char(v_day, 'Mon FMDD, YYYY'), to_char(v_first, 'Mon FMDD, YYYY');
      end if;
      if v_plan_status = 'ended' then
        raise exception 'This Roof Care plan has ended, and this ticket''s work is dated %, outside the plan''s year (it ran to %). Nothing of the plan can come off this invoice.',
          to_char(v_day, 'Mon FMDD, YYYY'), coalesce(to_char(v_last, 'Mon FMDD, YYYY'), 'its last day');
      end if;
      raise exception 'This ticket''s work is dated %, after the Roof Care plan''s last day (%). Nothing of the plan can come off this invoice.',
        to_char(v_day, 'Mon FMDD, YYYY'), coalesce(to_char(v_last, 'Mon FMDD, YYYY'), 'its last day');
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.invoice_lines_care_rule() from public, anon, authenticated;

notify pgrst, 'reload schema';
