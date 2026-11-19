-- Roof Care: what the owner decided on Nov 19 after the audit ("Go with 1, 6, 7, 8", and of the
-- minor repairs allowance: "have that under the plan status ... think about how we can ensure
-- this is followed. I like the tick idea").
--
--   1. An inspection's share of the plan goes on one live invoice, and no second one.
--   7. A second-inspection window with under two weeks left rolls to the next window.
--   8. The office's 30 days of push-back count from each inspection's own first date. Every
--      reason is kept.
--  10. The yearly minor repairs allowance: kept on the plan at sign-up, taken from by a line on
--      a repair invoice, never past what is left. A repair invoice at a property with allowance
--      left is not finalised until someone has answered whether it uses the plan.

-- ── 10: the allowance on the plan, and the answer on the invoice ───────────────────────────
alter table public.roof_care_plans
  add column if not exists repair_allowance numeric not null default 0;
alter table public.invoices
  add column if not exists care_allowance_choice text;
alter table public.invoices
  add column if not exists care_allowance_plan_id uuid
    references public.roof_care_plans (id) on delete set null;
do $c$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_care_allowance_choice_check') then
    alter table public.invoices
      add constraint invoices_care_allowance_choice_check
      check (care_allowance_choice is null or care_allowance_choice in ('applied', 'declined'));
  end if;
end $c$;

-- ── 7 and 10: the sign-up ───────────────────────────────────────────────────────────────────
create or replace function public.roof_care_sign_up(
  p_site uuid, p_plan text, p_sqft numeric, p_hours numeric, p_miles numeric,
  p_estimated boolean, p_first text, p_days integer, p_agreed_by text, p_notes text,
  p_terms text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_site public.crm_sites%rowtype;
  v_price jsonb;
  v_row jsonb;
  v_plan uuid;
  v_from date; v_by date;
  v2_from date; v2_by date;
  v_renews date;
  v_name text;
  v_allowance numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_site from public.crm_sites where id = p_site and deleted_at is null;
  if not found or v_site.account_id is null then
    raise exception 'That property was not found';
  end if;
  if not (public.has_access('customers')
          or (public.has_access('service')
              and (not public.is_technician() or public.tech_sees_site(p_site))))
  then
    raise exception 'You can sign up a property you have a ticket at' using errcode = '42501';
  end if;
  if p_plan is null or p_plan not in ('watch', 'care', 'guard') then
    raise exception 'Pick the plan';
  end if;
  if exists (select 1 from public.roof_care_plans where site_id = p_site and status = 'active') then
    raise exception 'This property already has a Roof Care plan';
  end if;
  if coalesce(trim(p_agreed_by), '') = '' then
    raise exception 'Type the name of the person who agreed to the plan';
  end if;
  if coalesce(trim(p_terms), '') = '' then
    raise exception 'The customer has to agree to the plan''s terms';
  end if;
  if p_first is null or p_first not in ('now', 'days', 'window') then
    raise exception 'Pick when the first inspection is';
  end if;
  if p_first = 'days' and (p_days is null or p_days < 1 or p_days > 365) then
    raise exception 'Type how many days to push the first inspection back (1 to 365)';
  end if;
  if p_hours is null or p_miles is null then
    raise exception 'The drive to this address has not been worked out, so there is no price yet';
  end if;
  v_price := public.roof_care_price(p_sqft, p_hours, p_miles);
  if not coalesce((v_price->>'ready')::boolean, false) then
    raise exception 'The Roof Care plan prices are not set up yet. Ask an admin.';
  end if;
  if coalesce((v_price->>'custom_quote')::boolean, false) then
    raise exception 'A roof this size gets a custom quote. Call the office.';
  end if;
  select e into v_row from jsonb_array_elements(v_price->'plans') e where e->>'plan' = p_plan;

  if p_first = 'now' then
    v_from := v_today; v_by := v_today;
  elsif p_first = 'days' then
    v_from := v_today + p_days; v_by := v_from;
  else
    select w.w_from, w.w_to into v_from, v_by
      from public.roof_care_windows(v_today) w
     where w.w_from > v_today
     order by w.w_from limit 1;
  end if;
  v_renews := (v_today + interval '1 year')::date;
  -- The second inspection: the first window still open four months after the first, with at
  -- least two weeks of it left (Nov 19: one-day windows came out of this); else the next one.
  select x.f, x.t into v2_from, v2_by
    from (select greatest(w.w_from, v_from + 120) as f, w.w_to as t
            from public.roof_care_windows(v_from + 120) w) x
   where x.t - x.f >= 13
   order by x.f limit 1;
  -- Inside the plan year when it fits, and never under two weeks; the renewal follows an
  -- inspection that ends after it.
  if v2_from <= v_renews then
    v2_by := least(v2_by, greatest(v_renews, v2_from + 13));
  end if;
  v_renews := greatest(v_renews, v2_by);

  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  -- The plan's yearly minor repairs allowance, as the price setup has it today (Nov 19).
  select coalesce(nullif(s.data->'plans'->p_plan->>'allowance', '')::numeric, 0) into v_allowance
    from public.roof_care_settings s
   order by s.updated_at desc nulls last limit 1;
  insert into public.roof_care_plans (
    account_id, site_id, plan, signed_on, renews_on, roof_sqft, drive_hours, drive_miles,
    price_estimated, list_price, travel_price, price, first_visit, agreed_by,
    sold_by, sold_by_name, notes, terms_version, repair_allowance)
  values (
    v_site.account_id, p_site, p_plan, v_today, v_renews, p_sqft, p_hours, p_miles,
    coalesce(p_estimated, false),
    (v_row->>'list')::numeric, (v_row->>'travel')::numeric, (v_row->>'price')::numeric,
    p_first, trim(p_agreed_by), auth.uid(), coalesce(v_name, ''), coalesce(trim(p_notes), ''),
    trim(p_terms), greatest(coalesce(v_allowance, 0), 0))
  returning id into v_plan;
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (v_plan, 'visit1', v_from, v_by, v_by, (v_row->>'visit1')::numeric),
         (v_plan, 'visit2', v2_from, v2_by, v2_by, (v_row->>'visit2')::numeric);
  perform public.roof_care_make_tickets(v_plan);
  return v_plan;
end;
$function$;
revoke all on function public.roof_care_sign_up(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text) from public, anon;
grant execute on function public.roof_care_sign_up(uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text) to authenticated, service_role;

-- ── 8: push back ────────────────────────────────────────────────────────────────────────────
-- The following inspection still moves with the one pushed, but its own first date stays where
-- it was, so the days it was carried count against its 30. It used to move, which let the
-- office leave the second inspection sixty days late with no manager. A reason is added to the
-- ones before it; a push with no reason leaves them as they are.
create or replace function public.roof_care_push_back(p_visit uuid, p_days integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.roof_care_visits%rowtype;
  p public.roof_care_plans%rowtype;
  j record;
  v_new_by date;
  v_total integer;
  v_last date;
  v_name text;
  v_set_day boolean;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_technician() or not (public.has_access('service') or public.has_access('customers')) then
    raise exception 'Only the office pushes a care plan inspection back' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Type how many days to push it back (1 to 365)';
  end if;
  select * into v from public.roof_care_visits where id = p_visit for update;
  if not found then
    raise exception 'That inspection was not found';
  end if;
  select * into p from public.roof_care_plans where id = v.plan_id for update;
  if p.status <> 'active' then
    raise exception 'This plan has ended';
  end if;
  select sj.id, sj.stage, sj.scheduled_date into j
    from public.service_jobs sj
   where sj.roof_care_visit_id = v.id and sj.deleted_at is null
   order by sj.created_at desc limit 1;
  if found and j.stage not in ('open', 'scheduled') then
    raise exception 'This inspection is already done';
  end if;
  v_new_by := v.due_by + p_days;
  v_total := v_new_by - v.first_due_by;
  if v_total > 30 then
    if not (public.is_admin() or public.is_manager()) then
      raise exception 'That puts this inspection % days past its first date. More than 30 days needs a manager.', v_total
        using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'Type the reason. This inspection would be % days past its first date.', v_total;
    end if;
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  v_set_day := v.due_from = v.due_by;
  update public.roof_care_visits
     set due_by = v_new_by,
         due_from = case when v_set_day then v_new_by else due_from end,
         push_reason = case
           when v_reason is null then push_reason
           else concat_ws('; ', nullif(push_reason, ''),
                  to_char((now() at time zone 'America/New_York')::date, 'Mon FMDD') || ': '
                    || v_reason || case when v_name <> '' then ' (' || v_name || ')' else '' end)
         end,
         pushed_at = now(),
         pushed_by_name = v_name
   where id = v.id;
  update public.roof_care_visits x
     set due_from = x.due_from + p_days,
         due_by = x.due_by + p_days
   where x.plan_id = v.plan_id and x.id <> v.id and x.kind <> 'storm' and v.kind <> 'storm'
     and x.due_from > v.due_from
     and not exists (
       select 1 from public.service_jobs j2
        where j2.roof_care_visit_id = x.id and j2.deleted_at is null
          and j2.stage not in ('open', 'scheduled'));
  select max(x.due_by) into v_last
    from public.roof_care_visits x where x.plan_id = p.id and x.kind <> 'storm';
  update public.roof_care_plans
     set renews_on = greatest(renews_on, v_last), updated_at = now()
   where id = p.id;
  if j.id is not null then
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    values (j.id, 'note',
            'Care plan inspection pushed back ' || p_days || case when p_days = 1 then ' day' else ' days' end
              || '. Now due by ' || to_char(v_new_by, 'Mon FMDD, YYYY') || '.'
              || case when v_reason is not null then ' Reason: ' || v_reason else '' end,
            v_name);
  end if;
  return jsonb_build_object(
    'job_id', j.id,
    'date_from', j.scheduled_date,
    'date_to', case when j.scheduled_date is not null then j.scheduled_date + p_days end,
    'due_by', v_new_by,
    'days_past_first', v_total);
end;
$function$;
revoke all on function public.roof_care_push_back(uuid, integer, text) from public, anon;
grant execute on function public.roof_care_push_back(uuid, integer, text) to authenticated, service_role;

-- ── 1 and 10: the two kinds of Roof Care line on an invoice ─────────────────────────────────
-- 'roof-care:<inspection>' is the plan's own line: an inspection's share of the yearly price.
-- 'roof-care-allowance:<plan>' takes minor repairs off a repair invoice against the plan.
create or replace function public.invoice_lines_care_rule()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_other text;
  v_plan uuid;
  v_allow numeric;
  v_used numeric;
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
  return new;
end;
$function$;
revoke all on function public.invoice_lines_care_rule() from public, anon, authenticated;
drop trigger if exists invoice_lines_care_rule on public.invoice_lines;
create trigger invoice_lines_care_rule
  before insert or update of source, total, invoice_id on public.invoice_lines
  for each row execute function public.invoice_lines_care_rule();

-- ── 10: the answer comes before Finalise ────────────────────────────────────────────────────
-- A customer's repair invoice at a property whose plan has allowance left is not finalised
-- until someone has chosen: it uses the plan, or it does not. So the allowance is never
-- forgotten, and a choice not to use it has a name on it in the history.
create or replace function public.invoices_care_allowance_rule()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_site uuid;
  v_visit uuid;
  v_plan uuid;
  v_allow numeric;
  v_used numeric;
  v_billable numeric;
begin
  if not (old.status = 'draft' and new.status not in ('draft', 'void')) then
    return new;
  end if;
  if new.service_job_id is null or new.bill_to_vendor_id is not null
     or new.care_allowance_choice is not null then
    return new;
  end if;
  select j.site_id, j.roof_care_visit_id into v_site, v_visit
    from public.service_jobs j where j.id = new.service_job_id;
  if v_site is null or v_visit is not null then
    return new;
  end if;
  select p.id, p.repair_allowance into v_plan, v_allow
    from public.roof_care_plans p
   where p.site_id = v_site and p.status = 'active' and p.repair_allowance > 0
   limit 1;
  if not found then
    return new;
  end if;
  select coalesce(sum(-l.total), 0) into v_used
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where l.source = 'roof-care-allowance:' || v_plan and i.status <> 'void';
  select coalesce(sum(l.total), 0) into v_billable
    from public.invoice_lines l
   where l.invoice_id = new.id and coalesce(l.source, '') not like 'roof-care-allowance:%';
  if v_allow - v_used < 0.005 or v_billable < 0.005 then
    return new;
  end if;
  raise exception 'This property has a Roof Care plan with $% of minor repairs left this plan year. Choose on the invoice whether it uses the plan, then finalise.',
    trim(to_char(v_allow - v_used, '999,999,990.00'));
end;
$function$;
revoke all on function public.invoices_care_allowance_rule() from public, anon, authenticated;
drop trigger if exists invoices_care_allowance_rule on public.invoices;
create trigger invoices_care_allowance_rule
  before update of status on public.invoices
  for each row execute function public.invoices_care_allowance_rule();
