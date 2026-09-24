-- Crews take stock mid-job to finish it. Inventory-only logins may now record "used on job"
-- (reason 'consumed', which needs a bid) as well as leftovers; adjustments and write-offs stay
-- with Estimate access. Mirrors the check in src/lib/inventory.functions.ts addMovement.
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (
    public.has_access('estimate')
    or (public.has_access('inventory') and reason in ('leftover','consumed'))
  );
