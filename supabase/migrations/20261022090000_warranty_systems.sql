-- Warranties per roof system (owner, Oct 22: "epdm also should have 25, and 30 yr warranties.
-- ensure those things are wired correctly"). Idempotent.
--
-- warranties.systems: the roof systems the warranty is offered on (the engine's family names,
-- e.g. '{EPDM Rubber}'); null = every system, as every row was until now. The estimator's
-- Warranty picker lists only the bid system's warranties (src/lib/warranty-systems.ts); the
-- Warranties tab (Admin › General) shows and saves it with the term, required mil and high-wind
-- flag (which that tab's save used to drop — 20260910120000 added them, but the save re-inserted
-- only the name and the two prices, so one save reset them all to 40 / false / 15).
--
-- Two EPDM Rubber warranties, 25 and 30 years, required mil 45 (EPDM's thinnest), priced at 0
-- per sq ft until the owner enters the figures on the Warranties tab.

alter table public.warranties add column if not exists systems text[];
comment on column public.warranties.systems is
  'Owner, Oct 22: the roof systems this warranty is offered on (engine family names); null = every system.';

insert into public.warranties (name, price_per_sqft, non_master_elite_surcharge, sort, req_thickness, is_high_wind, term_years, systems)
select v.name, 0, 0, (select coalesce(max(sort), -1) from public.warranties) + v.n, 45, false, v.term, array['EPDM Rubber']
from (values ('25 Yr EPDM', 25, 1), ('30 Yr EPDM', 30, 2)) v(name, term, n)
where not exists (select 1 from public.warranties w where w.name = v.name);
