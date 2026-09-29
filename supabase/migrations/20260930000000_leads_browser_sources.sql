-- Tennessee leads, round three (Sep 29): Metro Nashville's and the City of Chattanooga's own
-- bid lists. Both live in Oracle Cloud procurement portals whose pages are built by scripts,
-- so the app's server fetch gets an empty shell; a nightly GitHub Actions job
-- (.github/workflows/browser-bids.yml, scripts/browser-bids.ts) reads the public lists in a
-- headless browser (no login, no registration) and posts the open solicitations to
-- /api/cron/leads-import:
--   nashville_bids    Metro Nashville and Davidson County (Negotiation Abstracts, Central time).
--   chattanooga_bids  City of Chattanooga (Solicitation Abstracts, Eastern time).
-- external_id is the solicitation's base number (without the ",N" amendment round). The
-- import stamps lead_settings.source_fetched_at->>'nashville_bids' / 'chattanooga_bids'.
-- No new columns.

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('ky_planroom','louisville_permits','lynn_bids','bgky_bids','paducah_bids',
                    'campus_planrooms','sam_gov','tn_stream','ut_bids','nashville_permits',
                    'bidnet','chattanooga_permits','knox_county_bids','tn_university_bids',
                    'nashville_bids','chattanooga_bids'));
