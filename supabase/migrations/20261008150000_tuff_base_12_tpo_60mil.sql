-- Owner, Oct 8 (Pineville Independent Preschool, Duro-Tech TPO vs Duro-Tuff): "We also adjusted
-- in estimate pricing the labor from 10 to 12 ... Change tpo 60 mil thickness to Match". The
-- Roof Deck Labor picker opens on Duro-Last, so the 10 → 12 edit landed there (Duro-Last already
-- read 12); Duro-Tuff mechanical still read blank (= legacy 10). This carries the Duro-Tuff base
-- to 12, and puts Duro-Tuff's 60 mil labor factor (1.25) on Duro-Tech TPO's thickness ladder
-- (both attachments; 45 mil stays 1, 80 mil 1.075), so the two systems bill the same chain on a
-- 60 mil section. Applied live the same day through the Lovable database tool.
update public.rdl_combos
set data = jsonb_set(data, '{base_hours_per_2500}', '12'::jsonb)
where roof_system = 'Duro-Tuff' and attachment = 'mechanical';

update public.rdl_combos c
set data = jsonb_set(
  c.data,
  '{thickness_multipliers}',
  (
    select jsonb_agg(
      case when (t->>'mil') = '60' then jsonb_set(t, '{multiplier}', '1.25'::jsonb) else t end
    )
    from jsonb_array_elements(c.data->'thickness_multipliers') t
  )
)
where c.roof_system = 'Duro-Tech TPO';
