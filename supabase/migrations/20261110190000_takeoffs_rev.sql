-- Takeoffs: a revision number for the drawing (takeoff audit, Nov 10, finding 3).
-- Two people (or two tabs) in one takeoff used to overwrite each other: a save sent the whole
-- drawing and the server took it. Every save of the drawing (pages, setup, objects) now bumps
-- `rev`, and a save that names the revision it started from is refused when the row has moved on
-- (src/lib/takeoff.functions.ts saveTakeoffImpl). Status, customer and bid-link saves leave it.
alter table public.takeoffs add column if not exists rev integer not null default 0;
comment on column public.takeoffs.rev is
  'Bumped by every save of the drawing; a save from an older revision is refused.';
