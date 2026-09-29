-- Tennessee leads (owner, Sep 29: "we actually cover TN as well, can we replicate what we have
-- for leads for TN?" — the whole state). Three new sources, all public, no login or key:
--   tn_stream          State of Tennessee STREAM construction bid list and RFP page
--                      (tn.gov/generalservices/stream): state building projects out for bid,
--                      the designer (A/E) as the contact, pre-bid and bid opening times.
--   ut_bids            University of Tennessee system capital projects: the "Invitations to
--                      Bid" on each campus's bids page (UTK, UTC, UTHSC, UTIA, IPS, UTM, UTS).
--   nashville_permits  Metro Nashville "Building Permits Issued" (ArcGIS REST): commercial
--                      new / addition / shell / roofing permits over a construction cost.
-- SAM.gov (sam_gov) now asks for Kentucky and Tennessee in its one daily pull.
-- A lead now carries its state; every row stored before today is Kentucky.

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('ky_planroom','louisville_permits','lynn_bids','bgky_bids','paducah_bids',
                    'campus_planrooms','sam_gov','tn_stream','ut_bids','nashville_permits'));

alter table public.leads add column if not exists state text not null default 'KY';
alter table public.leads drop constraint if exists leads_state_check;
alter table public.leads add constraint leads_state_check check (state ~ '^[A-Z]{2}$');
comment on column public.leads.state is
  'Two-letter state of the job (KY or TN; SAM.gov rows take the place of performance).';

-- Which Nashville permits count (the layer has no square footage, so a construction cost floor
-- stands in for the Louisville size floor); the window is louisville_days, shared.
alter table public.lead_settings
  add column if not exists nashville_types text[] not null
    default '{"Building Commercial - New","Building Commercial - Addition","Building Commercial - Shell","Building Commercial - Roofing / Siding"}',
  add column if not exists nashville_min_cost numeric not null default 100000
    check (nashville_min_cost >= 0);
