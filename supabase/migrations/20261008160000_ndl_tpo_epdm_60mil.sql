-- Owner, Oct 8: "do the same for non dl tpo and epdm" (after 20261008150000 put Duro-Tuff's 60 mil
-- labor factor 1.25 on Duro-Tech TPO). Non-DL TPO and EPDM Rubber, both attachments: the 60 mil
-- entry becomes 1.25; the other entries (45 mil 1; TPO 80 mil 1.075; EPDM 75 mil 1.05, 90 mil 1.1)
-- are left as seeded. Their mechanical bases already read 12 (20261008130000). Applied live the
-- same day through the Lovable database tool.
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
where c.roof_system in ('Non-DL TPO', 'EPDM Rubber');
