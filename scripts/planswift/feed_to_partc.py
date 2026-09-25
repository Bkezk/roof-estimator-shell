#!/usr/bin/env python3
"""Turn Bid-O-Matic's live-table feed (bid-o-matic-feed.json, the export the "Export PlanSwift
feed" button / the SQL in docs/planswift-bridge.md produces) into partC.json — the table-keyed
file the template generators read. Same keys and column order as the tables in Part C of
docs/planswift-bridge.md, so the generators never depend on parsing markdown.

usage: python3 feed_to_partc.py bid-o-matic-feed.json out/partC.json
"""
import json, sys

feed = json.load(open(sys.argv[1]))
out = {}

def cell(v):
    if v is None: return ""
    if isinstance(v, bool): return "yes" if v else "no"
    if isinstance(v, float): return f"{v:g}"
    return str(v)

def add(key, cols, rows):
    out.setdefault(key, []).append([list(cols)] + [[cell(r.get(c)) for c in cols] for r in rows])

cat = {x["id"]: x for x in feed["pricing_catalog"]}
for i in ["duro_last:duro_last_membrane","duro_last:underlayment","duro_last:fasteners_and_bits","duro_last:termination_bars",
          "duro_last:facia_bars_vinyl_covers","duro_last:gravel_stops","duro_last:drip_edge","duro_last:corners","duro_last:pipe_stacks",
          "duro_last:drain_boots","duro_last:cdr_rings","duro_last:drain_boot_accessories","duro_last:vents","duro_last:walk_pads_wall_vents",
          "duro_last:conduit_washers","duro_last:sealants","duro_last:membrane_accs","duro_last:panduit",
          "non_dl:roof_edge_blocking","non_dl:parapet_wall_blocking","non_dl:sheet_metal_work","non_dl:structural_deck_materials",
          "non_dl:masonry","non_dl:3rd_party_services","non_dl:subcontractors","non_dl:preset_custom_applications","non_dl:others"]:
    x = cat[i]
    cols = [k for k in (x["columns"] or []) if k]
    rows = [{k: v for k, v in r.items() if not k.startswith("_")} for r in (x["rows"] or [])]
    if rows: add(f"`{i}` — {x['category']}", cols, rows)

add("C.3 Adhesives", ["adhesive_id","short_name","long_name","part_number","price","unit_type","field_spacing_in","perim_spacing_in","used_with_wall"], feed["legacy_adhesive"])
add("Coverage on a bare deck (sq ft per unit; deck_type_id follows the section deck order 0 Wood … 9 Purlin; roof_system_id per C.4)", ["adhesive_id","roof_system_id","deck_type_id","coverage_sqft","default_value","custom_value"], feed["adhesive_coverage_deck"])
add("Coverage over an underlayment group", ["adhesive_id","roof_system_id","underlayment_group_id","coverage_sqft","default_value","custom_value"], feed["adhesive_coverage_underlayment"])
add("Wall coverage", ["adhesive_id","roof_system_id","coverage_sqft"], feed["adhesive_wall_coverage"])
add("Adhesive labor, hours per 1,000 sq ft", ["adhesive_id","roof_system_id","hours_per_ksqft","custom_hours"], feed["adhesive_labor_per_ksqft"])
add("Underlayment groups and boards", ["underlayment_group_id","description","sort_option"], feed["underlayment_group"])
add("Underlayment groups and boards", ["board_name","underlayment_group_id","subtype","need_quote","sort","subtype_sort"], feed["underlayment_board_group"])
add("C.4 Roof systems", ["roof_system_id","short_name","long_name","lap_over","needs_vents","is_insulation","mech_wall_fasteners","sort_order"], feed["legacy_roof_system"])

for cmb in feed["rdl_combos"]:
    d = cmb["data"]; key = f"{cmb['roof_system']} / {cmb['attachment']}"
    if d.get("deck_multipliers"): add(key, ["deck","multiplier"], [{"deck": k, "multiplier": v} for k, v in d["deck_multipliers"].items()])
    if d.get("fastener_spacing_multipliers"): add(key, ["spacing_in","multiplier"], d["fastener_spacing_multipliers"])
    if d.get("sheet_size_multipliers"): add(key, ["label","roof_section","underlayment"], d["sheet_size_multipliers"])
    if d.get("thickness_multipliers"): add(key, ["mil","multiplier"], d["thickness_multipliers"])
    a = d.get("adhesive") or {}
    if a.get("base_hours_per_1000_sqft_by_substrate"): add(key, ["substrate","labor_per_1000_sqft"], a["base_hours_per_1000_sqft_by_substrate"])
    out.setdefault(key, [])
k = "Tab / roll-width multipliers (`mech_tab_multi`) and roll widths (`rdl_roll_good_width`), by roof_system_id"
add(k, ["roof_system_id","tab_spacing","multiplier","custom_multi"], feed["mech_tab_multi"])
add(k, ["roof_system_id","width_in","multiplier","custom_multiplier"], feed["rdl_roll_good_width"])
k = "Sheet tab spacings offered (`mech_sheet_tab_spacing`) and adhered sheet multipliers (`rdl_adhered_sheet_multi`)"
add(k, ["roof_system_id","spacing"], feed["mech_sheet_tab_spacing"])
add(k, list(feed["rdl_adhered_sheet_multi"][0].keys()), feed["rdl_adhered_sheet_multi"])
add("C.6 Fastener spacing from the pull test (`mech_fastener_lookup`)", ["roof_system_id","design_table","pull_test","tab_spacing","membrane_thickness","field_spacing","perim_spacing","corner_spacing"], feed["mech_fastener_lookup"])
add("C.7 Parapet labor (`labor_parapet`, hours per 50 ft)", ["deck_type","wall_height_band","no_drill_no_cant","no_drill_canted","predrill_no_cant","predrill_canted"], feed["labor_parapet"])
add("C.8 Curb labor", ["deck_type","minutes","setup_minutes"], feed["labor_curb_deck"])
add("C.8 Curb labor", ["curb_type","multiplier"], feed["labor_curb_type"])
u = next(x for x in feed["rdl_labor_tables"] if x["id"] == "underlayment_layout_mechanical")["data"]
add("C.9 Underlayment mechanical layout labor", ["underlayment","layout_hours_per_2500sqft"], u["rows"])
add("C.9 Underlayment mechanical layout labor", ["count","per_sqft","selected"], u["fasteners_per_4x8_options"])
add("C.9 Underlayment mechanical layout labor", ["deck","minutes_per_fastener"], [{"deck": k, "minutes_per_fastener": v} for k, v in u["fastening_times_min_per_fastener_by_deck"].items()])
t = next(x for x in feed["rdl_labor_tables"] if x["id"] == "tearoff_times")["data"]
decks = list(t["rows"][0]["by_deck"].keys())
add("C.10 Tear-off labor (hours per 100 sq ft, by tear-off type and deck)", ["tearoff_type"] + decks, [{"tearoff_type": r["tearoff_type"], **r["by_deck"]} for r in t["rows"]])
add("C.11 Setup and inspection", ["sqft","multiplier"], feed["labor_setup_steps"])
add("C.11 Setup and inspection", ["sqft","hours"], feed["labor_inspection_steps"])
for a in feed["accessory_labor"]:
    d = a["data"]
    if d.get("rows"): add(f"`{a['id']}` — {a['category']}", [c for c in d.get("columns", []) if c] or list(d["rows"][0].keys()), d["rows"])
add("C.13 Shipping, settings, markup", ["material_threshold","shipping_cost"], feed["shipping_steps"])
add("C.13 Shipping, settings, markup", ["name","is_default","hourly_rate","markup_type","markup_amount","include_per_diem","include_commission"], feed["markup_options"])
# extras the generators can use instead of hard-coded constants
cs = feed["company_settings"][0]
add("C.13 Company settings", ["sales_tax_rate","tax_material_only","hours_per_man_day","shipping_method","shipping_percent"], [cs])
add("C.11 Setup minimum", ["minimum_hours"], feed["labor_setup"])
add("C.8 Curb setup", ["setup_minutes"], feed["labor_curb"])

json.dump(out, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
print("wrote", sys.argv[2], "keys:", len(out))
