-- Non-DL "Others" collection (legacy ref_ndlOthers): the two auto-quantity rows the estimator never
-- edits directly (NDLOthers.RecalcParents rva 0xa9054: row 1 = Ceil(parapet + curb polyethylene
-- sq ft), row 2 = Ceil(curb ISO sq ft)). The live database already carries this screen (added
-- 2026-09-10 via the live console); this migration records it for fresh environments. Prices and
-- labor were not in the install files (_uncaptured, $0).
insert into public.pricing_catalog (id, branch, category, data, sort)
select 'non_dl:others', 'non_dl', 'Others',
  '{"help": "Legacy NDL \"Others\" collection (ref_ndlOthers): auto-quantity rows the estimator never edits directly. Row 1 (DL Approved Slipsheet) = Ceil(parapet + curb polyethylene sq ft); row 2 = Ceil(curb ISO sq ft). Prices/labor were not in the install files - NOT reachable from either legacy UI: the Bid-Advantage Management tree has no Others node under Non Duro-Last Pricing (8 nodes only), and the Estimator's Edit/double-click dispatch skips the Others category (frmNonDLReconcile, which would show them, is never instantiated). They live only in the vendor DB table ref_ndlOthers. Capture route: build a legacy bid with a parapet/curb using the polyethylene option and a curb with insulation, then read Qty and Material off the Non-Duro-Last screen's summary list Others rows and divide. Row 2's real description comes from the same list (ours is a stand-in).", "rows": [{"Price": 0, "_locked": true, "Labor Rate": 0, "Description": "DL Approved Slipsheet", "_uncaptured": true, "LaborPerUnit": 0}, {"Price": 0, "_locked": true, "Labor Rate": 0, "Description": "ISO (Curb Insulation Sq Ft)", "_uncaptured": true, "LaborPerUnit": 0}], "extras": {}, "columns": ["Description", "Price", "LaborPerUnit", "Labor Rate"]}'::jsonb,
  8
where not exists (select 1 from public.pricing_catalog where id = 'non_dl:others');
