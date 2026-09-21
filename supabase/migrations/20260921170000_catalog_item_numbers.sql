-- Duro-Last item numbers → catalog price cells. One row per (item number, screen, product row,
-- price column): a Duro-Last price list (Excel) is matched on item number and the matched cell
-- gets the new price. Seeded from the legacy "Part #" columns already captured on the pricing
-- screens (primary price column per screen) and the Adhesives products' part numbers.
create table if not exists public.catalog_item_numbers (
  item_no text not null,
  screen_id text not null references public.pricing_catalog(id) on delete cascade,
  row_label text not null,
  price_col text not null,
  dl_description text,
  last_price numeric,
  last_import_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (item_no, screen_id, row_label, price_col)
);

alter table public.catalog_item_numbers enable row level security;
drop policy if exists catalog_item_numbers_read on public.catalog_item_numbers;
create policy catalog_item_numbers_read on public.catalog_item_numbers
  for select to authenticated using (true);
drop policy if exists catalog_item_numbers_write on public.catalog_item_numbers;
create policy catalog_item_numbers_write on public.catalog_item_numbers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed: every "Part #" / "Open Part #" / "Closed Part #" on a flat screen → that screen's primary
-- price column (first present of the priority list); blanks and the "0" placeholders skipped.
with pri(col, p) as (
  values ('Price', 1), ('Price/Box', 2), ('Price/Part', 3), ('Price/Package', 4),
         ('White Price', 5), ('White', 6), ('Cost/Sq. Ft.', 7)
),
screen_col as (
  select pc.id, (select pri.col from pri where pc.data->'columns' ? pri.col order by pri.p limit 1) as price_col
  from public.pricing_catalog pc
  where pc.branch = 'duro_last' and pc.data->>'kind' is null
),
parts as (
  select pc.id as screen_id, coalesce(r->>'Description', r->>'Name') as row_label, trim(r->>'Part #') as item_no
    from public.pricing_catalog pc, jsonb_array_elements(coalesce(pc.data->'rows', '[]'::jsonb)) r
   where pc.branch = 'duro_last' and pc.data->>'kind' is null
  union all
  select pc.id, r->>'Description', trim(r->>'Open Part #')
    from public.pricing_catalog pc, jsonb_array_elements(coalesce(pc.data->'rows', '[]'::jsonb)) r
   where pc.id = 'duro_last:pipe_stacks'
  union all
  select pc.id, r->>'Description', trim(r->>'Closed Part #')
    from public.pricing_catalog pc, jsonb_array_elements(coalesce(pc.data->'rows', '[]'::jsonb)) r
   where pc.id = 'duro_last:pipe_stacks'
)
insert into public.catalog_item_numbers (item_no, screen_id, row_label, price_col)
select p.item_no, p.screen_id, p.row_label, sc.price_col
  from parts p join screen_col sc on sc.id = p.screen_id
 where coalesce(p.item_no, '') not in ('', '0') and coalesce(p.row_label, '') <> '' and sc.price_col is not null
on conflict do nothing;

-- Adhesives (master-detail screen): products[].part_no → that product's "price".
insert into public.catalog_item_numbers (item_no, screen_id, row_label, price_col)
select trim(pr->>'part_no'), pc.id, pr->>'name', 'price'
  from public.pricing_catalog pc, jsonb_array_elements(coalesce(pc.data->'products', '[]'::jsonb)) pr
 where pc.id = 'duro_last:adhesives' and coalesce(trim(pr->>'part_no'), '') not in ('', '0')
on conflict do nothing;
