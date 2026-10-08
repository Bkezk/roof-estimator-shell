-- Who sent an invoice (owner, Oct 8: the Invoices list's "Sent by", as CenterPoint's list has).
-- Written by sendInvoice next to sent_at; a re-send overwrites both. Invoices sent before this
-- show the date only (who sent them is still in audit_log). Idempotent.
alter table public.invoices add column if not exists sent_by_name text;
comment on column public.invoices.sent_by_name is
  'The name of the person who last sent this invoice (with sent_at).';
