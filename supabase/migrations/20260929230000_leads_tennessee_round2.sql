-- Tennessee leads, round two (owner, Sep 29: bring Tennessee up to Kentucky's coverage — the
-- other big cities, the schools and universities, and a statewide feed). Four new sources, all
-- public pages or open data, no login or key:
--   bidnet               BidNet Direct's Tennessee and Kentucky purchasing groups (cities,
--                        counties, school districts, utilities): the public open-solicitations
--                        list, read once a day (lead_settings.source_fetched_at->>'bidnet').
--   chattanooga_permits  Chattanooga-Hamilton County Regional Planning Agency building permits
--                        (ArcGIS REST): new non-residential over lead_settings.nashville_min_cost,
--                        last 180 days.
--   knox_county_bids     Knox County purchasing's solicitations table.
--   tn_university_bids   Construction bid lists of ETSU, Tennessee Tech, Austin Peay, MTSU and
--                        the Tennessee Board of Regents (community colleges, TCATs, TSU).
-- No new columns: the state column, the Nashville cost floor and source_fetched_at exist
-- (20260929220000_leads_tennessee.sql and earlier).

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('ky_planroom','louisville_permits','lynn_bids','bgky_bids','paducah_bids',
                    'campus_planrooms','sam_gov','tn_stream','ut_bids','nashville_permits',
                    'bidnet','chattanooga_permits','knox_county_bids','tn_university_bids'));

comment on column public.lead_settings.nashville_min_cost is
  'Minimum construction cost (USD) for Nashville permits and Chattanooga new non-residential permits.';
