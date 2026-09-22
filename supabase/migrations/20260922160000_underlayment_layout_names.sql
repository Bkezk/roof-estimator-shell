-- The underlayment layout-hours table was captured from the legacy screen with its grid's
-- truncated labels ("1/4" DensDeck P..."), so those eight products never matched the catalog
-- name and billed 0 layout hours (engine warning "No underlayment layout time"). Rename to the
-- catalog names; the captured hours are unchanged. Idempotent.
update public.rdl_labor_tables t
set data = jsonb_set(t.data, '{rows}', (
  select jsonb_agg(
    case r->>'underlayment'
      when '1/4" DensDeck P...' then r || '{"underlayment":"1/4\" DensDeck Prime"}'::jsonb
      when '1/2" DensDeck P...' then r || '{"underlayment":"1/2\" DensDeck Prime"}'::jsonb
      when '5/8" DensDeck P...' then r || '{"underlayment":"5/8\" DensDeck Prime"}'::jsonb
      when '1/4" Securock G...' then r || '{"underlayment":"1/4\" Securock GFRB"}'::jsonb
      when '3/8" Securock G...' then r || '{"underlayment":"3/8\" Securock GFRB"}'::jsonb
      when '1/2" Securock G...' then r || '{"underlayment":"1/2\" Securock GFRB"}'::jsonb
      when '5/8" Securock G...' then r || '{"underlayment":"5/8\" Securock GFRB"}'::jsonb
      when '5/8" F/C Sheet R...' then r || '{"underlayment":"5/8\" F/C Sheet Rock"}'::jsonb
      else r end)
  from jsonb_array_elements(t.data->'rows') r))
where t.id = 'underlayment_layout_mechanical';
