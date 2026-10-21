-- Won bids in the Margin report (owner, Oct 21: "do bids that are accepted go into that report?
-- if not please add them and have it to where you can filter just service, just bids, or both";
-- "there also needs to be a way to adjust the date the bid was won to ensure the data appears
-- correctly … go with the bid won on day add"). Idempotent: every statement can run again.
--
-- 1. bids.figures: the estimator's money figures at the bid's last save, written by saveBid from
--    what the browser's engine run computed (src/lib/bid-figures.ts bidFigures: revenue BEFORE
--    tax, material, labor, other = warranty + shipping + per diem + commission, hours, tax, total;
--    `v` 1). The engine's output is not otherwise stored and the server cannot recompute it, so
--    the report (src/lib/margin-report.functions.ts) reads this column. Null = the bid was last
--    saved before Oct 21, 2026: the report lists such a won bid as "no cost figures yet" and
--    counts it nowhere until it is opened in the estimator and saved once.
-- 2. bids.won_on: the business day the bid was won, the office's day (YYYY-MM-DD) — the day the
--    Margin report counts a won bid on. Set by the rule in src/lib/bid-status.ts wonOnColumns
--    (the day picked, else the stored one, else today) whenever a bid is saved or marked Won;
--    adjustable afterwards in the report and in the estimator (setBidWonOn / saveBid). Null
--    unless the bid is won. Older won rows: the report falls back to status_changed_at's office
--    day, then updated_at, until the bid is saved or its day is set.

-- 1. ------------------------------------------------------------------------------------------
alter table public.bids add column if not exists figures jsonb;
comment on column public.bids.figures is
  'Owner, Oct 21: the estimator''s money figures at the last save, before tax (src/lib/bid-figures.ts: v 1; revenue, material, labor, other, hours, tax, total), read by the Margin report for won bids. Null = saved before Oct 21, 2026 (not counted until saved once).';

-- 2. ------------------------------------------------------------------------------------------
alter table public.bids add column if not exists won_on date;
comment on column public.bids.won_on is
  'Owner, Oct 21: the business day the bid was won (the office''s day), the Margin report''s day for a won bid; set when a bid is marked Won (the day picked, else today) and adjustable in the report and the estimator. Null unless won.';

-- The report reads the live won bids: a small partial index.
create index if not exists bids_won_on_idx on public.bids (won_on)
  where status in ('won', 'accepted') and deleted_at is null;
