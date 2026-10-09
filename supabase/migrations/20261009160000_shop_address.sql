-- Where the trucks leave from (owner, Oct 9: "i just made a ticket with the site 2 property and
-- the drive time wasnt auto added to the close out"). company_settings' address is the invoice
-- header's: "PO Box 466, Corbin, KY 40702" — no house number, so the close-out's travel estimate
-- (src/lib/service-field.functions.ts estimateTravel) could geocode no office and was null for
-- EVERY ticket. The main address stays the PO box (the invoice prints it); these four columns
-- hold the street the trucks leave from, and the estimate starts there when a street is set,
-- else at the main address when that is a street (src/lib/travel-estimate.ts travelOrigin).
--
-- Saved by the same path as the rest of the row: admin-settings.functions.ts saveCompanySettings
-- upserts id 1 under the caller's own client, and policy company_settings_write
-- (20260831225744_admin_general.sql: for all to authenticated using public.is_admin()) covers
-- every column of the table, these included — no new grant. Any signed-in user reads them
-- (company_settings_read), as the estimate does.
--
-- Additive and idempotent; the app works before it is applied (the estimate then falls back to
-- the main address, as before).

alter table public.company_settings add column if not exists shop_address text;
alter table public.company_settings add column if not exists shop_city text;
alter table public.company_settings add column if not exists shop_state text;
alter table public.company_settings add column if not exists shop_zip text;

comment on column public.company_settings.shop_address is
  'Where the trucks leave from: the street address the close-out''s drive-time estimate starts at; the main address may be a PO box (owner, Oct 9)';
comment on column public.company_settings.shop_city is
  'Where the trucks leave from: the street address the close-out''s drive-time estimate starts at; the main address may be a PO box (owner, Oct 9)';
comment on column public.company_settings.shop_state is
  'Where the trucks leave from: the street address the close-out''s drive-time estimate starts at; the main address may be a PO box (owner, Oct 9)';
comment on column public.company_settings.shop_zip is
  'Where the trucks leave from: the street address the close-out''s drive-time estimate starts at; the main address may be a PO box (owner, Oct 9)';
