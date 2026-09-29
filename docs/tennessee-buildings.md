# Tennessee buildings

The owner asked on Sep 29 for Tennessee, whole state, the same way Kentucky is loaded. This is
how the Tennessee buildings get into `public.buildings`.

## Source

Kentucky's buildings come from Kentucky's own GIS server. Tennessee has no state copy, so its
buildings come from the national FEMA / ORNL **USA Structures** layer
(`USA_STRUCTURES_LAYER` in `src/lib/gis/tn-layers.ts`). It holds the same ORNL footprints
Kentucky republishes. For Tennessee it also carries the occupancy class (`OCC_CLS`,
`PRIM_OCC`), the county (`PROP_CNTY`, `FIPS`) and, for many buildings, the street address
(`PROP_ADDR`, `PROP_CITY`, `PROP_ZIP`).

The layer serves 2,000 rows a page and supports paging. A statewide query with no county times
out, so the loader always queries one county at a time.

Tennessee publishes no statewide 911 address points or schools service. That means Tennessee
gets footprints only. There is no address matching, no promoted named businesses and no
schools, which Kentucky has.

## Filter and counts (checked Sep 29, 2026)

`tnCountyWhere`: `FIPS = '<county>' AND SQFEET >= 5000 AND (OCC_CLS IS NULL OR OCC_CLS <> 'Residential')`.
The 5,000 sq ft floor is the Kentucky one. **Unclassified** buildings stay in, because the
classifier misses plenty of commercial roofs. The class is stored as `land_use`, so it can be
filtered later.

| Scope                                                                                 |                   Rows |
| ------------------------------------------------------------------------------------- | ---------------------: |
| Statewide, non-residential, ≥ 5,000 sq ft (a full `--all --dry-run`)                  |                102,170 |
| Davidson, same filter (dry run)                                                       |                 10,769 |
| Davidson, commercial classes only (Commercial, Assembly, Education, Gov., Industrial) |                  8,563 |
| Shelby / Knox / Hamilton                                                              | 12,492 / 7,260 / 5,780 |
| Pickett (smallest kind of county)                                                     |                    199 |

Davidson by class (≥ 5,000 sq ft): Commercial 6,864, Residential 10,216 (skipped),
Unclassified 2,039, Education 777, Assembly 485, Government 281, Industrial 156,
Utility and Misc 156, Agriculture 11.

## What a row looks like

`tnBuildingRow` in `src/lib/gis/tn-layers.ts` builds each row. It reuses Kentucky's
`footprintFromFeature`, so the footprint, perimeter and height are computed the same way.

| Column                          | From                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `source` / `source_key`         | `ornl` / `usa:<BUILD_ID>` (Kentucky's are `ornl:<BUILD_ID>`; the two never collide) |
| `source_layer`                  | the USA Structures layer URL                                                        |
| `state`                         | `TN` (needs migration `20260929210000_buildings_state_tn.sql`)                      |
| `county`                        | `PROP_CNTY`, else the FIPS code's county                                            |
| `name`                          | `PRIM_OCC` (e.g. "Retail Trade")                                                    |
| `address1` / `city` / `zip`     | `PROP_ADDR` / `PROP_CITY` title-cased ("NASHVILLE" → "Nashville") / `PROP_ZIP`      |
| `land_use`                      | `OCC_CLS`                                                                           |
| `roof_sqft`                     | `SQFEET`, rounded                                                                   |
| `perimeter_ft`                  | computed from the outline (ground-corrected, like Kentucky)                         |
| `height_ft`                     | `HEIGHT` in metres × 3.2808, when present (mostly empty)                            |
| `footprint`                     | WGS84 GeoJSON Polygon (MultiPolygon for multi-part outlines)                        |
| `centroid_lat` / `centroid_lng` | `LATITUDE` / `LONGITUDE`                                                            |

`upsert_buildings` never overwrites a name, address, city, zip or land use a person typed. It
fills those only when they are empty.

## Running it

```sh
# Check without writing (no login needed): counts, paging, a sample row
npx vite-node scripts/load-tennessee.ts --county Davidson --dry-run
npx vite-node scripts/load-tennessee.ts --all --dry-run          # ~5 minutes

# Load (LOADER_EMAIL + LOADER_PASSWORD in the environment, like Kentucky)
npx vite-node scripts/load-tennessee.ts --county Davidson
npx vite-node scripts/load-tennessee.ts --all [--min-sqft 5000] [--shard 1/2] [--skip-fresh 2]
```

- **Before the first load:** apply `supabase/migrations/20260929210000_buildings_state_tn.sql`.
  The old `upsert_buildings` ignores `state` and would store the rows as `KY`. The loader
  reads its first row back and stops if that happened.
- **Monthly:** `.github/workflows/refresh-tennessee.yml` runs at 05:00 UTC on the 2nd, the
  day after Kentucky's pass, so the two never share the small database. You can also start it
  by hand under Actions › "Refresh Tennessee data" › Run workflow. It takes one county, a shard
  (`2/3`) or "skip counties refreshed in the last N days", and uses the same `LOADER_EMAIL` /
  `LOADER_PASSWORD` secrets as Kentucky. Every run reloads the footprints, about 102,000
  upserts. If that proves too heavy for the database, run it quarterly instead.
- **Refresh log:** each county gets a `data_refreshes` row named `"<County>, TN"`. Thirty-four
  county names exist in both states, so a bare name would collide with Kentucky's.
  `--skip-fresh` reads these rows.
