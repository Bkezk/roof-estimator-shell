-- Mark every pre-loaded (seeded) flat pricing_catalog row with `_locked: true`.
-- Loaded items then keep their name and can't be deleted in the catalog editor (their prices
-- stay editable); rows a user adds later omit the marker and are fully editable/deletable.
-- Master-detail screens (those carrying a `kind` discriminator, with their own editors) are left
-- untouched. The marker is a reserved row key that is NOT a column, so the calculation engine's
-- adapters — which read named columns only — ignore it entirely.
--
-- Idempotent: `elem || '{"_locked": true}'` overwrites the key, so re-running is a no-op.

update pricing_catalog
set data = jsonb_set(
  data, '{rows}',
  (select jsonb_agg(elem || '{"_locked": true}'::jsonb) from jsonb_array_elements(data->'rows') elem)
)
where data ? 'rows' and not (data ? 'kind');
