-- Invoices for trade bids (owner, Nov 16: "Yes we need printed proposals and invoices … idk if
-- what we are doing will need service tickets the same way a roof does"; Nov 17: "Go with
-- option 1, T-1001 format").
--
-- An invoice has belonged to a service ticket and worn the ticket's number. A trade job has no
-- ticket, so an invoice may now belong to a won trade bid instead: the same table, the same
-- Draft, Final, Paid and Void, the same PDF and payment. What differs is the parent and the
-- number: a trade bid takes a job number of its own from a series that starts at 1001, shown as
-- "T-1001". A second invoice on the same bid (a deposit and a final) is "T-1001.2", as a
-- ticket's second invoice is "6012.2".
--
-- What this adds (idempotent; no existing row changes, the invoices table is empty today):
--   1. invoices.bid_id, and service_job_id may be null: every invoice has exactly one parent.
--   2. bids.trade_number and the series it is taken from; trade_bid_number() hands a bid its
--      number the first time it is invoiced.
--   3. A bid with a live invoice cannot be deleted, as a ticket with one cannot.
--
-- Who: making an invoice is what it has been, an admin's, a manager's and the Invoices tick's
-- (the invoices_office policy, unchanged).

-- 1 ── an invoice's parent: a ticket or a trade bid ─────────────────────────────────────────
alter table public.invoices alter column service_job_id drop not null;
-- cascade, as a ticket's invoices go with the ticket (invoices_service_job_id_fkey). Section 3
-- refuses to delete a bid while one of its invoices is live, so the only invoices that can go
-- with a bid are voided ones, when the bid is removed for good from Recently deleted. (restrict
-- would leave a deleted bid with a voided invoice impossible to purge, and the purge of old
-- deleted bids removes them all in one statement.)
alter table public.invoices add column if not exists bid_id uuid;
alter table public.invoices drop constraint if exists invoices_bid_id_fkey;
alter table public.invoices
  add constraint invoices_bid_id_fkey
  foreign key (bid_id) references public.bids(id) on delete cascade;
alter table public.invoices drop constraint if exists invoices_one_parent;
alter table public.invoices
  add constraint invoices_one_parent
  check ((service_job_id is not null) <> (bid_id is not null));
create index if not exists invoices_bid_idx on public.invoices (bid_id) where bid_id is not null;

-- 2 ── the trade job number ─────────────────────────────────────────────────────────────────
create sequence if not exists public.trade_bid_number_seq as integer start with 1001;
revoke all on sequence public.trade_bid_number_seq from public, anon, authenticated;

alter table public.bids add column if not exists trade_number integer;
create unique index if not exists bids_trade_number_key
  on public.bids (trade_number) where trade_number is not null;
alter table public.bids drop constraint if exists bids_trade_number_kind;
alter table public.bids
  add constraint bids_trade_number_kind check (trade_number is null or kind = 'trade');

-- The bid's number, taken from the series the first time and the same every time after. Only a
-- won trade bid is invoiced, and only by someone who may make invoices. SECURITY DEFINER: the
-- Invoices tick does not come with Estimate access, which is what may change a bid.
create or replace function public.trade_bid_number(p_bid uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_bid public.bids%rowtype;
begin
  if not (public.is_admin() or public.is_manager() or public.is_sales_pm()) then
    raise exception 'Only an admin, a manager or someone with Invoices access makes an invoice'
      using errcode = '42501';
  end if;
  select * into v_bid from public.bids where id = p_bid for update;
  if not found or v_bid.deleted_at is not null then
    raise exception 'Bid not found (it may have been deleted)' using errcode = 'P0002';
  end if;
  if v_bid.kind <> 'trade' then
    raise exception 'Only a trade bid is invoiced from the bid' using errcode = '22023';
  end if;
  if v_bid.status <> 'won' then
    raise exception 'Mark the bid Won before invoicing it' using errcode = '22023';
  end if;
  if v_bid.trade_number is null then
    update public.bids
       set trade_number = nextval('public.trade_bid_number_seq')
     where id = p_bid
    returning trade_number into v_bid.trade_number;
  end if;
  return v_bid.trade_number;
end;
$function$;
revoke all on function public.trade_bid_number(uuid) from public, anon;
grant execute on function public.trade_bid_number(uuid) to authenticated;

-- 3 ── a bid with a live invoice stays ──────────────────────────────────────────────────────
-- Deleting (the bin) or removing for good is refused while an invoice on the bid is not void.
-- SECURITY DEFINER: an estimator deletes bids and cannot read invoices, so the check must not
-- depend on what the person deleting may see.
create or replace function public.bids_invoiced_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_numbers text;
begin
  if tg_op = 'UPDATE' and not (old.deleted_at is null and new.deleted_at is not null) then
    return new;
  end if;
  select string_agg(coalesce(i.display_number, i.number::text), ', ' order by i.created_at)
    into v_numbers
    from public.invoices i
   where i.bid_id = old.id and i.status <> 'void';
  if v_numbers is not null then
    raise exception 'This bid has an invoice (%). Void the invoice before deleting the bid.',
      v_numbers using errcode = '23503';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
drop trigger if exists bids_invoiced_guard on public.bids;
create trigger bids_invoiced_guard
  before delete or update of deleted_at on public.bids
  for each row execute function public.bids_invoiced_guard();
revoke all on function public.bids_invoiced_guard() from public, anon, authenticated;
