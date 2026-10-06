-- Roof-type chips in the repair picker (owner, Oct 6: "the repair tags … please fix").
--
-- 20261006120000_repair_library.sql loaded CenterPoint's 475 repairs with their roof-type tags
-- (repair_templates.tags text[]: General, BUR, Sheetmetal, Modified, Single Ply, Duro-Last …),
-- and nothing read them. The close-out picker now filters by tag on the server
-- (listRepairTemplates: .contains("tags", [tag])). A manager's list reads the table; a
-- technician's reads the price-free view repair_templates_catalog (20261002160000: technicians
-- never read unit_price), which did not carry tags — so the view gains the column.
--
-- The view is re-created exactly as 20261002160000 defines it, with t.tags APPENDED: create or
-- replace view may only add columns at the end of the list (it cannot reorder or rename the
-- existing ones), and not dropping it keeps its grants and anything that depends on it. Still
-- every column but unit_price; the WHERE clause (the old read rule) unchanged; security_invoker
-- off and security_barrier on for the same reasons as before. Grants re-stated. Idempotent.
create or replace view public.repair_templates_catalog
  with (security_invoker = false, security_barrier = true) as
  select t.id, t.name, t.category, t.unit, t.description, t.work_completed, t.favorite,
         t.usage_count, t.active, t.centerpoint_template_id, t.created_at, t.updated_at, t.tags
    from public.repair_templates t
   where public.has_access('service') or public.has_access('customers')
      or public.has_access('estimate');
revoke all on public.repair_templates_catalog from public, anon, authenticated;
grant select on public.repair_templates_catalog to authenticated;
