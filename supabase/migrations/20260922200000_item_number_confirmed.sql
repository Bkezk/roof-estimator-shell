-- "Confirm mapping" on the Price List Import cross-check: the admin vouches that this item
-- number really points at this product even though the sheet wording does not name it. The
-- confirmed description is remembered; the cross-check stays quiet while the sheet still says
-- that, and flags again if Duro-Last's wording for the number changes. Idempotent.
alter table public.catalog_item_numbers
  add column if not exists confirmed_description text,
  add column if not exists confirmed_at timestamptz;
