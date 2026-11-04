-- Setup › Service rates (owner, Nov 4, review item 3): the "Defaults came from the CenterPoint
-- invoices in the report; confirm the helper travel rates with the office" note has shown since
-- the rates were seeded (Sep 27) and nothing had been saved since. It now stays until someone
-- presses "These rates are confirmed", which stamps who and when here; the note then goes.
alter table public.service_settings
  add column if not exists rates_confirmed_at timestamptz,
  add column if not exists rates_confirmed_by_name text;
