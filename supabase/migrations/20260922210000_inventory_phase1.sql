-- Inventory phase 1: a third role ("field": Inventory only), the stock ledger, its settings and
-- a bid-name lookup the field role can call. Stock is keyed by the catalog cell (screen ›
-- product row key › price column) — the same identity the estimator prices and the item-number
-- map points at. On-hand is always the SUM of movements, never a stored figure. One location,
-- quantities only. Idempotent.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','estimator','field'));

-- Bids are the estimators' and admins' — a field login never reads or writes them.
drop policy if exists "bids_authenticated_all" on public.bids;
create policy "bids_authenticated_all" on public.bids
  for all to authenticated
  using (public.current_user_role() in ('admin','estimator'))
  with check (public.current_user_role() in ('admin','estimator'));

create table if not exists public.inventory_settings (
  id integer primary key default 1 check (id = 1),
  -- How an opened box / bag counts when leftovers are recorded: half, full or not at all.
  opened_box_rule text not null default 'half' check (opened_box_rule in ('half','full','ignore')),
  updated_at timestamptz not null default now()
);
insert into public.inventory_settings (id) values (1) on conflict (id) do nothing;
alter table public.inventory_settings enable row level security;
drop policy if exists inventory_settings_read on public.inventory_settings;
create policy inventory_settings_read on public.inventory_settings for select to authenticated using (true);
drop policy if exists inventory_settings_write on public.inventory_settings;
create policy inventory_settings_write on public.inventory_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists public.inventory_movements (
  id bigserial primary key,
  screen_id text not null,
  row_label text not null,
  price_col text not null,
  item_no text,
  qty numeric not null,               -- signed, in `unit`
  unit text not null,                 -- box / each / sq ft / ft / pail … as counted
  reason text not null check (reason in ('leftover','adjustment','damaged','allocated','released','consumed')),
  bid_id uuid references public.bids(id) on delete set null,
  bid_name text,                      -- snapshot, survives a deleted bid
  counted_note text,                  -- what was physically counted ("2 full boxes + 1 opened")
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_cell_idx on public.inventory_movements(screen_id, row_label, price_col);
create index if not exists inventory_movements_bid_idx on public.inventory_movements(bid_id);
alter table public.inventory_movements enable row level security;
drop policy if exists inventory_movements_read on public.inventory_movements;
create policy inventory_movements_read on public.inventory_movements for select to authenticated using (true);
-- Field users record leftovers only; adjustments / damage are estimator + admin entries.
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements for insert to authenticated
  with check (
    public.current_user_role() in ('admin','estimator')
    or (public.current_user_role() = 'field' and reason = 'leftover')
  );
drop policy if exists inventory_movements_delete on public.inventory_movements;
create policy inventory_movements_delete on public.inventory_movements for delete to authenticated using (public.is_admin());

-- Bid names for the leftover picker (a field login cannot read bids directly).
create or replace function public.inventory_bid_options()
returns table (id uuid, name text, status text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, b.status, b.updated_at
    from public.bids b
   where b.deleted_at is null and auth.uid() is not null
   order by b.updated_at desc
   limit 500;
$$;
revoke all on function public.inventory_bid_options() from public;
grant execute on function public.inventory_bid_options() to authenticated;
