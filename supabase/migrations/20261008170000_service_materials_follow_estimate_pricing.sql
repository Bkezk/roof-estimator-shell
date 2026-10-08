-- Owner, Oct 8: "the materials on service do need to sync with prices of the estimate pricing
-- materials where there is overlap. Can you have the service materials pull through the prices
-- from the estimate pricing and when estimate pricing materials are updated it should auto update
-- the service material pricing. I know we had it like that before but it was changed on
-- confusion" (the Oct 6 split, 20261006130000_service_materials.sql, kept the two lists apart).
--
-- The overlap is the stock link a service material already carries (stock_screen_id /
-- stock_row_label / stock_price_col — the Estimate Pricing cell it is the same item as; 89 of
-- the 143). From now on a linked material's cost IS that cell's price (× stock_per_unit when the
-- material is sold in a bigger unit: an ISO board is 32 sq ft of the catalog's per-sq-ft ISO):
--   * catalog_cell_price() reads a cell the way the app does (src/lib/invoices.server.ts cellCost
--     + catalog-row-key.ts): the row's label column is Description or Name, a repeated label is
--     keyed "label [Subtype]" / "label [Part #]", an Adhesives screen keys its products by name;
--   * saving an Estimate Pricing screen re-costs every service material linked to it (trigger
--     on pricing_catalog); an Estimate cell with no price (blank) leaves the service cost alone;
--   * a linked material takes the catalog cost on insert and on every update (a cost typed on
--     Setup › Material pricing cannot override it — the screen shows it read-only);
--   * the one-off sync below brings the 76 drifted costs in line now.
-- Service-only materials (no link) keep their own cost. Estimate Pricing is never written.
-- Applied live the same day through the Lovable database tool.

create or replace function public.catalog_cell_price(
  p_screen text, p_row_label text, p_price_col text
) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  d jsonb;
  cols jsonb;
  label_col text;
  r jsonb;
  lbl text;
  disc text;
  n int;
  v text;
begin
  if p_screen is null or p_row_label is null or p_price_col is null then return null; end if;
  select data into d from public.pricing_catalog where id = p_screen;
  if d is null then return null; end if;
  -- Adhesives: products by name, one price.
  if d->>'kind' = 'adhesives' then
    select p->>'price' into v from jsonb_array_elements(coalesce(d->'products', '[]'::jsonb)) p
     where p->>'name' = p_row_label limit 1;
    return case when v ~ '^-?[0-9]+(\.[0-9]+)?$' then v::numeric end;
  end if;
  cols := coalesce(d->'columns', '[]'::jsonb);
  select c into label_col from jsonb_array_elements_text(cols) c where c in ('Description', 'Name') limit 1;
  if label_col is null then
    label_col := coalesce(cols->>0, 'Description');
  end if;
  if p_price_col = label_col then return null; end if;
  for r in select * from jsonb_array_elements(coalesce(d->'rows', '[]'::jsonb)) loop
    lbl := btrim(coalesce(r->>label_col, ''));
    if lbl = p_row_label then
      v := r->>p_price_col;
      return case when v ~ '^-?[0-9]+(\.[0-9]+)?$' then v::numeric end;
    end if;
    -- A repeated label is keyed with its Subtype or Part # (catalog-row-key.ts rowKeys).
    if p_row_label like lbl || ' [%]' then
      select count(*) into n from jsonb_array_elements(coalesce(d->'rows', '[]'::jsonb)) x
       where btrim(coalesce(x->>label_col, '')) = lbl;
      if n > 1 then
        disc := coalesce(nullif(btrim(coalesce(r->>'Subtype', '')), ''), nullif(btrim(coalesce(r->>'Part #', '')), ''));
        if disc is not null and p_row_label = lbl || ' [' || disc || ']' then
          v := r->>p_price_col;
          return case when v ~ '^-?[0-9]+(\.[0-9]+)?$' then v::numeric end;
        end if;
      end if;
    end if;
  end loop;
  return null;
end; $$;
revoke all on function public.catalog_cell_price(text, text, text) from public;
comment on function public.catalog_cell_price(text, text, text) is
  'The price in one Estimate Pricing cell (screen id, row label as the app keys it, price column); null when the row, column or price is absent.';

-- What a linked service material costs per its own unit: the cell price × stock units per unit.
create or replace function public.service_material_catalog_cost(
  p_screen text, p_row_label text, p_price_col text, p_stock_per_unit numeric
) returns numeric
language sql stable security definer set search_path = public as $$
  select round(public.catalog_cell_price(p_screen, p_row_label, p_price_col) * coalesce(p_stock_per_unit, 1), 4);
$$;
revoke all on function public.service_material_catalog_cost(text, text, text, numeric) from public;

-- Re-cost the linked materials of one screen (or every screen when null). Returns how many moved.
create or replace function public.sync_service_material_costs(p_screen text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  moved integer;
begin
  with want as (
    select m.id,
           public.service_material_catalog_cost(m.stock_screen_id, m.stock_row_label, m.stock_price_col, m.stock_per_unit) as cost
      from public.service_materials m
     where m.stock_screen_id is not null
       and (p_screen is null or m.stock_screen_id = p_screen)
  )
  update public.service_materials m
     set cost = w.cost
    from want w
   where w.id = m.id and w.cost is not null and w.cost <> m.cost;
  get diagnostics moved = row_count;
  return moved;
end; $$;
revoke all on function public.sync_service_material_costs(text) from public;

-- Saving an Estimate Pricing screen re-costs the service materials linked to it.
create or replace function public.pricing_catalog_recost_service()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then return new; end if;
  perform public.sync_service_material_costs(new.id);
  return new;
end; $$;
revoke all on function public.pricing_catalog_recost_service() from public;
drop trigger if exists pricing_catalog_recost_service on public.pricing_catalog;
create trigger pricing_catalog_recost_service after insert or update of data on public.pricing_catalog
  for each row execute function public.pricing_catalog_recost_service();

-- A linked material's cost is the catalog's, on insert and on every update (a typed cost does
-- not stick); a cell with no price leaves whatever cost the row has.
create or replace function public.service_material_follows_catalog()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c numeric;
begin
  if new.stock_screen_id is not null then
    c := public.service_material_catalog_cost(new.stock_screen_id, new.stock_row_label, new.stock_price_col, new.stock_per_unit);
    if c is not null then new.cost := c; end if;
  end if;
  return new;
end; $$;
revoke all on function public.service_material_follows_catalog() from public;
drop trigger if exists service_materials_follow_catalog on public.service_materials;
create trigger service_materials_follow_catalog before insert or update on public.service_materials
  for each row execute function public.service_material_follows_catalog();

-- Bring the linked costs in line now.
select public.sync_service_material_costs(null);
