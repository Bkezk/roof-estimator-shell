-- The property's aerial cover picture (owner, Nov 2: "cant we just have it take the satellite
-- image?"). A property with no uploaded cover photo gets one made from our aerial imagery
-- (KyFromAbove / TDOT), centred on the building its address finds, saved as an ordinary cover
-- photo (cover_photo_path; lib/site-aerial-cover.server.ts). These columns say which kind the
-- picture is, where the building is, and when the aerial was last looked for and why it is not
-- there, so a property nothing is found for is not looked up on every visit.
alter table public.crm_sites
  add column if not exists cover_photo_source text not null default 'photo',
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists aerial_state text,
  add column if not exists aerial_tried_at timestamptz,
  add column if not exists aerial_note text;
alter table public.crm_sites drop constraint if exists crm_sites_cover_photo_source_check;
alter table public.crm_sites add constraint crm_sites_cover_photo_source_check
  check (cover_photo_source in ('photo', 'aerial'));
alter table public.crm_sites drop constraint if exists crm_sites_aerial_state_check;
alter table public.crm_sites add constraint crm_sites_aerial_state_check
  check (aerial_state is null or aerial_state in ('KY', 'TN'));
comment on column public.crm_sites.cover_photo_source is
  'What cover_photo_path is: a photo the office uploaded (''photo'', wins) or the aerial made from our imagery (''aerial'').';
comment on column public.crm_sites.lat is 'Where the address was found (the building''s centroid), from the aerial lookup.';
comment on column public.crm_sites.lng is 'Where the address was found (the building''s centroid), from the aerial lookup.';
comment on column public.crm_sites.aerial_state is 'Whose imagery the aerial cover is: KY (KyFromAbove) or TN (TDOT).';
comment on column public.crm_sites.aerial_tried_at is
  'When the aerial was last looked for; a miss is not tried again for 30 days (aerial-cover.ts AERIAL_RETRY_DAYS).';
comment on column public.crm_sites.aerial_note is 'Why there is no aerial (the last lookup''s note, or that it was removed).';
