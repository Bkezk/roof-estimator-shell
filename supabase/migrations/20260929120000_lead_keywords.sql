-- Owner, Sep 29: the Leads page shows roof leads only, so the keyword net must catch every
-- new roof, re-roof and roof repair. A new building or addition has a new roof whatever its
-- title says; gutters, downspouts, skylights and roof decks ride on roof jobs.
alter table public.lead_settings alter column roof_keywords set default
  '{roof,roofing,re-roof,reroof,roof repair,flat roof,membrane,epdm,tpo,shingle,standing seam,metal roof,coping,parapet,gutter,downspout,skylight,roof deck,new building,new facility,new construction,addition}';
update public.lead_settings set roof_keywords = (
  select array_agg(distinct k) from unnest(roof_keywords || '{roof repair,flat roof,gutter,downspout,skylight,roof deck,new building,new facility,new construction,addition}'::text[]) as k
) where id = 1;
