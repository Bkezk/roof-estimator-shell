-- Owner, Oct 8: "have the complexity ladders match". The three web-only membrane systems
-- (Duro-Tech TPO, Non-DL TPO, EPDM Rubber; docs §22.34 / §22.35) were seeded with the guide's
-- ladder (Open 1 / Minor 1.1 / Moderate 1.25 / Medium 1.4 / Heavy 1.6 / Extreme 2), which bills
-- ×1.25 on the default Moderate pick. The legacy ladder (Duro-Tuff / Duro-Fleece, RSComplexityFactor)
-- is Open 0.9 / Minor 0.98 / Moderate 1 / Medium 1.2 / Heavy 2.4 / Extreme 4 — ×1 at Moderate,
-- the same as Duro-Last / Duro-Bond / Duro-Roof, which carry no ladder. Both attachments of each
-- system get it. Applied live the same day through the Lovable database tool.
update public.rdl_combos
set data = jsonb_set(
  data,
  '{complexity_factors}',
  '[{"label": "Open", "value": 0.9}, {"label": "Minor", "value": 0.98}, {"label": "Moderate", "value": 1}, {"label": "Medium", "value": 1.2}, {"label": "Heavy", "value": 2.4}, {"label": "Extreme", "value": 4}]'::jsonb
)
where roof_system in ('Duro-Tech TPO', 'Non-DL TPO', 'EPDM Rubber');
