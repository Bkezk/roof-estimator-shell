-- Roof Care: a technician reads a plan with the money left out (break test Nov 20, numbers 27
-- and 21), and the columns the next four changes of this day use.
--
-- Until now a technician with a ticket at a property could ask the database for the plan's own
-- row: its price, the drive charge the sign-up hides, its refund sums, and the amount on a "no
-- access" record he made himself. No screen showed them; the database answered all the same.
-- And the Care Plan pop-up counted the inspections done from the tickets that technician could
-- read, so it said "1 of 2 done" when a colleague had done the other.
--
-- Now the three tables stop answering a technician directly. What his screens need comes from
-- three functions that leave the money out and count from every ticket:
--   roof_care_field_plans(sites)   the plans at properties he has a ticket at: plan, state,
--                                  dates, what it includes, each inspection with its ticket's
--                                  stage (whoever the ticket is with) and its cleaning answers
--   roof_care_field_no_access(job) the "no access" records he made on a ticket, no amount
--   roof_care_field_cleaning(visit) one inspection's cleaning answers
-- What a plan includes is not money: the minor repairs it includes a year and its leak calls
-- are what the technician tells the customer on the roof, and stay.
--
-- The office reads as before: its row rules are the same three conditions as yesterday.

-- ── Columns of this day's other changes ─────────────────────────────────────────────────────
-- An inspection we will not do (number 20), and who added a storm inspection (number 7).
alter table public.roof_care_visits
  add column if not exists skipped_on date,
  add column if not exists skip_reason text,
  add column if not exists skipped_by_name text,
  add column if not exists added_by_name text;

-- The roof size against the map at the sign-up (number 4).
--   size_map_sqft          what the map showed for the property when the plan was signed
--   size_unchecked         the map had no size, so the typed one was taken unchecked
--   size_confirmed_on/by   a manager or an admin said the typed size is right
alter table public.roof_care_plans
  add column if not exists size_map_sqft numeric,
  add column if not exists size_unchecked boolean not null default false,
  add column if not exists size_confirmed_on date,
  add column if not exists size_confirmed_by_name text;

-- ── Who may see a property's plan ───────────────────────────────────────────────────────────
create or replace function public.roof_care_site_seen(p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select auth.uid() is not null and (
    public.has_access('customers')
    or public.has_access('estimate')
    or (public.has_access('service') and not public.is_technician())
    or public.tech_sees_site(p_site));
$function$;

revoke all on function public.roof_care_site_seen(uuid) from public, anon, authenticated;

/* May the signed-in person see this plan at all? For server code that then reads one thing of
   it with the server's own key (the card payment page). */
create or replace function public.roof_care_plan_seen(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.roof_care_plans p
     where p.id = p_plan and public.roof_care_site_seen(p.site_id));
$function$;

revoke all on function public.roof_care_plan_seen(uuid) from public, anon;
grant execute on function public.roof_care_plan_seen(uuid) to authenticated;

-- ── The plans, money left out ───────────────────────────────────────────────────────────────
create or replace function public.roof_care_field_plans(p_sites uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(jsonb_agg(x.plan order by x.signed_on desc, x.created_at desc), '[]'::jsonb)
    from (
      select p.signed_on, p.created_at,
             jsonb_build_object(
               'id', p.id, 'account_id', p.account_id, 'site_id', p.site_id,
               'plan', p.plan, 'status', p.status, 'pay_first', p.pay_first,
               'plan_number', p.plan_number, 'first_visit', p.first_visit,
               'first_days', p.first_days, 'starts_on', p.starts_on, 'signed_on', p.signed_on,
               'renews_on', p.renews_on, 'roof_sqft', p.roof_sqft,
               'price_estimated', p.price_estimated,
               -- What the plan includes, as the customer was told it.
               'repair_allowance', p.repair_allowance,
               'free_travel_calls', p.free_travel_calls,
               'pay_method', p.pay_method,
               'closed_out_on', p.closed_out_on, 'closed_out_reason', p.closed_out_reason,
               'renewed_from', p.renewed_from,
               'agreed_by', p.agreed_by, 'sold_by_name', p.sold_by_name,
               'ended_on', p.ended_on, 'ended_reason', p.ended_reason,
               'forecast_sent_on', p.forecast_sent_on,
               'size_unchecked', p.size_unchecked,
               'visits', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', v.id, 'kind', v.kind, 'due_from', v.due_from, 'due_by', v.due_by,
                          'first_due_by', v.first_due_by,
                          -- A storm inspection beyond the ones included: said, with no amount.
                          'extra', coalesce(v.amount, 0) > 0,
                          'push_reason', v.push_reason, 'pushed_by_name', v.pushed_by_name,
                          'customer_asked', v.customer_asked, 'lost_on', v.lost_on,
                          'skipped_on', v.skipped_on, 'skip_reason', v.skip_reason,
                          'skipped_by_name', v.skipped_by_name,
                          'drains_cleaned', v.drains_cleaned,
                          'gutters_cleaned', v.gutters_cleaned,
                          'cleaning_note', v.cleaning_note,
                          'cleaning_by_name', v.cleaning_by_name, 'cleaning_at', v.cleaning_at,
                          -- The inspection's ticket, whoever it is with: its stage is what
                          -- "done" is counted from.
                          'ticket', (
                            select jsonb_build_object(
                                     'id', j.id, 'number', j.number, 'stage', j.stage,
                                     'scheduled_date', j.scheduled_date,
                                     'completed_at', j.completed_at,
                                     'mine', (j.technician_id = auth.uid()
                                              or public.is_on_crew(j.id)))
                              from public.service_jobs j
                             where j.roof_care_visit_id = v.id and j.deleted_at is null
                             order by j.created_at
                             limit 1))
                          order by v.due_from, v.kind), '[]'::jsonb)
                   from public.roof_care_visits v
                  where v.plan_id = p.id)) as plan
        from public.roof_care_plans p
       where p.site_id = any (coalesce(p_sites, '{}'::uuid[]))
         and public.roof_care_site_seen(p.site_id)
    ) x;
$function$;

revoke all on function public.roof_care_field_plans(uuid[]) from public, anon;
grant execute on function public.roof_care_field_plans(uuid[]) to authenticated;

-- ── The "no access" records a person made on a ticket, no amount ────────────────────────────
create or replace function public.roof_care_field_no_access(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'on_date', n.on_date, 'note', n.note, 'by_name', n.by_name,
           'charged', n.charged, 'at', n.at) order by n.at), '[]'::jsonb)
    from public.service_jobs j
    join public.roof_care_no_access n on n.visit_id = j.roof_care_visit_id
   where j.id = p_job and auth.uid() is not null and n.by_user = auth.uid();
$function$;

revoke all on function public.roof_care_field_no_access(uuid) from public, anon;
grant execute on function public.roof_care_field_no_access(uuid) to authenticated;

-- ── One inspection's cleaning answers ───────────────────────────────────────────────────────
create or replace function public.roof_care_field_cleaning(p_visit uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
           'id', v.id, 'plan_id', v.plan_id, 'kind', v.kind, 'plan', p.plan,
           'drains_cleaned', v.drains_cleaned, 'gutters_cleaned', v.gutters_cleaned,
           'cleaning_note', v.cleaning_note, 'cleaning_by_name', v.cleaning_by_name,
           'cleaning_at', v.cleaning_at)
    from public.roof_care_visits v
    join public.roof_care_plans p on p.id = v.plan_id
   where v.id = p_visit and public.roof_care_site_seen(p.site_id);
$function$;

revoke all on function public.roof_care_field_cleaning(uuid) from public, anon;
grant execute on function public.roof_care_field_cleaning(uuid) to authenticated;

-- ── The tables stop answering a technician ──────────────────────────────────────────────────
-- The office's three conditions are yesterday's; the technician's "a property I have a ticket
-- at" is gone from the plans (and so from the inspections, which follow the plans), and "a
-- record I made" is gone from the no access records.
alter policy roof_care_plans_read on public.roof_care_plans
  using (
    (select public.has_access('customers'))
    or (select public.has_access('estimate'))
    or ((select public.has_access('service')) and not (select public.is_technician())));

alter policy roof_care_no_access_read on public.roof_care_no_access
  using (
    not (select public.is_technician())
    and ((select public.has_access('service')) or (select public.has_access('customers'))));

notify pgrst, 'reload schema';
