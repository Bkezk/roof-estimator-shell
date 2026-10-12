-- Bid due date (owner, Oct 12: "at the origination of bids we should have a bid due date
-- required so we can also have those show on this week, overdue, etc" on Work Overview).
-- Idempotent: every statement can run again.
--
-- bids.due_date is the day the bid must go out. Nullable in the database: the bids made before
-- today have none, and the app never blocks saving one of those (the estimator shows an amber
-- "No due date" hint instead). The app requires it on a NEW bid — the estimator's first save,
-- the one that inserts the row (bids.functions.ts saveBid refuses a new bid without it) — and
-- from then on it can be changed any time and cleared only on a won / lost bid (bid-status.ts
-- bidDueDateProblem, the one rule for the estimator and the server).
--
-- Work Overview (my-work.functions.ts listMyWork) lists DRAFT bids by this day for callers with
-- Estimate access: Overdue when the day has passed, This week, Later (no date → Later); a
-- submitted / won / lost bid is never listed. The Bids page shows the day and "Overdue N days"
-- on a draft past it. The index serves both reads (status = 'draft', ordered by due_date).
alter table public.bids
  add column if not exists due_date date;
comment on column public.bids.due_date is
  'When the bid must go out (owner, Oct 12): required by the app on a new bid; draft bids show on Work Overview by this day';

create index if not exists bids_status_due_date_idx on public.bids (status, due_date);

-- ============================================================================================
-- "Bid due tomorrow" (owner, Oct 12): one notice per bid to whoever started it (created_by),
-- the day before its due date — or on first sight when the bid is made on / after that day —
-- sent by the reminder pass (bids-notify.server.ts dispatchBidDueNotices, run from
-- /api/cron/reminders and the app's own pass) through notify(), kind 'bid_due'. The stamp says
-- it went; moving the due date clears it, so the new day gets its own notice (never two for one
-- day) — as tasks reset their notified_* stamps when due_at moves (20260930094000_tasks_calendar).
alter table public.bids
  add column if not exists notified_due_at timestamptz;
comment on column public.bids.notified_due_at is
  'When the "Bid due tomorrow" notice went to created_by (owner, Oct 12); cleared when due_date changes so the new day is noticed once.';

create or replace function public.bids_due_notice_reset()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.due_date is distinct from old.due_date then
    new.notified_due_at := null;
  end if;
  return new;
end $$;
revoke all on function public.bids_due_notice_reset() from public;

drop trigger if exists bids_due_notice_reset on public.bids;
create trigger bids_due_notice_reset before update of due_date on public.bids
  for each row execute function public.bids_due_notice_reset();

-- The pass reads "draft, due by tomorrow, not yet noticed": the (status, due_date) index above
-- serves it; notified_due_at is checked on the few rows it returns.
