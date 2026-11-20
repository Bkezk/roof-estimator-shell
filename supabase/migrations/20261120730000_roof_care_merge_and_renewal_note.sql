-- Roof Care: two follow-ups to the Nov 20 break test fixes.
--
-- 1. Merging a customer that has a Roof Care plan. merge_accounts moved the properties, tickets,
--    bids and the rest to the customer that is kept, and left the plans naming the customer that
--    was merged away. Since 20261120710000 that also refused the merge (a customer with a plan
--    in force is held). The plans now move with their properties, and the merge goes through.
--
-- 2. The note on an inspection ticket taken off the board at a renewal said "the renewal was
--    reduced for it" every time. A renewal more than 60 days after the plan ended takes nothing
--    off (20261120690000), so the note now says that only when something was taken off.

create or replace function public.merge_accounts(p_keep uuid, p_drop uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_keep public.crm_accounts;
  v_drop public.crm_accounts;
  n_sites int; n_contacts int; n_jobs int; n_bids int; n_opps int;
  n_tasks int; n_takeoffs int; n_docs int; n_followups int;
  v_name text;
  v_parts text[] := '{}';
  v_counts jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can merge customers';
  end if;
  if p_keep = p_drop then
    raise exception 'Pick a different customer to merge into';
  end if;
  select * into v_keep from public.crm_accounts where id = p_keep and deleted_at is null for update;
  if not found then
    raise exception 'The customer to keep was not found, or is deleted';
  end if;
  select * into v_drop from public.crm_accounts where id = p_drop and deleted_at is null for update;
  if not found then
    raise exception 'The customer to merge was not found, or is deleted';
  end if;

  -- A primary contact on both: the kept customer's stays primary.
  if exists (select 1 from public.crm_contacts
              where account_id = p_keep and is_primary and deleted_at is null) then
    update public.crm_contacts set is_primary = false where account_id = p_drop and is_primary;
  end if;

  update public.crm_sites set account_id = p_keep where account_id = p_drop;
  get diagnostics n_sites = row_count;
  update public.crm_contacts set account_id = p_keep where account_id = p_drop;
  get diagnostics n_contacts = row_count;
  update public.service_jobs set account_id = p_keep, customer_name = v_keep.name where account_id = p_drop;
  get diagnostics n_jobs = row_count;
  update public.bids set account_id = p_keep where account_id = p_drop;
  get diagnostics n_bids = row_count;
  update public.crm_opportunities set account_id = p_keep where account_id = p_drop;
  get diagnostics n_opps = row_count;
  update public.tasks set account_id = p_keep, account_name = v_keep.name where account_id = p_drop;
  get diagnostics n_tasks = row_count;
  update public.takeoffs set account_id = p_keep where account_id = p_drop;
  get diagnostics n_takeoffs = row_count;
  update public.documents set account_id = p_keep where account_id = p_drop;
  get diagnostics n_docs = row_count;
  update public.crm_followups set account_id = p_keep where account_id = p_drop;
  get diagnostics n_followups = row_count;
  -- Roof Care plans go with their properties (Nov 20). Until now a plan kept naming the customer
  -- that was merged away, and the rule that holds a customer with a plan refused the merge.
  update public.roof_care_plans set account_id = p_keep where account_id = p_drop;

  -- What the kept customer lacked, from the merged one; the notes joined; the ids kept.
  update public.crm_accounts a set
    account_manager_id = coalesce(a.account_manager_id, v_drop.account_manager_id),
    external_id = coalesce(nullif(btrim(a.external_id), ''), nullif(btrim(v_drop.external_id), '')),
    billing_instructions = coalesce(nullif(btrim(a.billing_instructions), ''), nullif(btrim(v_drop.billing_instructions), '')),
    contact_name = coalesce(nullif(btrim(a.contact_name), ''), nullif(btrim(v_drop.contact_name), '')),
    mobile = coalesce(nullif(btrim(a.mobile), ''), nullif(btrim(v_drop.mobile), '')),
    phone = coalesce(nullif(btrim(a.phone), ''), nullif(btrim(v_drop.phone), '')),
    email = coalesce(nullif(btrim(a.email), ''), nullif(btrim(v_drop.email), '')),
    address1 = case when nullif(btrim(a.address1), '') is null then v_drop.address1 else a.address1 end,
    address2 = case when nullif(btrim(a.address1), '') is null then v_drop.address2 else a.address2 end,
    city = case when nullif(btrim(a.address1), '') is null then v_drop.city else a.city end,
    state = case when nullif(btrim(a.address1), '') is null then v_drop.state else a.state end,
    zip = case when nullif(btrim(a.address1), '') is null then v_drop.zip else a.zip end,
    notes = concat_ws(E'\n', nullif(a.notes, ''), nullif(v_drop.notes, '')),
    centerpoint_company_id = coalesce(a.centerpoint_company_id, v_drop.centerpoint_company_id),
    centerpoint_alias_ids = (
      select coalesce(array_agg(distinct x), '{}')
        from unnest(a.centerpoint_alias_ids || v_drop.centerpoint_alias_ids
                    || case when v_drop.centerpoint_company_id is not null
                            and v_drop.centerpoint_company_id is distinct from a.centerpoint_company_id
                            then array[v_drop.centerpoint_company_id] else '{}'::text[] end) as x),
    tax_exempt = a.tax_exempt or v_drop.tax_exempt
  where a.id = p_keep;

  -- The merged customer: deleted, with the note and where it went (merged_into).
  update public.crm_accounts set
    deleted_at = now(),
    merged_into = p_keep,
    notes = concat_ws(E'\n', nullif(notes, ''),
      'Merged into ' || v_keep.name || ' on '
      || to_char(now() at time zone 'America/New_York', 'Mon FMDD, YYYY'))
  where id = p_drop;

  if n_sites > 0 then v_parts := v_parts || (n_sites || ' propert' || case when n_sites = 1 then 'y' else 'ies' end); end if;
  if n_contacts > 0 then v_parts := v_parts || (n_contacts || ' contact' || case when n_contacts = 1 then '' else 's' end); end if;
  if n_jobs > 0 then v_parts := v_parts || (n_jobs || ' ticket' || case when n_jobs = 1 then '' else 's' end); end if;
  if n_bids > 0 then v_parts := v_parts || (n_bids || ' bid' || case when n_bids = 1 then '' else 's' end); end if;
  if n_opps > 0 then v_parts := v_parts || (n_opps || ' opportunit' || case when n_opps = 1 then 'y' else 'ies' end); end if;
  if n_tasks > 0 then v_parts := v_parts || (n_tasks || ' task' || case when n_tasks = 1 then '' else 's' end); end if;
  if n_takeoffs > 0 then v_parts := v_parts || (n_takeoffs || ' takeoff' || case when n_takeoffs = 1 then '' else 's' end); end if;
  if n_docs > 0 then v_parts := v_parts || (n_docs || ' document' || case when n_docs = 1 then '' else 's' end); end if;
  if n_followups > 0 then v_parts := v_parts || (n_followups || ' follow-up' || case when n_followups = 1 then '' else 's' end); end if;

  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), 'Unknown user')
    into v_name from public.profiles p where p.id = auth.uid();
  v_counts := jsonb_build_object(
    'merged_from', v_drop.name, 'merged_from_id', p_drop,
    'properties', n_sites, 'contacts', n_contacts, 'tickets', n_jobs, 'bids', n_bids,
    'opportunities', n_opps, 'tasks', n_tasks, 'takeoffs', n_takeoffs, 'documents', n_docs,
    'followups', n_followups);
  insert into public.audit_log (by_user, by_name, by_role, entity, entity_id, action, summary, changes)
  values (auth.uid(), coalesce(v_name, 'system'), 'admin', 'account', p_keep, 'update',
          'Customer ''' || v_drop.name || ''' merged into ''' || v_keep.name || ''''
          || case when coalesce(array_length(v_parts, 1), 0) = 0 then '' else ': ' || array_to_string(v_parts, ', ') end,
          v_counts);
  return v_counts || jsonb_build_object('kept', p_keep, 'kept_name', v_keep.name);
end;
$function$;

revoke all on function public.merge_accounts(uuid, uuid) from public, anon;
grant execute on function public.merge_accounts(uuid, uuid) to authenticated;

create or replace function public.roof_care_start(p_plan uuid, p_paid date)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_p public.roof_care_plans%rowtype;
  v_old public.roof_care_plans%rowtype;
  v_renewal boolean := false;
  v_paid date;
  v_start date;
  v_day date;
  v_from date; v_by date;
  v2_from date; v2_by date;
  v_renews date;
begin
  select * into v_p from public.roof_care_plans where id = p_plan for update;
  if not found or v_p.status <> 'awaiting_payment' then
    return;
  end if;
  -- The plan year starts the day the payment was received: never a day still to come, and
  -- never before the day the plan was signed. The inspections are dated from the day it is
  -- recorded, so none starts out already late.
  v_paid := greatest(least(coalesce(p_paid, v_today), v_today), coalesce(v_p.signed_on, v_today));
  v_start := v_paid;
  if v_p.renewed_from is not null then
    select * into v_old from public.roof_care_plans where id = v_p.renewed_from for update;
    v_renewal := found and (v_old.status = 'active'
                            or (v_old.status = 'ended' and v_old.ended_reason = 'Expired'));
  end if;
  if v_renewal then
    -- A renewal paid ahead starts when the old year is over; paid late, on the payment.
    v_start := greatest(v_paid, v_old.renews_on);
    if v_p.renewal_choice = 'full' then
      -- The customer kept us off the roof: the inspection comes along, owed for 60 more days.
      update public.roof_care_visits v
         set plan_id = p_plan, kind = 'carried', carried_from = v_old.id,
             due_from = least(v.due_from, v_start + 60), due_by = v_start + 60
       where v.id in (select o.id from public.roof_care_owed(v_old.id) o);
    end if;
    -- The old year is over. An inspection of it that was not carried is dropped: its ticket
    -- nobody had started is taken off the board. A storm inspection asked for stays.
    update public.roof_care_plans
       set status = 'ended', ended_on = coalesce(ended_on, v_today), ended_reason = 'Renewed',
           ended_by_name = 'Roof Care plans', updated_at = now()
     where id = v_old.id;
    with gone as (
      update public.service_jobs sj
         set deleted_at = now(), updated_by_name = 'Roof Care plans'
       where sj.roof_care_visit_id in (
               select v.id from public.roof_care_visits v
                where v.plan_id = v_old.id and v.kind in ('visit1', 'visit2'))
         and sj.deleted_at is null
         and sj.stage in ('open', 'scheduled')
         and sj.en_route_at is null and sj.on_site_at is null and sj.completed_at is null
         and sj.invoice_id is null
      returning sj.id
    )
    insert into public.service_job_events (service_job_id, kind, note, by_name)
    select g.id, 'note',
           'Taken off the board: the plan was renewed with this inspection not done'
             || case when coalesce(v_p.renewal_credit, 0) > 0
                     then ', and the renewal was reduced for it.' else '.' end,
           'Roof Care plans'
      from gone g;
  end if;

  if v_p.first_visit = 'now' then
    v_from := v_today; v_by := v_today;
  elsif v_p.first_visit = 'days' then
    v_from := v_today + coalesce(v_p.first_days, 1); v_by := v_from;
  else
    -- The window open that day when two weeks of it are left, else the next one to open.
    v_day := greatest(v_today, v_start);
    select greatest(w.w_from, v_day), w.w_to into v_from, v_by
      from public.roof_care_windows(v_day) w
     where w.w_from > v_day or w.w_to - v_day >= 13
     order by w.w_from limit 1;
  end if;
  v_renews := (v_start + interval '1 year')::date;
  -- The second inspection, by the sign-up's own rule (20261119200000).
  select x.f, x.t into v2_from, v2_by
    from (select greatest(w.w_from, v_from + 120) as f, w.w_to as t
            from public.roof_care_windows(v_from + 120) w) x
   where x.t - x.f >= 13
   order by x.f limit 1;
  if v2_from <= v_renews then
    v2_by := least(v2_by, greatest(v_renews, v2_from + 13));
  end if;
  -- The plan year is twelve months and no longer: it does not stretch to an inspection.

  update public.roof_care_plans
     set status = 'active', paid_on = v_paid, starts_on = v_start, renews_on = v_renews,
         updated_at = now()
   where id = p_plan;
  -- Paid for already: an inspection of this plan bills nothing.
  insert into public.roof_care_visits (plan_id, kind, due_from, due_by, first_due_by, amount)
  values (p_plan, 'visit1', v_from, v_by, v_by, 0),
         (p_plan, 'visit2', v2_from, v2_by, v2_by, 0);
  perform public.roof_care_make_tickets(p_plan);
end;
$function$;

revoke all on function public.roof_care_start(uuid, date) from public, anon, authenticated;
grant execute on function public.roof_care_start(uuid, date) to service_role;

notify pgrst, 'reload schema';
