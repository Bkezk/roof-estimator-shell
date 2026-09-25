# PlanSwift template generator (Bid-O-Matic bridge)

Builds the two PlanSwift 11 template sets described in `docs/planswift-bridge.md`:

- `Bid-O-Matic.SwiftTemplates` — Part A, quantities only (what Bid-O-Matic imports).
- `Bid-O-Matic Costing.SwiftTemplates` — Part A plus Part B cost parts, every price and labor
  table taken from Bid-O-Matic's live tables.

The generators came from the PlanSwift build chat (Sep 25, 2026); `feed_to_partc.py` replaces
that chat's markdown-table parser so the pipeline runs from Bid-O-Matic's own export.

## Inputs

1. `sample/XMLData.XML` — the owner's own PlanSwift 11 template export (`templets.SwiftTemplates`
   is a zip holding this one file; unzip it here). The generators clone its Basic Area / Linear /
   Count items so every system property is exactly what this PlanSwift version wrote. Not in
   git (`PS_SAMPLE_XML` overrides the path).
2. `bid-o-matic-feed.json` — the live-table export (the SQL in the session that produced it is
   the `jsonb_build_object(...)` over pricing_catalog, rdl_combos, rdl_labor_tables,
   accessory_labor, labor_*, mech_*, rdl_*, adhesive_*, legacy_*, underlayment_*,
   shipping_steps, company_settings, markup_options; an "Export PlanSwift feed" button on
   Estimate Pricing is the durable home for it — TODO 9b).

## Run

```
python3 scripts/planswift/feed_to_partc.py bid-o-matic-feed.json scripts/planswift/out/partC.json
python3 scripts/planswift/build_bom_templates.py      # -> scripts/planswift/out/Bid-O-Matic.SwiftTemplates
python3 scripts/planswift/build_costing.py            # -> scripts/planswift/out/Bid-O-Matic Costing.SwiftTemplates
```

Environment overrides: `PS_SAMPLE_XML`, `PS_PARTC`, `PS_OUT`. `pseval.py` evaluates the
generated formulas in Python so a takeoff can be checked without PlanSwift.

`feed_to_partc.py` reproduces the shipped `partC.json` table for table (verified: zero
differing rows on the Sep 25 feed) and adds three extras the costing build reads instead of
literals: company settings (tax), setup minimum hours, curb setup minutes.

Regenerate after every price import: re-export the feed, run the three commands, import the
new `.SwiftTemplates` in PlanSwift (Templates panel → import; same item names, so existing
drawings keep working).
