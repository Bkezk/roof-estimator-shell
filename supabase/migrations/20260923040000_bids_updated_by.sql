-- Who last saved a bid (Bids page: "Last saved <when> by <name>"). A name snapshot, not a
-- profile join: profiles RLS hides other users' rows from non-admins. Set by saveBid.
alter table public.bids add column if not exists updated_by_name text;
