-- Bid statuses cut to four (owner, Sep 24): draft, submitted, won, lost. Legacy states fold in
-- (in_progress / finished / review / final → draft; accepted → won; denied → lost). A lost bid
-- may carry a reason (seeded choices in src/lib/bid-status.ts; free text allowed).
alter table public.bids add column if not exists lost_reason text;
update public.bids set status = case status
  when 'in_progress' then 'draft' when 'finished' then 'draft' when 'review' then 'draft' when 'final' then 'draft'
  when 'accepted' then 'won' when 'denied' then 'lost' else status end
 where status in ('in_progress','finished','review','final','accepted','denied');
-- Warranty leads are the roofs we installed: won bids.
create or replace function public.warranty_leads()
returns table (
  bid_id uuid, bid_name text, customer_name text, address text, city text, state text, zip text,
  start_date text, warranty_name text, updated_at timestamptz, building_id uuid
)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, b.data->'customer'->>'name', b.data->'customer'->>'projectAddress',
         b.data->'customer'->>'jobCity', b.data->'customer'->>'jobState', b.data->'customer'->>'jobZip',
         b.data->>'startDate', b.data->>'warrantyName', b.updated_at, b.building_id
    from public.bids b
   where b.deleted_at is null and b.status = 'won' and public.has_access('prospect')
   order by b.updated_at desc
   limit 1000;
$$;
