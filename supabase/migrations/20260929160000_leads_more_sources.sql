-- Owner, Sep 29: the one Lynn planroom login covers ten portals; seven of them (UK, WKU, NKU,
-- EKU, UofL, JCPS, KCTCS) have public job lists in the state planroom's format → one source,
-- campus_planrooms, with the portal on the row. SAM.gov federal roof jobs (NAICS 238160, place
-- of performance KY) → sam_gov, pulled with the owner's API key.
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('ky_planroom','louisville_permits','lynn_bids','bgky_bids','paducah_bids','campus_planrooms','sam_gov'));
