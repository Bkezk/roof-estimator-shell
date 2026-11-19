-- Roof Care: was the plan even offered? (owner, Nov 19: "we also need to track if the care plan
-- was even offered so track the care plan button click on the ticket to ensure it's being
-- offered").
--
-- Pressing Care Plan on a ticket is kept: which ticket, who pressed it, when, and whether the
-- property already had a plan then. One row for each person on each ticket, the first press.
-- Nothing is written on the ticket itself. The Owner page counts them against the tickets each
-- technician finished.

create table if not exists public.roof_care_offers (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.service_jobs (id) on delete cascade,
  site_id uuid,
  -- Kept by name if the person is later removed.
  by_user uuid references public.profiles (id) on delete set null,
  by_name text not null default '',
  had_plan boolean not null default false,
  at timestamptz not null default now()
);

create unique index if not exists roof_care_offers_one_each
  on public.roof_care_offers (job_id, by_user);
create index if not exists roof_care_offers_at on public.roof_care_offers (at);

alter table public.roof_care_offers enable row level security;

-- Read by the office, and by the person whose press it is. No write policy: the function.
drop policy if exists roof_care_offers_read on public.roof_care_offers;
create policy roof_care_offers_read on public.roof_care_offers
  for select to authenticated
  using (
    by_user = (select auth.uid())
    or (not (select public.is_technician())
        and ((select public.has_access('service')) or (select public.has_access('customers'))))
  );

revoke all on public.roof_care_offers from anon, authenticated;
grant select on public.roof_care_offers to authenticated;

create or replace function public.roof_care_mark_offered(p_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  j record;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select sj.id, sj.site_id into j
    from public.service_jobs sj where sj.id = p_job and sj.deleted_at is null;
  if not found then
    raise exception 'That ticket was not found';
  end if;
  -- Whoever may work the ticket: the office, or a technician with a ticket at the property.
  if not (public.has_access('customers')
          or (public.has_access('service')
              and (not public.is_technician()
                   or (j.site_id is not null and public.tech_sees_site(j.site_id)))))
  then
    raise exception 'That ticket is not yours to open' using errcode = '42501';
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  insert into public.roof_care_offers (job_id, site_id, by_user, by_name, had_plan)
  values (
    j.id, j.site_id, auth.uid(), coalesce(v_name, ''),
    j.site_id is not null and exists (
      select 1 from public.roof_care_plans p
       where p.site_id = j.site_id and p.status in ('active', 'awaiting_payment')))
  on conflict (job_id, by_user) do nothing;
end;
$function$;

revoke all on function public.roof_care_mark_offered(uuid) from public, anon;
grant execute on function public.roof_care_mark_offered(uuid) to authenticated;
