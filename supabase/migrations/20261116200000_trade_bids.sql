-- Trade Bids (owner, Nov 16: "were talking about expanding into other areas so we need a way to
-- bid them … fill it in for painting save it, fill it in for siding save it" … "I don't want
-- that list combined with project bids, but I do want the statuses, owners page, needs
-- attention, and margin report to accurately reflect the trade bids, a saved bid should keep its
-- own numbers").
--
-- A trade bid is a row of public.bids like a roofing bid, so its status, its due date, its
-- reminders, the owner page, Needs attention and the Margin report all count it by the rules
-- they already have. What tells the two apart is one new column, `kind`. Every existing row is
-- a roofing bid ('roof', the default), so nothing that exists changes.
--
-- What this adds (idempotent; no existing row is changed beyond taking the default):
--   1. trade_types   a job type set up once (Painting, Siding): its name and its setup (what a
--                    bid measures, materials, labor, flat costs, overhead, profit, tax), as the
--                    rules in src/lib/trade-bid.ts read it. A starting point only: a bid copies
--                    the setup when it is started and keeps its copy (bids.data).
--   2. bids.kind and bids.trade_type_id.
--   3. warranty_leads() lists roofs we installed: roofing bids only.
--
-- Who: reading a trade is for whoever bids (Estimate access, the rule on bids since
-- 20260923020000); setting one up is an admin's and a manager's.

-- 1 ── the job types ───────────────────────────────────────────────────────────────────────
create table if not exists public.trade_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  setup jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
-- One Painting, whatever the capitals or the spaces around it.
create unique index if not exists trade_types_name_key
  on public.trade_types (lower(btrim(name)));

alter table public.trade_types enable row level security;

drop policy if exists trade_types_read on public.trade_types;
create policy trade_types_read on public.trade_types
  for select to authenticated using ((select public.has_access('estimate')));
drop policy if exists trade_types_write on public.trade_types;
create policy trade_types_write on public.trade_types
  for all to authenticated
  using ((select public.is_admin()) or (select public.is_manager()))
  with check ((select public.is_admin()) or (select public.is_manager()));

revoke all on public.trade_types from anon, public, authenticated;
grant select, insert, update, delete on public.trade_types to authenticated;
grant all on public.trade_types to service_role;

-- 2 ── which kind of bid a row is ──────────────────────────────────────────────────────────
alter table public.bids
  add column if not exists kind text not null default 'roof';
alter table public.bids drop constraint if exists bids_kind_check;
alter table public.bids
  add constraint bids_kind_check check (kind in ('roof', 'trade'));
-- The trade a bid was started from. A deleted trade leaves the bid whole (its setup is its
-- own): the pointer goes to null and `kind` still says what the bid is.
alter table public.bids
  add column if not exists trade_type_id uuid references public.trade_types(id) on delete set null;
alter table public.bids drop constraint if exists bids_trade_type_kind;
alter table public.bids
  add constraint bids_trade_type_kind check (trade_type_id is null or kind = 'trade');
create index if not exists bids_kind_live_idx
  on public.bids (kind, updated_at desc) where deleted_at is null;

-- A bid never changes kind: a roofing bid's data means nothing to the trade calculator and the
-- other way round.
create or replace function public.bids_kind_fixed()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.kind is distinct from old.kind then
    raise exception 'A bid cannot change from % to %', old.kind, new.kind using errcode = '42501';
  end if;
  return new;
end;
$function$;
drop trigger if exists bids_kind_fixed on public.bids;
create trigger bids_kind_fixed
  before update of kind on public.bids
  for each row execute function public.bids_kind_fixed();
revoke all on function public.bids_kind_fixed() from public, anon, authenticated;

-- 3 ── warranty leads are roofs ────────────────────────────────────────────────────────────
-- The function as it stood (20260924120000_bid_status_four.sql) with the kind added.
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
   where b.deleted_at is null and b.status = 'won' and b.kind = 'roof'
     and public.has_access('prospect')
   order by b.updated_at desc
   limit 1000;
$$;
