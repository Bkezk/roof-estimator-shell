/* A public Roof Care request that starts its plan: four fixes from the audit of Nov 25, 2026
   (owner, Nov 26: "go on ... 15, 17 (just ensure its not too strict to match at all), 18 ...
   28").

   15. Two people answering the same new request made two customers, two plans, two agreements
       and two invoices. Now there is one answer:
         public_request_claim     NEW. "I am answering this request": taken before a customer or
                                  a property is made. A request somebody already answered is
                                  refused; so is one another person took in the last two minutes.
         public_request_handle    REPLACED. A second answer that names another customer or
                                  another property is refused, and so is an answer given while
                                  another person holds the request. A request that has a plan
                                  waiting or in force is not pointed at a different plan.
         roof_care_sign_up_from_request
                                  NEW. Starts the plan a request picked: it holds the request,
                                  refuses when the request already has a plan waiting or in
                                  force, signs the plan with the sign-up's own function
                                  (roof_care_sign_up_await_payment, which is not changed), and
                                  points the request at the plan in the same step. So a plan is
                                  never signed twice for one request, and never signed without
                                  the request knowing.

   18. "No payment before the roof size is confirmed" (owner, Nov 24). A size a stranger typed on
       the public page was born "checked" whenever the property had a map size and the typed one
       was not more than 20% smaller, however much larger. In roof_care_sign_up_from_request the
       size is "checked" only when a map size is known (the property's, else the one the public
       page itself read for that address) and the plan's size is within 20% of it, smaller or
       larger. Anything else is "not checked": the office confirms it before a payment is asked.
       A sign-up typed by staff in the window keeps its rule: that function is not touched.

   28. A request the database turned down for a reason the visitor can fix ("the price changed",
       "the address changed after the prices") had already used one of that visitor's five an
       hour.
         public_form_give_back    NEW. Gives one such request back to the connection's own hour
                                  and day counts, at most 20 times a day for one connection. The
                                  day's count for everyone is not given back, so the limits
                                  against a flood are what they were.

   Applied on the live database by hand (AGENTS.md). Safe to run twice. */

-- ── 15. Who is answering a request ──────────────────────────────────────────────────────────

alter table public.public_requests add column if not exists claimed_by uuid;
alter table public.public_requests add column if not exists claimed_at timestamptz;
alter table public.public_requests add column if not exists claimed_by_name text;

/* "I am answering this request." Called before a customer or a property is made for it, so the
   one who loses makes nothing. The hold lasts two minutes and is the same person's to take
   again: a try that failed half way is simply pressed again. */
create or replace function public.public_request_claim(p_id uuid)
returns public.public_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  q public.public_requests;
  v_name text;
  v_open_again boolean;
begin
  if auth.uid() is null or not public.has_access('customers') then
    raise exception 'Only the office handles the requests from the public pages'
      using errcode = '42501';
  end if;
  select * into q from public.public_requests where id = p_id for update;
  if not found then
    raise exception 'That request was not found' using errcode = 'P0002';
  end if;
  if q.status = 'dismissed' then
    raise exception 'This request was dismissed, so nothing was made. Reload the page.'
      using errcode = 'P0001';
  end if;
  -- A wrong pick put right: somebody took the customer off the request's opportunity again.
  -- The request then waits for a new answer, as long as no plan was made from it.
  v_open_again := q.roof_care_plan_id is null and exists (
    select 1 from public.crm_opportunities o
     where o.id = q.opportunity_id and o.deleted_at is null and o.account_id is null);
  if (q.status = 'matched' or q.account_id is not null or q.roof_care_plan_id is not null)
     and not v_open_again
  then
    raise exception 'Someone already said whose this request is. Reload the page to see it.'
      using errcode = 'P0001';
  end if;
  if q.claimed_by is not null and q.claimed_by <> auth.uid()
     and q.claimed_at is not null and q.claimed_at > now() - interval '2 minutes'
  then
    raise exception '% is answering this request right now. Wait a minute, then reload the page.',
      coalesce(nullif(btrim(coalesce(q.claimed_by_name, '')), ''), 'Someone else')
      using errcode = 'P0001';
  end if;
  select coalesce(nullif(btrim(pr.full_name), ''), nullif(btrim(pr.email), ''), 'Someone else')
    into v_name from public.profiles pr where pr.id = auth.uid();
  update public.public_requests
     set claimed_by = auth.uid(), claimed_at = now(),
         claimed_by_name = coalesce(v_name, 'Someone else')
   where id = p_id returning * into q;
  return q;
end;
$function$;

revoke all on function public.public_request_claim(uuid) from public, anon;
grant execute on function public.public_request_claim(uuid) to authenticated;

-- ── 15. The office's answer to a request: one answer ────────────────────────────────────────

create or replace function public.public_request_handle(
  p_id uuid, p_status text, p_account uuid default null, p_site uuid default null,
  p_opportunity uuid default null, p_plan uuid default null, p_reason text default null)
returns public.public_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  q public.public_requests;
  v_name text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_account uuid;
  v_open_again boolean;
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
  -- Nov 26 (the audit of Nov 25, number 15): one answer. The notice of a request goes to every
  -- admin and manager at once, and a second person's answer used to overwrite the first: two
  -- customers, two plans, two agreements. An answer that names another customer or another
  -- property than the one already on the request is refused. The same answer again is taken,
  -- so a retry after a failure half way still works. A wrong customer is still put right on
  -- the opportunity's own form while the request has no plan; and once somebody took the
  -- customer off the request's opportunity again, the request takes a new answer.
  v_open_again := q.roof_care_plan_id is null and exists (
    select 1 from public.crm_opportunities o
     where o.id = q.opportunity_id and o.deleted_at is null and o.account_id is null);
  if (q.status = 'matched' or q.roof_care_plan_id is not null)
     and not v_open_again
     and ((p_account is not null and q.account_id is not null and p_account <> q.account_id)
          or (p_site is not null and q.site_id is not null and p_site <> q.site_id))
  then
    raise exception 'Someone already said whose this request is. Reload the page to see it.'
      using errcode = 'P0001';
  end if;
  -- Another person took the request in the last two minutes (public_request_claim): they are
  -- making its customer right now.
  if (q.status = 'new' or v_open_again)
     and q.claimed_by is not null and q.claimed_by <> auth.uid()
     and q.claimed_at is not null and q.claimed_at > now() - interval '2 minutes'
  then
    raise exception '% is answering this request right now. Wait a minute, then reload the page.',
      coalesce(nullif(btrim(coalesce(q.claimed_by_name, '')), ''), 'Someone else')
      using errcode = 'P0001';
  end if;
  -- A request whose plan is waiting or in force is not pointed at a different plan.
  if p_plan is not null and q.roof_care_plan_id is not null and q.roof_care_plan_id <> p_plan
     and exists (select 1 from public.roof_care_plans pl
                  where pl.id = q.roof_care_plan_id
                    and pl.status in ('awaiting_payment', 'active'))
  then
    raise exception 'This request already has its plan. Reload the page to see it.'
      using errcode = 'P0001';
  end if;
  v_account := coalesce(p_account, q.account_id);
  if v_account is null then
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
          and s.account_id = v_account)
  then
    raise exception 'That property is not this customer''s' using errcode = '22023';
  end if;
  -- Nov 24: the opportunity and the plan a request is pointed at are this customer's own. An
  -- opportunity of another customer would otherwise be handed to this one further down.
  if p_opportunity is not null and not exists (
       select 1 from public.crm_opportunities o
        where o.id = p_opportunity and o.deleted_at is null
          and (o.account_id is null or o.account_id = v_account))
  then
    raise exception 'That opportunity is another customer''s, or is deleted' using errcode = '22023';
  end if;
  if p_plan is not null and not exists (
       select 1 from public.roof_care_plans pl
        where pl.id = p_plan and pl.account_id = v_account)
  then
    raise exception 'That Roof Care plan is not this customer''s' using errcode = '22023';
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

-- ── 15 and 18. The plan a request picked, started once, its size checked both ways ──────────

/* Starts the plan a public Roof Care request picked, for the office. The request must already
   be answered (matched to this property). The plan is signed by the sign-up's own function, so
   every rule of the sign-up runs and none is written twice; the person signing is the one
   calling. Then, in the same step:
     - the size is marked. "Checked" only when a map size is known and the plan's size is within
       20% of it either way; the map size is the property's, else the one the public page read
       for that address (public_requests.sqft with sqft_source 'map'). Otherwise "not checked".
     - the request points at the plan.
   Answers the new plan's id. */
create or replace function public.roof_care_sign_up_from_request(
  p_request uuid, p_site uuid, p_plan text, p_sqft numeric, p_hours numeric, p_miles numeric,
  p_estimated boolean, p_first text, p_days integer, p_agreed_by text, p_notes text,
  p_terms text, p_pay_method text, p_pay_note text default null,
  p_shown_price numeric default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  q public.public_requests;
  v_plan uuid;
  v_site_account uuid;
  v_map numeric;
  v_ref numeric;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_access('customers') then
    raise exception 'Only the office handles the requests from the public pages'
      using errcode = '42501';
  end if;
  -- The request is held until the plan is signed and tied: a second press, by anyone, waits
  -- here and then finds the plan.
  select * into q from public.public_requests where id = p_request for update;
  if not found then
    raise exception 'That request was not found' using errcode = 'P0002';
  end if;
  if q.kind <> 'care' then
    raise exception 'This request did not pick a plan.' using errcode = 'P0001';
  end if;
  if q.status = 'dismissed' then
    raise exception 'This request was dismissed, so no plan is started from it.'
      using errcode = 'P0001';
  end if;
  if q.roof_care_plan_id is not null and exists (
       select 1 from public.roof_care_plans pl
        where pl.id = q.roof_care_plan_id and pl.status in ('awaiting_payment', 'active'))
  then
    raise exception 'This request already has its plan. Reload the page to see it.'
      using errcode = 'P0001';
  end if;
  if q.status <> 'matched' or q.account_id is null then
    raise exception 'Say whose this request is first. The plan is started after that.'
      using errcode = 'P0001';
  end if;
  select s.account_id into v_site_account
    from public.crm_sites s where s.id = p_site and s.deleted_at is null;
  if q.site_id is distinct from p_site or v_site_account is distinct from q.account_id then
    raise exception 'This request is not on this property. Reload the page to see whose it is.'
      using errcode = 'P0001';
  end if;

  -- The sign-up itself, unchanged: the price, one plan to a property, a size much smaller than
  -- the map's, the terms. It refuses in its own words and nothing is then kept.
  v_plan := public.roof_care_sign_up_await_payment(
    p_site, p_plan, p_sqft, p_hours, p_miles, p_estimated, p_first, p_days, p_agreed_by,
    p_notes, p_terms, p_pay_method, p_pay_note, false, p_shown_price);

  -- Number 18: a size from the public page counts as checked only when a map agrees with it.
  select pl.size_map_sqft into v_map from public.roof_care_plans pl where pl.id = v_plan;
  v_ref := coalesce(v_map,
                    case when q.sqft_source = 'map' and q.sqft >= 500 then q.sqft end);
  update public.roof_care_plans
     set size_map_sqft = v_ref,
         size_unchecked = not coalesce(
           v_ref is not null and p_sqft >= v_ref * 0.8 and p_sqft <= v_ref * 1.2, false)
   where id = v_plan;

  select coalesce(nullif(btrim(pr.full_name), ''), nullif(btrim(pr.email), ''), 'Unknown user')
    into v_name from public.profiles pr where pr.id = auth.uid();
  update public.public_requests
     set roof_care_plan_id = v_plan,
         handled_at = coalesce(handled_at, now()),
         handled_by = coalesce(handled_by, auth.uid()),
         handled_by_name = coalesce(handled_by_name, v_name)
   where id = p_request;
  return v_plan;
end;
$function$;

revoke all on function public.roof_care_sign_up_from_request(
  uuid, uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text,
  text, numeric) from public, anon;
grant execute on function public.roof_care_sign_up_from_request(
  uuid, uuid, text, numeric, numeric, numeric, boolean, text, integer, text, text, text, text,
  text, numeric) to authenticated;

-- ── 28. A request turned down for a reason the visitor can fix is not counted against them ──

/* Gives one request back to a connection's own counts: the hour's and the day's, never below
   nothing. Called by the site's server when public_request_submit refused a request in words
   written for the visitor. At most 20 a day for one connection, counted under the connection's
   own key with ':b' after it; past that a refusal counts as it always did. The day's count for
   everyone ('*') is not touched. Answers whether one was given back. */
create or replace function public.public_form_give_back(p_kind text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz :=
    date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York';
  v_back integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the site''s own server counts requests' using errcode = '42501';
  end if;
  if p_kind is distinct from 'request' then
    return false;
  end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 80 or p_key = '*' then
    return false;
  end if;
  insert into public.public_form_hits (kind, key, bucket, n)
  values ('request', left(p_key, 78) || ':b', v_day, 1)
    on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1
    returning n into v_back;
  if v_back > 20 then
    return false;
  end if;
  update public.public_form_hits set n = n - 1
   where kind = 'request' and key = p_key and bucket = v_hour and n > 0;
  update public.public_form_hits set n = n - 1
   where kind = 'request' and key = left(p_key, 78) || ':d' and bucket = v_day and n > 0;
  return true;
end;
$function$;

revoke all on function public.public_form_give_back(text, text) from public, anon, authenticated;
grant execute on function public.public_form_give_back(text, text) to service_role;

notify pgrst, 'reload schema';
