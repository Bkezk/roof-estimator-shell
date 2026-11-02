-- Ticket types (owner, Nov 2): "just call it repair, the pictures will tell the story", and
-- "remove scope". Leak becomes Repair — the type names the kind of visit, not the reason, and
-- every non-inspection ticket was a Leak by default. Scope, which no ticket ever used and which
-- behaved exactly as a repair, goes (a CenterPoint "Scope" import maps to Other). The check and
-- the default follow; the live Leak tickets move with it.
alter table public.service_jobs drop constraint if exists service_jobs_service_type_check;
update public.service_jobs set service_type = 'repair' where service_type = 'leak';
update public.service_jobs set service_type = 'other' where service_type = 'scope';
alter table public.service_jobs alter column service_type set default 'repair';
alter table public.service_jobs add constraint service_jobs_service_type_check
  check (service_type in ('repair', 'warranty', 'inspection', 'other'));
