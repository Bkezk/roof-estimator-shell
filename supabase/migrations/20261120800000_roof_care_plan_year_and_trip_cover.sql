-- Roof Care break test of Nov 20, numbers 3 and 5 (owner: "go with 3, 5, 6"): what the database
-- holds for them. Number 6 and the rest of 3 and 5 are in the site's own code.
--
-- 3. One rule for what a plan gives on an invoice, the minor repairs credit and Roof Guard's leak
--    call with no travel charge alike: work dated inside the plan's year gets what the plan gave,
--    whenever the invoice is made, also after the plan has ended. Work dated after the plan's
--    last day gets nothing of it.
--      - The work's date is the ticket's: the day it was completed; with none, the day the
--        technician was on site; with none, the day it was scheduled; with none, today. Days
--        are the office's (Eastern). roof_care_work_day().
--      - A plan in force covers work up to its last day. A plan that has ended covers work
--        dated from its first day to its last day (the day it ended when that came first) and
--        nothing else. A plan waiting for its payment covers nothing. roof_care_plan_covers().
--      - The rule of 20261120610000 refused every line naming a plan that had ended. It now
--        lets through that one case, a plan that has ended and work dated inside its year, and
--        nothing wider: another property, another plan's inspection, a plan not yet paid, and
--        work outside the year are refused as before.
--    A plan that ended early with a refund: the refund was worked from what the plan had given
--    by then, so what it gives afterwards is never handed back twice.
--      - While the refund is not sent, a later credit or leak call lowers the refund owed by
--        the same amount, and taking it off again puts the refund back. roof_care_refund_restep().
--      - Once the refund is sent, the plan gives no more than the refund counted.
--
-- 5. A return trip line's price is still the office's to type. The plan's minor repairs pay
--    toward a trip no more than the trip was worked out at (the visit's own amount); what is
--    typed above that is the customer's. On a plan inspection's own invoice the credit covers
--    the return trips, each held so, and a billed storm inspection, and nothing else on it.
--    roof_care_credit_cover(), asked when the credit line is written and again at Finalise.

create or replace function public.roof_care_work_day(p_job uuid)
returns date
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    (j.completed_at at time zone 'America/New_York')::date,
    (j.on_site_at at time zone 'America/New_York')::date,
    j.scheduled_date,
    (now() at time zone 'America/New_York')::date)
    from public.service_jobs j where j.id = p_job;
$function$;

revoke all on function public.roof_care_work_day(uuid) from public, anon, authenticated;

create or replace function public.roof_care_plan_covers(p_plan uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when p_day is null then false
    when p.status = 'active' then p.renews_on is null or p_day <= p.renews_on
    when p.status = 'ended' then
      coalesce(p.starts_on, p.signed_on) is not null
      and p.renews_on is not null
      and p_day >= coalesce(p.starts_on, p.signed_on)
      and p_day <= least(coalesce(p.ended_on, p.renews_on), p.renews_on)
    else false end
    from public.roof_care_plans p where p.id = p_plan;
$function$;

revoke all on function public.roof_care_plan_covers(uuid, date) from public, anon, authenticated;

-- What a plan's minor repairs may take off this invoice at most, from the invoice's own lines.
create or replace function public.roof_care_credit_cover(p_invoice uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_visit uuid;
  v_storm boolean;
  v_cover numeric;
begin
  select j.roof_care_visit_id into v_visit
    from public.invoices i
    join public.service_jobs j on j.id = i.service_job_id
   where i.id = p_invoice;
  if v_visit is null then
    -- A repair's invoice: everything else on it.
    select coalesce(sum(l.total), 0) into v_cover
      from public.invoice_lines l
     where l.invoice_id = p_invoice and coalesce(l.source, '') not like 'roof-care-allowance:%';
    return greatest(v_cover, 0);
  end if;
  -- A plan inspection's own invoice: the return trips, each at no more than it was worked out
  -- at, and the inspection's own line when it is a storm inspection billed by itself.
  select v.kind = 'storm' and coalesce(v.amount, 0) > 0 into v_storm
    from public.roof_care_visits v where v.id = v_visit;
  select coalesce(sum(
           case
             when l.source like 'roof-care-trip:%' then
               least(l.total, coalesce(
                 (select n.amount from public.roof_care_no_access n
                   where n.id::text = substring(l.source from 16)), l.total))
             when coalesce(v_storm, false) and l.source = 'roof-care:' || v_visit::text then l.total
             else 0
           end), 0)
    into v_cover
    from public.invoice_lines l
   where l.invoice_id = p_invoice;
  return greatest(v_cover, 0);
end;
$function$;

revoke all on function public.roof_care_credit_cover(uuid) from public, anon, authenticated;

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
      if v_status = 'active' and old.status = 'paid'
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
    if not public.roof_care_plan_covers(v_plan, v_day) then
      select least(coalesce(p.ended_on, p.renews_on), p.renews_on) into v_last
        from public.roof_care_plans p where p.id = v_plan;
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

create or replace function public.invoice_lines_care_cover()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
  v_off numeric;
  v_rest numeric;
begin
  if tg_op = 'INSERT' then
    for r in
      select distinct n.invoice_id,
             (n.source like 'roof-care-allowance:%') as allowance
        from changed n
       where n.source like 'roof-care-allowance:%' or n.source like 'roof-care-travel:%'
    loop
      if r.allowance then
        select coalesce(sum(-l.total), 0) into v_off
          from public.invoice_lines l
         where l.invoice_id = r.invoice_id and l.source like 'roof-care-allowance:%';
        v_rest := public.roof_care_credit_cover(r.invoice_id);
        if v_off > greatest(v_rest, 0) + 0.005 then
          raise exception 'A Roof Care plan''s minor repairs cannot take more off this invoice than the plan covers here ($%). On a repair''s invoice that is its other lines; on a plan inspection''s invoice it is the return trips at what they were worked out at, and a billed storm inspection.',
            trim(to_char(greatest(v_rest, 0), '999,999,990.00'));
        end if;
      else
        select coalesce(sum(-l.total) filter (where l.source like 'roof-care-travel:%'), 0),
               coalesce(sum(l.total) filter (where l.kind = 'travel'), 0)
          into v_off, v_rest
          from public.invoice_lines l where l.invoice_id = r.invoice_id;
        if v_off > greatest(v_rest, 0) + 0.005 then
          raise exception 'A Roof Care leak call line cannot take off more travel than the invoice charges ($%).',
            trim(to_char(greatest(v_rest, 0), '999,999,990.00'));
        end if;
      end if;
    end loop;
    return null;
  end if;
  -- An update: only a plan line that now takes more off, or was moved or renamed.
  for r in
    select distinct n.invoice_id,
           (n.source like 'roof-care-allowance:%') as allowance
      from changed n
      join before o on o.id = n.id
     where (n.source like 'roof-care-allowance:%' or n.source like 'roof-care-travel:%')
       and (n.total < o.total
            or n.source is distinct from o.source
            or n.invoice_id is distinct from o.invoice_id)
  loop
    if r.allowance then
      select coalesce(sum(-l.total), 0) into v_off
        from public.invoice_lines l
       where l.invoice_id = r.invoice_id and l.source like 'roof-care-allowance:%';
      v_rest := public.roof_care_credit_cover(r.invoice_id);
      if v_off > greatest(v_rest, 0) + 0.005 then
        raise exception 'A Roof Care plan''s minor repairs cannot take more off this invoice than the plan covers here ($%). On a repair''s invoice that is its other lines; on a plan inspection''s invoice it is the return trips at what they were worked out at, and a billed storm inspection.',
          trim(to_char(greatest(v_rest, 0), '999,999,990.00'));
      end if;
    else
      select coalesce(sum(-l.total) filter (where l.source like 'roof-care-travel:%'), 0),
             coalesce(sum(l.total) filter (where l.kind = 'travel'), 0)
        into v_off, v_rest
        from public.invoice_lines l where l.invoice_id = r.invoice_id;
      if v_off > greatest(v_rest, 0) + 0.005 then
        raise exception 'A Roof Care leak call line cannot take off more travel than the invoice charges ($%).',
          trim(to_char(greatest(v_rest, 0), '999,999,990.00'));
      end if;
    end if;
  end loop;
  return null;
end;
$function$;

revoke all on function public.invoice_lines_care_cover() from public, anon, authenticated;

-- A refund owed on a plan that ended early stays in step with what the plan gives afterwards.
-- The refund was worked from the minor repairs and leak call travel the plan had given by then
-- (refund_worked: repairs, travel). What it gives beyond that, on an invoice made later for work
-- dated inside its year, comes off the refund owed; taken off the invoice again, it goes back
-- on. What was lowered is kept on the plan (refund_worked: given_after, lowered), so an amount a
-- manager changed in between is lowered from there and not written over. A refund that is
-- sent is never touched: the rule above refuses the line instead.
create or replace function public.roof_care_refund_restep(p_plan uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  p public.roof_care_plans%rowtype;
  v_then numeric;
  v_now numeric;
  v_after numeric;
  v_lowered numeric;
  v_base numeric;
  v_new numeric;
begin
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found or p.status <> 'ended' or p.refund_sent_on is not null
     or p.refund_due is null or p.refund_worked is null then
    return;
  end if;
  v_then := coalesce((p.refund_worked->>'repairs')::numeric, 0)
          + coalesce((p.refund_worked->>'travel')::numeric, 0);
  select coalesce(sum(-l.total), 0) into v_now
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source in ('roof-care-allowance:' || p_plan::text, 'roof-care-travel:' || p_plan::text)
     and i.status <> 'void';
  -- What the plan has given since the refund was worked.
  v_after := greatest(round(v_now - v_then, 2), 0);
  -- The refund as it stands with nothing taken off for that: what is owed now plus what was
  -- lowered before. An amount a manager changed in between is the amount owed, so it is kept.
  v_lowered := coalesce((p.refund_worked->>'lowered')::numeric, 0);
  v_base := p.refund_due + v_lowered;
  v_new := least(v_after, v_base);
  if v_new = v_lowered
     and coalesce((p.refund_worked->>'given_after')::numeric, 0) = v_after then
    return;
  end if;
  update public.roof_care_plans
     set refund_due = round(v_base - v_new, 2),
         refund_worked = p.refund_worked
           || jsonb_build_object('given_after', v_after, 'lowered', round(v_new, 2)),
         updated_at = now()
   where id = p_plan;
end;
$function$;

revoke all on function public.roof_care_refund_restep(uuid) from public, anon, authenticated;

create or replace function public.invoice_lines_refund_step()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_src text;
begin
  foreach v_src in array array[
    case when tg_op <> 'INSERT' then old.source end,
    case when tg_op <> 'DELETE' then new.source end]
  loop
    if v_src like 'roof-care-allowance:%' then
      perform public.roof_care_refund_restep(substring(v_src from 21)::uuid);
    elsif v_src like 'roof-care-travel:%' then
      perform public.roof_care_refund_restep(substring(v_src from 18)::uuid);
    end if;
  end loop;
  return null;
end;
$function$;

revoke all on function public.invoice_lines_refund_step() from public, anon, authenticated;

drop trigger if exists invoice_lines_refund_step on public.invoice_lines;
create trigger invoice_lines_refund_step
  after insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_refund_step();

-- A void gives the plan's lines back: the refund follows.
create or replace function public.invoices_refund_step()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
begin
  if (old.status = 'void') is distinct from (new.status = 'void') then
    for r in
      select distinct l.source from public.invoice_lines l
       where l.invoice_id = new.id
         and (l.source like 'roof-care-allowance:%' or l.source like 'roof-care-travel:%')
    loop
      perform public.roof_care_refund_restep(
        substring(r.source from case when r.source like 'roof-care-allowance:%' then 21 else 18 end)::uuid);
    end loop;
  end if;
  return null;
end;
$function$;

revoke all on function public.invoices_refund_step() from public, anon, authenticated;

drop trigger if exists invoices_refund_step on public.invoices;
create trigger invoices_refund_step
  after update of status on public.invoices
  for each row execute function public.invoices_refund_step();

notify pgrst, 'reload schema';
