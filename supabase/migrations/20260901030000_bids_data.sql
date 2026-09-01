-- Phase 5b: persist estimator bids. Store the full BidInput jsonb + a cached grand total
-- for the list, plus attribution. Idempotent. Existing permissive RLS (authenticated all) kept.
alter table public.bids add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.bids add column if not exists grand_total numeric not null default 0;
alter table public.bids add column if not exists created_by uuid default auth.uid();
