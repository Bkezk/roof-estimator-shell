-- Show a line without its price (owner, Oct 8: "we also need the ability to show the
-- material/labor but hide the price"; per line, description + quantity). With show_on_invoice
-- on, hide_price lists the line on the customer's PDF with its quantity but no rate or amount;
-- its amount is in the one "Services and materials" row with the hidden lines (pdfLineRows), so
-- the totals are unchanged. Off by default; means nothing while show_on_invoice is off. Idempotent.
alter table public.invoice_lines add column if not exists hide_price boolean not null default false;
comment on column public.invoice_lines.hide_price is
  'With show_on_invoice: listed without rate or amount; its amount is in the "Services and materials" row.';
