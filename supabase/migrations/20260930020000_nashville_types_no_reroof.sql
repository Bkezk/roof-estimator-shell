-- Owner (Sep 29): Nashville "Roofing / Siding" permits are re-roofs already awarded to the
-- roofer who pulled the permit, so they are not bids to chase. They leave the Leads list
-- (default and the live row); the re-roof marking step reads them separately to stamp the
-- building's roof history (see 20260930030000_reroof_permits.sql).
alter table public.lead_settings alter column nashville_types
  set default '{"Building Commercial - New","Building Commercial - Addition","Building Commercial - Shell"}';
update public.lead_settings
  set nashville_types = array_remove(nashville_types, 'Building Commercial - Roofing / Siding')
  where id = 1;
