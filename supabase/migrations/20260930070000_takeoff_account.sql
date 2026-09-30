-- A takeoff belongs to a customer profile (owner, Sep 30: "if the takeoff has building plans in
-- it, it should be associated with the customer"). Same link as bids.account_id; deleting the
-- customer leaves the takeoff unlinked. RLS on takeoffs is unchanged (read: takeoff or
-- estimate; write: takeoff). Idempotent.
alter table public.takeoffs
  add column if not exists account_id uuid references public.crm_accounts(id) on delete set null;
create index if not exists takeoffs_account_idx on public.takeoffs (account_id)
  where account_id is not null;
