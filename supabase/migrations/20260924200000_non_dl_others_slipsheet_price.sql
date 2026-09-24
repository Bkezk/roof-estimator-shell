-- Non-DL "Others" RefID 1 — DL Approved Slipsheet. The unit cost was never in the install
-- files, but every legacy estimate file (.bax) carries the ref_ndlOthers rows with their live
-- unit costs under <nondl><otherndl>: all five of the owner's bids (Broad Head, Combined Bid
-- Project Test, Knox County Fiscal Court, Monticello Banking 2026, Summit) agree on
--   refid 1 "DL Approved Slipsheet"  unitcost 0.01375  laborperunit 0
--   refid 2 "Curbs 1 1/2\" ISO"      unitcost 0.3      laborperunit 0
-- Row 2's 0.3 matches the value already pinned from the Knox County CTC Estimate Review
-- (migration 20260921160000), which validates the source. This sets row 1's price, clears its
-- _uncaptured marker, and renames row 2 to the legacy description (ours was a stand-in).
update public.pricing_catalog
set data = jsonb_set(
  jsonb_set(
    data,
    '{rows}',
    (
      select jsonb_agg(
        case
          when r->>'Description' = 'DL Approved Slipsheet' and (r->>'Price')::numeric = 0
            then (r - '_uncaptured') || '{"Price": 0.01375}'::jsonb
          when r->>'Description' = 'ISO (Curb Insulation Sq Ft)'
            then r || '{"Description": "Curbs 1 1/2\" ISO"}'::jsonb
          else r
        end
      )
      from jsonb_array_elements(data->'rows') r
    )
  ),
  '{help}',
  to_jsonb(
    'Legacy NDL "Others" collection (ref_ndlOthers): auto-quantity rows the estimator never edits directly. Row 1 (DL Approved Slipsheet) = Ceil(parapet + curb polyethylene sq ft) at $0.01375/sq ft; row 2 (Curbs 1 1/2" ISO) = Ceil(curb ISO sq ft) at $0.30/sq ft. Neither is reachable from a legacy admin screen; the prices and descriptions come from the <otherndl> rows every legacy estimate file (.bax) carries, cross-checked against the Knox County CTC Estimate Review.'::text
  )
)
where id = 'non_dl:others';
