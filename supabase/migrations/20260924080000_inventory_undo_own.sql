-- Undo on the confirmation (owner, Sep 24): a person may remove their OWN inventory entry for
-- 24 hours after recording it (wrong number, wrong job); anything older, or someone else's,
-- stays an admin delete. Mirrors undoMovement in src/lib/inventory.functions.ts.
drop policy if exists inventory_movements_delete on public.inventory_movements;
create policy inventory_movements_delete on public.inventory_movements
  for delete to authenticated
  using (
    public.is_admin()
    or (created_by = auth.uid() and created_at > now() - interval '24 hours')
  );
