-- Legacy Warranty table columns the Home screen needs (ReqThickness / IsHighWind / WarrantyTerm,
-- values from the licensed install's BidAdvantage.DataAccess.SqlScript.xml seed, matched by name).
alter table public.warranties
  add column if not exists req_thickness integer not null default 40,
  add column if not exists is_high_wind boolean not null default false,
  add column if not exists term_years integer not null default 15;

update public.warranties w set req_thickness = v.req, is_high_wind = v.hw, term_years = v.term
from (values
  ('15 Yr NDL',40,false,15),('15 Yr Residential',40,false,15),('20 Yr NDL',50,false,20),
  ('10 Yr Ballast',40,false,10),('10 Yr International',40,false,10),('10 Yr Material Only',40,false,10),
  ('15 Yr Hail',50,false,15),('15 Yr Hail & High Wind',50,true,15),('15 Yr High Wind',50,true,15),
  ('15 Yr International',50,false,15),('15 Yr Material Only',40,false,15),
  ('15 + 5 Yr Material & Labor',50,false,20),('15 + 5 Yr Material Only',50,false,20),
  ('20 Yr High Wind',50,true,20),('20 Yr Material Only',50,false,20),('20 Yr Pro-Rated',50,false,20)
) v(name, req, hw, term)
where w.name = v.name;
