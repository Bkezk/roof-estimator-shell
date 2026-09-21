-- Curb setup ("Base") time is per deck row in the legacy lookup_CurbTimes table
-- (DeckTypeID, HrsPerLinealFt, MinutesToInstall, Base, CustomHrsPerLinealFt, CustomBase);
-- Curb.BaseHours (rva 0x333a4) reads col 3 for the curb's own deck. The web app carried one
-- global setup value (labor_curb.setup_minutes). A per-deck override column keeps the global
-- value as the default (null = use it). Structural Metal is pinned to 7.5 min: the legacy Curbs
-- screen for the Knox County CTC bid (all Structural Metal) shows Curb A 16.7 h, Curb F 8.53 h and
-- 48.81 h total, which reconcile only with a 0.125 h base (docs/legacy-money-parity.md §22.19).
alter table public.labor_curb_deck add column if not exists setup_minutes numeric null;
update public.labor_curb_deck set setup_minutes = 7.5
  where deck_type = 'Structural Metal' and setup_minutes is null;
