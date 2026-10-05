-- "Rebuild from ticket" keeps a price changed by hand (owner, Oct 5, service follow-up 3: fix
-- hours and quantities on the ticket; the invoice follows; line edits are for prices only).
-- saveInvoice sets rate_overridden when a line's price is changed on a draft; rebuildInvoiceLines
-- keeps that price on the rebuilt line (src/lib/invoice-rebuild.ts). Idempotent.
alter table public.invoice_lines
  add column if not exists rate_overridden boolean not null default false;
comment on column public.invoice_lines.rate_overridden is
  'The price was changed by hand on the draft; Rebuild from ticket keeps it.';
