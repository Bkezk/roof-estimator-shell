-- Roof Care: a property or a customer is not deleted while one of its plans is in force or
-- waiting for its payment (break test Nov 20, number 17).
--
-- Until now both could be deleted: the plan went on, the morning run kept making inspection
-- tickets for a property nobody could open, and its invoices named a deleted customer. Now the
-- database refuses, in words that name the plan and say what to do: end the plan first (the
-- property page, End plan). A property whose plans have all ended is deleted as before.
--
-- Both ways of deleting are covered: the site's own (deleted_at is set) and a row removed
-- outright. Putting a deleted property or customer back is never refused.

create or replace function public.roof_care_plan_hold_words(p_site uuid, p_account uuid)
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select case p.plan when 'watch' then 'Roof Watch' when 'care' then 'Roof Care'
                     when 'guard' then 'Roof Guard' else 'Roof Care' end
         || ' plan'
         || coalesce(' #' || p.plan_number, '')
         || coalesce(' at ' || nullif(btrim(s.name), ''), '')
         || case p.status when 'awaiting_payment' then ' (waiting for its payment)'
                          else ' (in force)' end
    from public.roof_care_plans p
    left join public.crm_sites s on s.id = p.site_id
   where p.status in ('active', 'awaiting_payment')
     and ((p_site is not null and p.site_id = p_site)
          or (p_account is not null and (p.account_id = p_account or s.account_id = p_account)))
   order by (p.status = 'active') desc, p.plan_number nulls last, p.created_at
   limit 1;
$function$;

revoke all on function public.roof_care_plan_hold_words(uuid, uuid) from public, anon, authenticated;

create or replace function public.crm_sites_plan_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_plan text;
begin
  if tg_op = 'UPDATE' and not (old.deleted_at is null and new.deleted_at is not null) then
    return new;
  end if;
  v_plan := public.roof_care_plan_hold_words(old.id, null);
  if v_plan is not null then
    raise exception 'This property cannot be deleted: it has the %. End the plan first (open the property and press End plan), then delete the property.', v_plan
      using errcode = '23503';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create or replace function public.crm_accounts_plan_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_plan text;
begin
  if tg_op = 'UPDATE' and not (old.deleted_at is null and new.deleted_at is not null) then
    return new;
  end if;
  v_plan := public.roof_care_plan_hold_words(null, old.id);
  if v_plan is not null then
    if tg_op = 'UPDATE' and new.merged_into is not null then
      raise exception 'This customer cannot be merged into another: it has the %. Merge the other customer into this one instead, or end the plan first.', v_plan
        using errcode = '23503';
    end if;
    raise exception 'This customer cannot be deleted: it has the %. End the plan first (open the property and press End plan), then delete the customer.', v_plan
      using errcode = '23503';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.crm_sites_plan_hold() from public, anon, authenticated;
revoke all on function public.crm_accounts_plan_hold() from public, anon, authenticated;

drop trigger if exists crm_sites_plan_hold on public.crm_sites;
create trigger crm_sites_plan_hold
  before delete or update of deleted_at on public.crm_sites
  for each row execute function public.crm_sites_plan_hold();

drop trigger if exists crm_accounts_plan_hold on public.crm_accounts;
create trigger crm_accounts_plan_hold
  before delete or update of deleted_at on public.crm_accounts
  for each row execute function public.crm_accounts_plan_hold();
