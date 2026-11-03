-- Stock on hand per cell, summed by the database (owner, Nov 3, service review item 42): the
-- close-out's "Find any material" and the Inventory page's stock read used to page the whole
-- ledger (inventory_movements, 1,000 rows a request) to the server function and add it up
-- there, on every search of two typed characters. One grouped read of the cells instead; the
-- ledger stays the truth. security_invoker: row security on inventory_movements still decides
-- what each login sees.
create or replace view public.inventory_stock_cells
with (security_invoker = true) as
select
  m.location_id,
  m.screen_id,
  m.row_label,
  m.price_col,
  sum(m.qty)::numeric as on_hand,
  max(m.created_at) as last_at,
  (array_agg(m.unit order by m.created_at desc, m.id desc))[1] as unit
from public.inventory_movements m
group by m.location_id, m.screen_id, m.row_label, m.price_col;
grant select on public.inventory_stock_cells to authenticated, service_role;
comment on view public.inventory_stock_cells is
  'Stock on hand per catalog cell per location: the ledger summed by the database (Nov 3). The newest entry''s unit and time ride along.';
