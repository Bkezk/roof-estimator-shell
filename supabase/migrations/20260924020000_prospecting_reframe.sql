-- Prospecting reframe (owner, Sep 24): prospecting finds NEW business; the estimator already
-- holds the job history. So:
--   * roofs get a `condition` (what a salesperson sees / a report card prints);
--   * "own book" is no longer copied into buildings — it is a LEAD LIST read from accepted bids
--     on demand (warranty clock), via a SECURITY DEFINER function so a Prospecting login that
--     lacks Estimate access can still see the list. Bids are never written here.
alter table public.roofs add column if not exists condition text
  check (condition in ('good','fair','poor','unknown'));

create or replace function public.warranty_leads()
returns table (
  bid_id uuid,
  bid_name text,
  customer_name text,
  address text,
  city text,
  state text,
  zip text,
  start_date text,
  warranty_name text,
  updated_at timestamptz,
  building_id uuid
)
language sql stable security definer set search_path = public as $$
  select b.id,
         b.name,
         b.data->'customer'->>'name',
         b.data->'customer'->>'projectAddress',
         b.data->'customer'->>'jobCity',
         b.data->'customer'->>'jobState',
         b.data->'customer'->>'jobZip',
         b.data->>'startDate',
         b.data->>'warrantyName',
         b.updated_at,
         b.building_id
    from public.bids b
   where b.deleted_at is null
     and b.status = 'accepted'
     and public.has_access('prospect')
   order by b.updated_at desc
   limit 1000;
$$;
revoke all on function public.warranty_leads() from public;
grant execute on function public.warranty_leads() to authenticated;
