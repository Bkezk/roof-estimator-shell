/* Nov 23, the owner on the four new issues: "1. A go, 2 go".

   1. A card payment link the customer can open from an email. Each plan gets a long random
      token of its own. The site's public page /pay/<token> shows that plan's name, property
      and amount and opens the card payment page. Nothing is granted to the anonymous role:
      the page's server functions read with the site's own key, as the two QR pages do.
   2. An opportunity made from a public request is set to Won the day its plan is paid and
      starts, by whichever way the payment arrives (a check recorded on the invoice, or the
      card), not the day the plan is signed. Its follow-up is closed with it. */

alter table public.roof_care_plans
  add column if not exists pay_token uuid not null default gen_random_uuid(),
  add column if not exists pay_link_sent_at timestamptz;
create unique index if not exists roof_care_plans_pay_token on public.roof_care_plans (pay_token);

/* The limit on the public payment page, beside the two the QR pages have. */
alter table public.public_form_hits drop constraint if exists public_form_hits_kind_check;
alter table public.public_form_hits
  add constraint public_form_hits_kind_check check (kind in ('quote', 'request', 'pay'));

create or replace function public.public_form_take(p_kind text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
  v_one_cap integer;
  v_all_cap integer;
  v_one integer;
  v_all integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts requests' using errcode = '42501';
  end if;
  if p_kind = 'quote' then
    v_one_cap := 20; v_all_cap := 400;
  elsif p_kind = 'request' then
    v_one_cap := 5; v_all_cap := 60;
  elsif p_kind = 'pay' then
    -- Nov 23: the card payment link in a customer's email. Opening it and pressing Pay each
    -- count. A link is a long random address nobody can guess; this only stops hammering.
    v_one_cap := 30; v_all_cap := 2000;
  else
    return false;
  end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 80 or p_key = '*' then
    return false;
  end if;
  delete from public.public_form_hits where bucket < now() - interval '3 days';
  select n into v_all from public.public_form_hits
   where kind = p_kind and key = '*' and bucket = v_day;
  select n into v_one from public.public_form_hits
   where kind = p_kind and key = p_key and bucket = v_hour;
  if coalesce(v_all, 0) >= v_all_cap or coalesce(v_one, 0) >= v_one_cap then
    return false;
  end if;
  insert into public.public_form_hits (kind, key, bucket, n) values (p_kind, '*', v_day, 1)
    on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1;
  insert into public.public_form_hits (kind, key, bucket, n) values (p_kind, p_key, v_hour, 1)
    on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1;
  return true;
end;
$function$;

revoke all on function public.public_form_take(text, text) from public, anon, authenticated;
grant execute on function public.public_form_take(text, text) to service_role;

/* A paid plan wins the opportunity of the request it was signed from, and closes its
   follow-up. One already Won, Lost, No response or deleted is left as it is. */
create or replace function public.roof_care_plan_wins_opportunity(p_plan uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select distinct q.opportunity_id as id
      from public.public_requests q
     where q.roof_care_plan_id = p_plan and q.opportunity_id is not null
  loop
    update public.crm_opportunities o
       set status = 'won', updated_by_name = 'Payment received'
     where o.id = r.id and o.deleted_at is null
       and o.status not in ('won', 'lost', 'no_response');
    if found then
      v_n := v_n + 1;
      perform set_config('jbk.followup_sync', 'on', true);
      update public.crm_followups
         set status = 'closed', closed_at = now(), closed_reason = 'status won',
             closed_by_sync = true
       where kind = 'opportunity' and item_id = r.id and status = 'open';
      perform set_config('jbk.followup_sync', '', true);
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.roof_care_plan_wins_opportunity(uuid) from public, anon, authenticated;

create or replace function public.roof_care_plans_paid_wins()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    -- Recording a payment must never fail because of the opportunity. A fault here is logged
    -- and the payment stands; the opportunity is then set to Won by hand.
    begin
      perform public.roof_care_plan_wins_opportunity(new.id);
    exception when others then
      raise warning 'Roof Care plan %: its opportunity was not set to Won (%)', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$function$;

revoke all on function public.roof_care_plans_paid_wins() from public, anon, authenticated;

drop trigger if exists roof_care_plans_paid_wins on public.roof_care_plans;
create trigger roof_care_plans_paid_wins
  after insert or update of status on public.roof_care_plans
  for each row execute function public.roof_care_plans_paid_wins();

/* The office's answer to a request (20261123200000), with the paid plan's Won step. */
create or replace function public.public_request_handle(
  p_id uuid,
  p_status text,
  p_account uuid default null,
  p_site uuid default null,
  p_opportunity uuid default null,
  p_plan uuid default null,
  p_reason text default null)
returns public.public_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  q public.public_requests;
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.has_access('customers') then
    raise exception 'Only the office handles the requests from the public pages'
      using errcode = '42501';
  end if;
  select * into q from public.public_requests where id = p_id for update;
  if not found then
    raise exception 'That request was not found' using errcode = 'P0002';
  end if;
  if p_status is null or p_status not in ('matched', 'dismissed', 'new') then
    raise exception 'Say what happened to the request: matched or dismissed' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(pr.full_name), ''), nullif(btrim(pr.email), ''), 'Unknown user')
    into v_name from public.profiles pr where pr.id = auth.uid();
  if p_status = 'dismissed' then
    if q.status = 'matched' then
      raise exception 'This request is already matched to a customer, so it is not dismissed'
        using errcode = 'P0001';
    end if;
    if v_reason is null or char_length(v_reason) > 500 then
      raise exception 'Type why the request is dismissed, in a few words' using errcode = '22023';
    end if;
    update public.public_requests
       set status = 'dismissed', dismiss_reason = v_reason, handled_at = now(),
           handled_by = auth.uid(), handled_by_name = v_name
     where id = p_id returning * into q;
    return q;
  end if;
  if p_status = 'new' then
    -- Put back on the list: a dismissal taken back. A matched request stays matched.
    if q.status <> 'dismissed' then
      raise exception 'Only a dismissed request is put back on the list' using errcode = 'P0001';
    end if;
    update public.public_requests
       set status = 'new', dismiss_reason = null, handled_at = null, handled_by = null,
           handled_by_name = null
     where id = p_id returning * into q;
    return q;
  end if;
  if q.status = 'dismissed' then
    raise exception 'This request was dismissed. Put it back on the list first.'
      using errcode = 'P0001';
  end if;
  if coalesce(p_account, q.account_id) is null then
    raise exception 'Pick the customer this request belongs to' using errcode = '22023';
  end if;
  if p_account is not null and not exists (
       select 1 from public.crm_accounts a where a.id = p_account and a.deleted_at is null)
  then
    raise exception 'That customer was not found, or is deleted' using errcode = 'P0002';
  end if;
  if p_site is not null and not exists (
       select 1 from public.crm_sites s
        where s.id = p_site and s.deleted_at is null
          and s.account_id = coalesce(p_account, q.account_id))
  then
    raise exception 'That property is not this customer''s' using errcode = '22023';
  end if;
  update public.public_requests
     set status = 'matched',
         account_id = coalesce(p_account, account_id),
         site_id = coalesce(p_site, site_id),
         opportunity_id = coalesce(p_opportunity, opportunity_id),
         roof_care_plan_id = coalesce(p_plan, roof_care_plan_id),
         handled_at = coalesce(handled_at, now()),
         handled_by = coalesce(handled_by, auth.uid()),
         handled_by_name = coalesce(handled_by_name, v_name)
   where id = p_id returning * into q;
  -- Nov 23: the request's own opportunity gets the customer and the property with it.
  if q.opportunity_id is not null then
    update public.crm_opportunities o
       set account_id = q.account_id,
           site_id = coalesce(q.site_id, o.site_id),
           updated_by_name = v_name
     where o.id = q.opportunity_id
       and o.deleted_at is null
       and (o.account_id is distinct from q.account_id
            or (q.site_id is not null and o.site_id is distinct from q.site_id));
  end if;
  -- Nov 23 (owner: "2 go"): the opportunity is Won when the plan is paid, not when it is
  -- signed. A plan that is already paid when the request is pointed at it is Won now.
  if q.roof_care_plan_id is not null and exists (
       select 1 from public.roof_care_plans p
        where p.id = q.roof_care_plan_id and p.status = 'active')
  then
    perform public.roof_care_plan_wins_opportunity(q.roof_care_plan_id);
  end if;
  return q;
end;
$function$;

revoke all on function public.public_request_handle(uuid, text, uuid, uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.public_request_handle(uuid, text, uuid, uuid, uuid, uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
