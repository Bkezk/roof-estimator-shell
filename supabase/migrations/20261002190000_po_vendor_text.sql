-- A purchase order's vendor is plain text (owner, Oct 2: "someone should be able to type Lowes
-- and it just saves the text; it doesn't have to be a saved vendor, and typing one doesn't add
-- it to the Vendors list"). vendor_text is what was typed; vendor_id is set as well only when the
-- text matches a saved, unarchived vendor's name (src/lib/purchase-orders.ts vendorLink). Nothing
-- here ever inserts into public.vendors. Idempotent.
alter table public.service_job_purchase_orders add column if not exists vendor_text text;
alter table public.service_job_purchase_orders drop constraint if exists service_job_purchase_orders_vendor_text_len;
alter table public.service_job_purchase_orders
  add constraint service_job_purchase_orders_vendor_text_len
  check (vendor_text is null or length(vendor_text) <= 120) not valid;
comment on column public.service_job_purchase_orders.vendor_text is
  'The supplier as typed on the PO ("Lowes"); free text, never added to vendors. vendor_id is also set when it matches a saved vendor.';
