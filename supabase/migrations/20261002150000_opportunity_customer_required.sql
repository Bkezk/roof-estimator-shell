-- An opportunity names its customer and its site; "Start a ticket" (owner, Oct 2).
-- Idempotent: every statement can run again.
--
-- The customer, a way to reach them and the site are required by the app on every save from now
-- on (src/lib/opportunity-form.ts opportunityProblem; saveOpportunity refuses). Nothing here
-- makes crm_opportunities.account_id or site_id NOT NULL: older rows must still open, and the
-- live opportunities all have both already, so there is no backfill.
--
-- "Start a ticket" on an opportunity opens the new-ticket form prefilled; the ticket keeps the
-- opportunity it came from (nullable; a ticket made any other way has none). The opportunity
-- page lists "Ticket #6004" by it, the ticket shows "From opportunity: <title>". Opportunities
-- are soft-deleted, so the link stays; a hard delete clears it.
alter table public.service_jobs
  add column if not exists from_opportunity_id uuid references public.crm_opportunities(id) on delete set null;
create index if not exists service_jobs_from_opportunity_idx on public.service_jobs (from_opportunity_id)
  where from_opportunity_id is not null;

comment on column public.service_jobs.from_opportunity_id is
  'The opportunity this ticket was started from ("Start a ticket"); written on create only.';
