-- Takeoff list like the Bids page: "Last updated … by <name>".
alter table public.takeoffs add column if not exists updated_by_name text;
