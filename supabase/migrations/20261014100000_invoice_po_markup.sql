-- Invoice: purchase orders on the invoice, marked up or at cost (owner, Oct 14: "I'd like the
-- mark up to be able to be toggled to applied to the PO or not — material markup that is").
-- A draft built or rebuilt from the ticket carries one line per approved purchase order
-- (invoice_lines.source 'po:<id>'); po_markup says whether those lines are priced at the PO's
-- cost plus the invoice's material_markup (true, the default — like a material) or at cost
-- (false). Additive and idempotent; applied live Oct 14.
alter table public.invoices add column if not exists po_markup boolean not null default true;
comment on column public.invoices.po_markup is
  'Owner, Oct 14: whether this invoice''s material markup is applied to its purchase-order lines (true) or they are billed at cost (false).';
