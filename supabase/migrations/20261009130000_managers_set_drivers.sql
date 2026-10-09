-- Managers set truck drivers (owner, Oct 9: "allow managers to set truck drivers").
-- Setup › Vehicles & drivers was admins only: vehicle_drivers_write (20260926120000) used
-- is_admin(). A manager runs the service crews and may now change who drives each vehicle;
-- reading stays everyone's (vehicle_drivers_read, unchanged). The server function
-- (inventory.functions.ts setVehicleDrivers) and the Setup tab apply the same rule
-- (access.ts seesEveryone). is_manager() is 20260930093000's. Idempotent.
drop policy if exists vehicle_drivers_write on public.vehicle_drivers;
create policy vehicle_drivers_write on public.vehicle_drivers for all to authenticated
  using (public.is_admin() or public.is_manager())
  with check (public.is_admin() or public.is_manager());
