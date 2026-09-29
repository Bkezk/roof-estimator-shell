-- Owner, Sep 29: "we really need it to show relevant info on who to contact to bid." One text
-- field per lead: the buyer's name / title / email / phone when the source states it (Paducah
-- names its project manager; a Louisville permit names the general contractor to bid to).
alter table public.leads add column if not exists contact text;
