-- Roof Care: a manager can change a refund that is owed (owner, Nov 20: "go with ... new issue
-- 2").
--
-- When a plan is ended early the refund is worked and kept on the plan (refund_due) until the
-- office marks it sent. Nothing could change it afterwards. The owner's example: the plan ended,
-- the site worked out an amount to send back, and then the customer's own check for the year
-- bounced. Nothing is owed back, and the plan went on saying a refund was owed.
--
--   roof_care_change_refund(plan, amount, reason)   a manager or an admin only. The plan has
--       ended with a refund worked, and that refund is not marked sent. The amount is 0 or
--       more, and never more than what was paid for the plan year (the same sum the refund was
--       worked from). A reason is required. Every change is kept on the plan, oldest first:
--       what it was, what it is now, why, who and when (refund_changes).
--
-- What follows the changed amount by itself, because each reads refund_due: the Needs attention
-- row "refund owed" (gone at 0), the Roof Care income on the Owner page (the refund is taken off
-- at its new amount; nothing is taken off at 0), "Mark the refund sent" (nothing to send at 0),
-- and the rule that holds the plan's payment on its invoice "while that refund stands" (at 0
-- the payment can come off, which is what a bounced check needs).

alter table public.roof_care_plans
  add column if not exists refund_changes jsonb not null default '[]'::jsonb;

comment on column public.roof_care_plans.refund_changes is
  'Each change a manager made to the refund owed, oldest first: from, to, reason, by_name, on.';

create or replace function public.roof_care_change_refund(
  p_plan uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  p public.roof_care_plans%rowtype;
  v_paid numeric;
  v_new numeric;
  v_name text;
  v_entry jsonb;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin changes a refund' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found or p.status <> 'ended' then
    raise exception 'That plan was not found, or it has not ended. A refund is worked when a plan is ended.';
  end if;
  if p.refund_due is null then
    raise exception 'This plan ended with no refund worked, so there is none to change.';
  end if;
  if p.refund_sent_on is not null then
    raise exception 'This refund was marked sent on %, so it cannot be changed.',
      to_char(p.refund_sent_on, 'Mon FMDD, YYYY');
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount < 0 then
    raise exception 'Type the refund: 0 or more';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Type why the refund is changed';
  end if;
  -- What was paid for the plan year: the sum the refund was worked from (roof_care_refund_worked).
  select coalesce(sum(i.paid_amount), 0) into v_paid
    from public.invoices i
   where i.roof_care_plan_id = p_plan and i.status <> 'void';
  if v_paid = 0 and p.card_paid_amount is not null then
    v_paid := p.card_paid_amount;
  end if;
  v_new := round(p_amount, 2);
  if v_new > v_paid then
    raise exception 'The refund cannot be more than the $% paid for this plan year.',
      trim(to_char(v_paid, '999,999,990.00'));
  end if;
  if v_new = round(p.refund_due, 2) then
    raise exception 'The refund is already $%.', trim(to_char(v_new, '999,999,990.00'));
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  v_entry := jsonb_build_object(
    'from', round(p.refund_due, 2), 'to', v_new, 'reason', trim(p_reason),
    'by_name', coalesce(v_name, ''), 'on', v_today);
  update public.roof_care_plans
     set refund_due = v_new,
         refund_changes = coalesce(refund_changes, '[]'::jsonb) || jsonb_build_array(v_entry),
         updated_at = now()
   where id = p_plan;
  return v_entry;
end;
$function$;

revoke all on function public.roof_care_change_refund(uuid, numeric, text) from public, anon;
grant execute on function public.roof_care_change_refund(uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';
