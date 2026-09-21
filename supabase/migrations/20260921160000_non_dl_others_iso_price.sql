-- Non-DL "Others" RefID 2 — ISO (Curb Insulation Sq Ft). Legacy prices this group from the
-- vendor DB (ref_ndl) with NO BAManager screen, so the value was never capturable from the
-- admin app. It is pinned from the legacy Estimate Review of the Knox County CTC bid: "Other"
-- $46.80 = 156 sq ft (Ceil of Σ Round((A+B)/6, 8) × qty over the insulated curbs) × $0.30
-- (docs/legacy-money-parity.md §22.24). Clears the seed's _uncaptured marker on that row.
update public.pricing_catalog
set data = jsonb_set(
  data,
  '{rows}',
  (
    select jsonb_agg(
      case when r->>'Description' = 'ISO (Curb Insulation Sq Ft)'
           then (r - '_uncaptured') || '{"Price": 0.3}'::jsonb
           else r end
    )
    from jsonb_array_elements(data->'rows') r
  )
)
where id = 'non_dl:others'
  and exists (
    select 1 from jsonb_array_elements(data->'rows') r
    where r->>'Description' = 'ISO (Curb Insulation Sq Ft)' and (r->>'Price')::numeric = 0
  );
