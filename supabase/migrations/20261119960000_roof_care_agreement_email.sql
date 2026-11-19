-- Roof Care: the agreement and the receipt go to the customer by email, and the sign-up says what
-- each plan includes (owner, Nov 19: "the terms need to be emailed to the customer at signup as
-- well as a receipt ideally", and "the care plan menu … will likely be customer facing so we
-- need it to … explain the plans").
--
--   1. The customer's email is kept on the plan, with when the agreement and the receipt went
--      out and why one did not (lib/roof-care-email.server.ts sends them).
--   2. roof_care_set_email(): the person who signed the plan up, or the office, gives or
--      corrects the address. A changed address gets the agreement and the receipt again.
--   3. roof_care_benefits(): the numbers a plan's description needs (the minor repairs each
--      year, the leak calls with no trip charge, the storm inspections), for anyone signed in.
--      They are what the customer is told; the costs behind the prices stay with the admins.

alter table public.roof_care_plans
  add column if not exists customer_email text,
  add column if not exists agreement_sent_at timestamptz,
  add column if not exists agreement_error text,
  add column if not exists receipt_sent_at timestamptz,
  add column if not exists receipt_error text;

comment on column public.roof_care_plans.customer_email is
  'Where the agreement and the receipt are emailed; null when the customer gave none.';

-- 2. The customer's email ------------------------------------------------------------------------
create or replace function public.roof_care_set_email(p_plan uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  p public.roof_care_plans%rowtype;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into p from public.roof_care_plans where id = p_plan for update;
  if not found then
    raise exception 'That plan was not found';
  end if;
  -- The office, or the person who signed it up while it still waits for its payment.
  if not ((not public.is_technician()
           and (public.has_access('service') or public.has_access('customers')))
          or (p.sold_by = auth.uid() and p.status = 'awaiting_payment')) then
    raise exception 'Only the office changes the email on a Roof Care plan' using errcode = '42501';
  end if;
  if v_email is not null
     and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'That does not look like an email address';
  end if;
  if v_email is not distinct from p.customer_email then
    return;
  end if;
  update public.roof_care_plans
     set customer_email = v_email,
         agreement_sent_at = null, agreement_error = null,
         receipt_sent_at = null, receipt_error = null,
         updated_at = now()
   where id = p_plan;
end;
$function$;

revoke all on function public.roof_care_set_email(uuid, text) from public, anon;
grant execute on function public.roof_care_set_email(uuid, text) to authenticated;

-- 3. What each plan includes, in numbers ---------------------------------------------------------
create or replace function public.roof_care_benefits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  d jsonb;
  v_calls integer;
  v_storms integer;
  amt numeric;
  k text;
  o jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select s.data into d from public.roof_care_settings s
   order by s.updated_at desc nulls last limit 1;
  if d is null then
    return null;
  end if;
  v_calls := least(greatest(round(coalesce(nullif(d->>'guard_leak_calls', '')::numeric, 0))::integer, 0), 24);
  v_storms := greatest(round(coalesce(nullif(d->>'guard_storm_inspections', '')::numeric, 0))::integer, 0);
  foreach k in array array['watch', 'care', 'guard'] loop
    amt := greatest(coalesce(nullif(d->'plans'->k->>'allowance', '')::numeric, 0), 0);
    o := o || jsonb_build_object(k, jsonb_build_object(
      'allowance', amt,
      'leak_calls', case when k = 'guard' then v_calls else 0 end,
      'storm', case when k = 'guard' then v_storms else 0 end));
  end loop;
  return o;
end;
$function$;

revoke all on function public.roof_care_benefits() from public, anon;
grant execute on function public.roof_care_benefits() to authenticated;
