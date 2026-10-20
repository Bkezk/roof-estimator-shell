-- The customer book's write policies were `for all` (crm_accounts_write 20260926120000,
-- crm_sites_write 20260926120000, crm_contacts_write 20260927130000) with
-- `has_access('customers') or has_access('service')`. In Postgres a FOR ALL policy also grants
-- SELECT, so a technician-only token (Service access) read every customer, property and contact
-- through the WRITE rule, and 20261020122000's narrowed read policies changed nothing (proved
-- live, Oct 20: 633 of 633 accounts as the technician-only test login). Split each into insert /
-- update / delete with the same rule; reads are the read policy's alone. Idempotent.
do $$
declare t text;
begin
  foreach t in array array['crm_accounts', 'crm_sites', 'crm_contacts'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_write', t);
    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_access(''customers'') or public.has_access(''service''));',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_access(''customers'') or public.has_access(''service'')) with check (public.has_access(''customers'') or public.has_access(''service''));',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_access(''customers'') or public.has_access(''service''));',
      t || '_delete', t);
  end loop;
end $$;
