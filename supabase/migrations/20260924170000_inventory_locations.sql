-- Inventory locations (owner, Sep 24): stock sits at the shop (the hub) or on a service vehicle.
-- Every movement now says WHERE it happened; on hand is the per-location sum. Checking stock
-- out to a vehicle is a transfer (two rows sharing pair_id: -qty at the shop, +qty on the
-- vehicle). What comes back is transferred to the shop; what does not is written off the
-- vehicle as 'vehicle_used' (assumed used on service calls). Jobs still draw from the shop.
create table if not exists public.inventory_locations (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('shop','vehicle')),
  sort integer not null default 0,
  active boolean not null default true
);
-- Sorted by plate, with the two "08" plates kept apart by the N2 / V3 ones (owner, Sep 24).
insert into public.inventory_locations (id, name, kind, sort) values
  ('shop', 'Shop', 'shop', 0),
  ('veh-n2x384', 'Service vehicle - N2X384', 'vehicle', 1),
  ('veh-08-d4l983', 'Service vehicle - 08 D4L983', 'vehicle', 2),
  ('veh-v3c058', 'Service vehicle - V3C058', 'vehicle', 3),
  ('veh-08-995892', 'Service vehicle - 08 995892', 'vehicle', 4)
on conflict (id) do nothing;
alter table public.inventory_locations enable row level security;
drop policy if exists inventory_locations_read on public.inventory_locations;
create policy inventory_locations_read on public.inventory_locations for select to authenticated using (true);
drop policy if exists inventory_locations_write on public.inventory_locations;
create policy inventory_locations_write on public.inventory_locations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.inventory_movements
  add column if not exists location_id text not null default 'shop' references public.inventory_locations(id),
  add column if not exists pair_id uuid;
create index if not exists inventory_movements_location_idx
  on public.inventory_movements (location_id, screen_id, row_label, price_col);
alter table public.inventory_movements drop constraint if exists inventory_movements_reason_check;
alter table public.inventory_movements add constraint inventory_movements_reason_check
  check (reason in ('leftover','adjustment','damaged','allocated','released','consumed',
                    'transfer_out','transfer_in','vehicle_used'));
-- Inventory-only logins may load / unload vehicles and write off what a vehicle used; count
-- adjustments and damage stay with Estimate access. Mirrors src/lib/inventory.functions.ts.
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (
    public.has_access('estimate')
    or (public.has_access('inventory')
        and reason in ('leftover','consumed','transfer_out','transfer_in','vehicle_used'))
  );
