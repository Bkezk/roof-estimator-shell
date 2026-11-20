-- Roof Care break test of Nov 20, fixes 1 and 24: what the database refuses on an invoice.
--
-- 1.  A payment taken back must not leave a plan running unseen. While a plan is in force, the
--     paid invoice it runs on cannot be voided, deleted, moved off the plan, or left holding
--     less than its total: the plan is ended first (Care Plan on the property, End plan), and
--     the refund is worked there. While a plan waits for its payment, an invoice with a payment
--     on it is not voided or deleted until the payment is taken off. After a plan has ended
--     with a refund owed, the payment the refund was worked from stays while the refund stands.
--     These hold for a signed-in person, an admin included. The database's own work is let
--     through: ending a plan voids its unpaid invoice, and removing a plan removes its invoices.
--
-- 24. What the screens never offer:
--     - an invoice leaving Void for any other status (a void gives its plan credit back, so
--       un-voiding took the credit twice);
--     - a minor repairs line or a leak call line naming a plan that is not in force at the
--       property of the invoice's ticket, or, on a plan inspection's own invoice, a plan other
--       than that inspection's;
--     - a plan's lines taking more off an invoice than its other lines add up to: the minor
--       repairs line against everything else on the invoice, the leak call line against the
--       travel it charges. Checked when the plan's line is written and again when the draft is
--       finalised;
--     - the same return trip twice on one invoice, and a return trip line for a visit that was
--       rescheduled at no charge.
--     A return trip line's price is not held to the recorded amount.

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
           coalesce(sum(l.total) filter (where coalesce(l.source, '') not like 'roof-care-allowance:%'), 0),
           coalesce(sum(-l.total) filter (where l.source like 'roof-care-travel:%'), 0),
           coalesce(sum(l.total) filter (where l.kind = 'travel'), 0)
      into v_allow, v_other, v_waived, v_travel
      from public.invoice_lines l where l.invoice_id = new.id;
    if v_allow > greatest(v_other, 0) + 0.005 then
      raise exception 'The Roof Care plan''s minor repairs take $% off this invoice, and its other lines add up to $%. Save the invoice so the amount is worked again, then finalise it.',
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

drop trigger if exists invoices_plan_guard on public.invoices;
create trigger invoices_plan_guard
  before update or delete on public.invoices
  for each row execute function public.invoices_plan_guard();

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
    select p.repair_allowance into v_allow
      from public.roof_care_plans p where p.id = v_plan for update;
    if not found then
      raise exception 'The Roof Care plan of this allowance line was not found';
    end if;
    if new.total > 0 then
      raise exception 'A plan allowance line takes money off the invoice. It cannot add to it.';
    end if;
    select coalesce(sum(-l.total), 0) into v_used
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = new.source and i.status <> 'void' and l.id is distinct from new.id;
    if v_used - new.total > v_allow + 0.005 then
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
    select p.free_travel_calls into v_calls
      from public.roof_care_plans p where p.id = v_plan for update;
    if not found then
      raise exception 'The Roof Care plan of this leak call line was not found';
    end if;
    if new.total > 0 then
      raise exception 'A leak call line takes the travel off the invoice. It cannot add to it.';
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
  -- The plan has to be in force, and this invoice has to be one of its own: a ticket at the
  -- plan's property, or the plan's own inspection. Asked when the line is put on an invoice or
  -- takes more off; a line already there is left alone when its plan later ends.
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
    if v_plan_status <> 'active' then
      raise exception 'This Roof Care plan has ended. Nothing of it can come off an invoice.';
    end if;
  end if;
  return new;
end;
$function$;

-- Checked after the whole statement, so the order the lines are written in does not matter.
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
        select coalesce(sum(-l.total) filter (where l.source like 'roof-care-allowance:%'), 0),
               coalesce(sum(l.total) filter (where coalesce(l.source, '') not like 'roof-care-allowance:%'), 0)
          into v_off, v_rest
          from public.invoice_lines l where l.invoice_id = r.invoice_id;
        if v_off > greatest(v_rest, 0) + 0.005 then
          raise exception 'A Roof Care plan''s minor repairs cannot take more off an invoice than its other lines add up to ($%).',
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
      select coalesce(sum(-l.total) filter (where l.source like 'roof-care-allowance:%'), 0),
             coalesce(sum(l.total) filter (where coalesce(l.source, '') not like 'roof-care-allowance:%'), 0)
        into v_off, v_rest
        from public.invoice_lines l where l.invoice_id = r.invoice_id;
      if v_off > greatest(v_rest, 0) + 0.005 then
        raise exception 'A Roof Care plan''s minor repairs cannot take more off an invoice than its other lines add up to ($%).',
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

drop trigger if exists invoice_lines_care_cover_ins on public.invoice_lines;
create trigger invoice_lines_care_cover_ins
  after insert on public.invoice_lines
  referencing new table as changed
  for each statement execute function public.invoice_lines_care_cover();

drop trigger if exists invoice_lines_care_cover_upd on public.invoice_lines;
create trigger invoice_lines_care_cover_upd
  after update on public.invoice_lines
  referencing old table as before new table as changed
  for each statement execute function public.invoice_lines_care_cover();

notify pgrst, 'reload schema';
