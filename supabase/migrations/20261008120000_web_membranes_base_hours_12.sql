-- Owner, Oct 8 (Pineville Independent Preschool): "we just updated the labor to 12, but durotech
-- tpo, non dl tpo, and epdm should all be 12 instead of 10 or 27". The three web-only membrane
-- systems (docs §22.34 / §22.35) were seeded from the Roof Membrane Bid Calculator Reference at
-- 27 / 27.5 / 31 h per 2,500 sq ft; the owner's calibrated base is 12 h, the same figure the
-- Duro-Last mechanical combo was set to on Admin › Labor › Roof Deck Labor. Only the base moves:
-- the deck, roll-width, fastener-spacing, complexity and thickness multipliers stay as seeded.
-- Applied live the same day through the Lovable database tool.
update public.rdl_combos
set data = jsonb_set(data, '{base_hours_per_2500}', '12'::jsonb)
where attachment = 'mechanical'
  and roof_system in ('Duro-Tech TPO', 'Non-DL TPO', 'EPDM Rubber');
