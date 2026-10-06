-- A material markup per invoice (owner, Oct 6: "can you change prices and markups per invoice
-- when youre generating it?"). A new invoice takes the default (service_settings.material_markup,
-- now set on Setup › Material pricing); a draft can change its own, which prices the ticket's
-- material lines again (a price typed by hand stays) and is what Rebuild from ticket uses.
-- Invoices made before this keep the markup of their day. Idempotent.
alter table public.invoices add column if not exists material_markup numeric
  check (material_markup is null or (material_markup >= 0 and material_markup <= 10));
comment on column public.invoices.material_markup is
  'This invoice''s material markup (0.75 = 75 %); the ticket''s material lines bill cost × (1 + it).';
update public.invoices
   set material_markup = coalesce((select s.material_markup from public.service_settings s where s.id = 1), 0.75)
 where material_markup is null;
