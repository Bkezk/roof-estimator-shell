-- A bid started from an inspection ticket remembers the ticket (owner, Nov 9: "Can you make it
-- to where there is a stored link to the inspection on the bid?"). "Create bid" on a completed
-- inspection opens the estimator with ?inspection=<ticket id>; the first save writes the new
-- bid's id here (service-inspection.functions.ts linkBidToInspection) and only then records the
-- inspection's outcome as "bid". The Bids page and the estimator show "From inspection #N — Done,
-- Nov 9" from it; the ticket's After the inspection panel lists the bid. A deleted ticket keeps
-- the bid (the link is cleared). Idempotent.
alter table public.bids
  add column if not exists from_job_id uuid references public.service_jobs(id) on delete set null;

create index if not exists bids_from_job_id_idx on public.bids (from_job_id)
  where from_job_id is not null;

comment on column public.bids.from_job_id is
  'The inspection ticket this bid was started from (service_jobs.id), written on the first save; null for every other bid.';
