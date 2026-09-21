-- Soft delete for bids: Delete stamps deleted_at, the app hides the row, lists it under
-- "Recently deleted" with Restore for 30 days, and purges it after (lazy purge on list).
alter table public.bids add column if not exists deleted_at timestamptz null;
create index if not exists bids_deleted_at_idx on public.bids (deleted_at) where deleted_at is not null;
comment on column public.bids.deleted_at is
  'Soft delete: set when the owner deletes the bid; the app hides it, offers Restore for 30 days, then purges it.';
