-- Office users may manage templates (owner, Nov 10: "keep technicians off the documents page.
-- Allow office users to have access").
--
-- Templates, saved snippets and the PDF library were an admin's or a manager's to change. Now
-- anyone with Documents access may add, change and delete them: an admin, a manager, or a user
-- with Estimate, Invoices or Customers access (`documents_access()`). A Service-only technician
-- has no Documents access and stays out, for reading too. The `documents` storage bucket's
-- policies already ask for Documents access only, so the library's files need no change.
-- The server function's own check and wording are in src/lib/documents.functions.ts.

alter policy document_templates_insert on public.document_templates
  with check ((select public.documents_access()));
alter policy document_templates_update on public.document_templates
  using ((select public.documents_access()))
  with check ((select public.documents_access()));
alter policy document_templates_delete on public.document_templates
  using ((select public.documents_access()));

alter policy document_modules_insert on public.document_modules
  with check ((select public.documents_access()));
alter policy document_modules_update on public.document_modules
  using ((select public.documents_access()))
  with check ((select public.documents_access()));
alter policy document_modules_delete on public.document_modules
  using ((select public.documents_access()));

alter policy document_assets_insert on public.document_assets
  with check ((select public.documents_access()));
alter policy document_assets_update on public.document_assets
  using ((select public.documents_access()))
  with check ((select public.documents_access()));
alter policy document_assets_delete on public.document_assets
  using ((select public.documents_access()));
