-- "Show on invoice", line by line (owner, Oct 8: "on the customer facing invoice it needs to be
-- toggable and defaulted off"). A line is listed on the customer's PDF only when switched on;
-- the lines switched off print as one "Services and materials" row (pdfLineRows), so the totals
-- are unchanged. Every line, old and new, starts off. Finalised invoices keep the PDF stored when
-- they were finalised. Idempotent.
alter table public.invoice_lines add column if not exists show_on_invoice boolean not null default false;
comment on column public.invoice_lines.show_on_invoice is
  'Listed on its own on the customer''s PDF; off = added into the one "Services and materials" row.';
