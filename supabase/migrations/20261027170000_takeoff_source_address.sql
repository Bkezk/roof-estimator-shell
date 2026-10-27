-- New takeoff from an address (owner, Oct 27: "on the takeoffs can we expand its usage a bit, we
-- also want to be able to search an address, it pull up an aerial picture and we can mark it up
-- from that as well"). A takeoff made from the aerial imagery keeps the address it was looked up
-- by; a takeoff made from an uploaded file has none.
alter table public.takeoffs add column if not exists source_address text;
comment on column public.takeoffs.source_address is
  'The address the aerial underlay was looked up by (New takeoff › From an address); null for an uploaded plan file or screenshot.';
