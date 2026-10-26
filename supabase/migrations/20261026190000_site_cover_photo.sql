-- Phase 2 of the document generator (owner, Oct 26): a cover photo on the property record, the
-- "Property Photo" picture a document's cover page can print (ImageRef kind "siteCover").
-- The file lives in the private `documents` bucket under sites/<site id>/…; the row keeps its path.
alter table public.crm_sites add column if not exists cover_photo_path text;
comment on column public.crm_sites.cover_photo_path is
  'The property''s cover photo in the documents bucket (sites/<site id>/<file>); null when none.';
