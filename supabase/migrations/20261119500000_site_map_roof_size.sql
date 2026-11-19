-- A property keeps what our map shows at its address (owner, Nov 19: "should we go ahead and
-- lookup and save the customers properties to make it easier to price the plans?", then "go").
--
--   map_roof_sqft   the area of the building outline at the address, when there is one. It is a
--                   size to offer on the Roof Care sign-up, never a measured roof.
--   map_found_how   'address': the building or 911 address point our map has for the address.
--                   'street': no building in our map data; the point is the street address from
--                   the Census address lookup.
--   map_checked_at  when the lookup last ran for the property.
--
-- The point itself goes in lat and lng, which the aerial picture already fills the same way.
-- The lookup of the properties already on file was run once, by hand, on Nov 19
-- (docs/qa/roof-care-map-size-2026-11-19.md). A property added later is looked up when its
-- sign-up is opened.
alter table public.crm_sites
  add column if not exists map_roof_sqft numeric,
  add column if not exists map_found_how text,
  add column if not exists map_checked_at timestamptz;

alter table public.crm_sites
  drop constraint if exists crm_sites_map_roof_sqft_check;
alter table public.crm_sites
  add constraint crm_sites_map_roof_sqft_check
  check (map_roof_sqft is null or map_roof_sqft > 0);

alter table public.crm_sites
  drop constraint if exists crm_sites_map_found_how_check;
alter table public.crm_sites
  add constraint crm_sites_map_found_how_check
  check (map_found_how is null or map_found_how in ('address', 'street'));
