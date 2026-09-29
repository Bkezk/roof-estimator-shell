-- More lead sources (owner, Sep 29): Lynn Imaging's public bids list (the reprographics
-- planroom behind the state's — housing authorities, cities, counties, districts, private
-- owners statewide, posted the day plans go out for bid), and the Bowling Green and Paducah
-- city bid pages.
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('ky_planroom','louisville_permits','lynn_bids','bgky_bids','paducah_bids'));

-- "pvc" flagged waterline jobs ("6-inch PVC, SDR-21 waterline") as roof work in the first live
-- pull of Lynn's feed; a PVC roof always says "roof", "roofing" or "membrane" too, so drop it.
alter table public.lead_settings alter column roof_keywords
  set default '{roof,roofing,re-roof,reroof,membrane,epdm,tpo,shingle,standing seam,metal roof,coping,parapet}';
update public.lead_settings set roof_keywords = array_remove(roof_keywords, 'pvc') where id = 1;
