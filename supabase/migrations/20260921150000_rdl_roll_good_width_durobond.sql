-- Duro-Bond (RoofSystem 2) roll-good widths. The shipped installer script seeds RSRollGoodWidth
-- for systems 1/3/4/5 only, so the web's Field Roll Width pick for a Duro-Bond section had no
-- entries and fell back to a bare number box. The legacy app (live vendor DB) lists 30 / 60 /
-- 120 for Duro-Bond — reported from the owner's legacy screen, not a table capture (docs
-- §22.21). The multiplier column is the ADHERED roll-goods labor multiplier
-- (RollGoodWidthAdhesiveMulti); Duro-Bond has no adhered attachment, so 1 is a placeholder that
-- nothing reads.
insert into public.rdl_roll_good_width (roof_system_id, width_in, multiplier) values
  (2, 30, 1),
  (2, 60, 1),
  (2, 120, 1)
on conflict (roof_system_id, width_in) do nothing;
