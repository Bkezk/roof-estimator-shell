-- Kentucky leads (Sep 29): the two biggest cities' own bid lists.
--   lexington_bids   Lexington-Fayette Urban County Government: the public "Current Bid
--                    Opportunities" list on the city's Ionwave portal, read by the refresh
--                    (one request). external_id is the bid number without its "Addendum N".
--   louisville_bids  Louisville Metro Government: the open opportunities of its Bonfire
--                    portal, read by the nightly browser job (scripts/browser-bids.ts) and
--                    posted to /api/cron/leads-import like the Tennessee city lists. The import
--                    stamps lead_settings.source_fetched_at->>'louisville_bids'.
-- No new columns. Apply before the next refresh (a Lexington row would fail the check) and
-- before the next browser-bids run (the Louisville import would be refused).

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('ky_planroom','louisville_permits','lynn_bids','bgky_bids','paducah_bids',
                    'campus_planrooms','sam_gov','tn_stream','ut_bids','nashville_permits',
                    'bidnet','chattanooga_permits','knox_county_bids','tn_university_bids',
                    'nashville_bids','chattanooga_bids','lexington_bids','louisville_bids'));
