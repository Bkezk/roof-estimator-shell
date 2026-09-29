/**
 * Tennessee data sources (owner, Sep 29: "we actually cover TN as well … whole state").
 *
 * Kentucky's buildings come from Kentucky's own GIS server (ky-layers.ts). Tennessee has no
 * such state copy, so its buildings come from the national FEMA / ORNL "USA Structures" layer
 * (the same ORNL footprints Kentucky republishes), which for Tennessee also carries the
 * occupancy class, the county name and, for many buildings, the street address. Imagery is
 * TDOT's statewide orthophoto tile cache (6-inch from 2022, 1-foot before), county by county.
 *
 * Verified Sep 29, 2026 from the sandbox:
 *   - USA Structures fields: BUILD_ID, OCC_CLS, PRIM_OCC, PROP_ADDR, PROP_CITY, PROP_ST
 *     ("Tennessee", spelled out), PROP_ZIP, PROP_CNTY, FIPS ("47037"), STATE_FIPS, SQFEET,
 *     HEIGHT (metres, mostly null), LATITUDE, LONGITUDE; polygons in Web Mercator; 2000 rows a
 *     page with pagination and statistics.
 *   - Non-residential buildings of 5,000 sq ft and up: 102,170 across the 95 counties.
 *   - TDOT imagery: tile cache to level 23; index layer 0 has Cnty_Name, TN_Ortho_Year, NAIP_Year.
 */

/** National FEMA / ORNL structures layer (polygons, all states). */
export const USA_STRUCTURES_LAYER =
  "https://services2.arcgis.com/FiaPA4ga0iQKduv3/ArcGIS/rest/services/USA_Structures_View/FeatureServer/0";

/** TDOT statewide orthoimagery, Web Mercator tile cache ({z}/{y}/{x} order, ArcGIS style). */
export const TN_IMAGERY_TILES =
  "https://tnmap.tn.gov/arcgis/rest/services/BASEMAPS/IMAGERY_WEB_MERCATOR/MapServer/tile/{z}/{y}/{x}";
/** One polygon per county with the year of the imagery shown (TN_Ortho_Year) and the NAIP year. */
export const TN_IMAGERY_INDEX_LAYER =
  "https://tnmap.tn.gov/arcgis/rest/services/BASEMAPS/IMAGERY_WEB_MERCATOR/MapServer/0";
export const TN_IMAGERY_CREDIT = "Imagery © TDOT Aerial Surveys (6-inch from 2022, 1-foot before)";
/** Highest tile level the cache serves. */
export const TN_IMAGERY_MAX_ZOOM = 23;

/** Tennessee, [[west, south], [east, north]] in degrees; overlaps Kentucky's along the line. */
export const TN_BOUNDS: [[number, number], [number, number]] = [
  [-90.31, 34.98],
  [-81.65, 36.68],
];

export const TN_STATE_FIPS = "47";

/** The 95 counties with their FIPS codes, as the national layer spells them (PROP_CNTY). */
export const TN_COUNTIES: readonly { name: string; fips: string }[] = [
  { name: "Anderson", fips: "47001" },
  { name: "Bedford", fips: "47003" },
  { name: "Benton", fips: "47005" },
  { name: "Bledsoe", fips: "47007" },
  { name: "Blount", fips: "47009" },
  { name: "Bradley", fips: "47011" },
  { name: "Campbell", fips: "47013" },
  { name: "Cannon", fips: "47015" },
  { name: "Carroll", fips: "47017" },
  { name: "Carter", fips: "47019" },
  { name: "Cheatham", fips: "47021" },
  { name: "Chester", fips: "47023" },
  { name: "Claiborne", fips: "47025" },
  { name: "Clay", fips: "47027" },
  { name: "Cocke", fips: "47029" },
  { name: "Coffee", fips: "47031" },
  { name: "Crockett", fips: "47033" },
  { name: "Cumberland", fips: "47035" },
  { name: "Davidson", fips: "47037" },
  { name: "Decatur", fips: "47039" },
  { name: "DeKalb", fips: "47041" },
  { name: "Dickson", fips: "47043" },
  { name: "Dyer", fips: "47045" },
  { name: "Fayette", fips: "47047" },
  { name: "Fentress", fips: "47049" },
  { name: "Franklin", fips: "47051" },
  { name: "Gibson", fips: "47053" },
  { name: "Giles", fips: "47055" },
  { name: "Grainger", fips: "47057" },
  { name: "Greene", fips: "47059" },
  { name: "Grundy", fips: "47061" },
  { name: "Hamblen", fips: "47063" },
  { name: "Hamilton", fips: "47065" },
  { name: "Hancock", fips: "47067" },
  { name: "Hardeman", fips: "47069" },
  { name: "Hardin", fips: "47071" },
  { name: "Hawkins", fips: "47073" },
  { name: "Haywood", fips: "47075" },
  { name: "Henderson", fips: "47077" },
  { name: "Henry", fips: "47079" },
  { name: "Hickman", fips: "47081" },
  { name: "Houston", fips: "47083" },
  { name: "Humphreys", fips: "47085" },
  { name: "Jackson", fips: "47087" },
  { name: "Jefferson", fips: "47089" },
  { name: "Johnson", fips: "47091" },
  { name: "Knox", fips: "47093" },
  { name: "Lake", fips: "47095" },
  { name: "Lauderdale", fips: "47097" },
  { name: "Lawrence", fips: "47099" },
  { name: "Lewis", fips: "47101" },
  { name: "Lincoln", fips: "47103" },
  { name: "Loudon", fips: "47105" },
  { name: "McMinn", fips: "47107" },
  { name: "McNairy", fips: "47109" },
  { name: "Macon", fips: "47111" },
  { name: "Madison", fips: "47113" },
  { name: "Marion", fips: "47115" },
  { name: "Marshall", fips: "47117" },
  { name: "Maury", fips: "47119" },
  { name: "Meigs", fips: "47121" },
  { name: "Monroe", fips: "47123" },
  { name: "Montgomery", fips: "47125" },
  { name: "Moore", fips: "47127" },
  { name: "Morgan", fips: "47129" },
  { name: "Obion", fips: "47131" },
  { name: "Overton", fips: "47133" },
  { name: "Perry", fips: "47135" },
  { name: "Pickett", fips: "47137" },
  { name: "Polk", fips: "47139" },
  { name: "Putnam", fips: "47141" },
  { name: "Rhea", fips: "47143" },
  { name: "Roane", fips: "47145" },
  { name: "Robertson", fips: "47147" },
  { name: "Rutherford", fips: "47149" },
  { name: "Scott", fips: "47151" },
  { name: "Sequatchie", fips: "47153" },
  { name: "Sevier", fips: "47155" },
  { name: "Shelby", fips: "47157" },
  { name: "Smith", fips: "47159" },
  { name: "Stewart", fips: "47161" },
  { name: "Sullivan", fips: "47163" },
  { name: "Sumner", fips: "47165" },
  { name: "Tipton", fips: "47167" },
  { name: "Trousdale", fips: "47169" },
  { name: "Unicoi", fips: "47171" },
  { name: "Union", fips: "47173" },
  { name: "Van Buren", fips: "47175" },
  { name: "Warren", fips: "47177" },
  { name: "Washington", fips: "47179" },
  { name: "Wayne", fips: "47181" },
  { name: "Weakley", fips: "47183" },
  { name: "White", fips: "47185" },
  { name: "Williamson", fips: "47187" },
  { name: "Wilson", fips: "47189" },
];

const byFips = new Map(TN_COUNTIES.map((c) => [c.fips, c.name]));
const byName = new Map(TN_COUNTIES.map((c) => [c.name.toLowerCase(), c.fips]));

/** "Davidson" for "47037"; null for a code outside Tennessee. */
export const tnCountyFromFips = (fips: string | null | undefined): string | null =>
  fips ? (byFips.get(fips) ?? null) : null;
/** "47037" for "Davidson" (case-insensitive, " County" suffix tolerated); null when unknown. */
export const tnFipsForCounty = (name: string): string | null =>
  byName.get(
    name
      .trim()
      .replace(/\s+county$/i, "")
      .toLowerCase(),
  ) ?? null;

/**
 * Buildings worth prospecting in a county: 5,000 sq ft and up (the Kentucky floor) and not
 * residential. Unclassified stays in (the classifier misses plenty of commercial roofs);
 * the class is stored as land_use so it can be filtered later.
 */
export const tnCountyWhere = (fips: string, minSqFt = 5000): string =>
  `FIPS = '${fips}' AND SQFEET >= ${minSqFt} AND (OCC_CLS IS NULL OR OCC_CLS <> 'Residential')`;

/** Rough test used to pick imagery and footprint sources; the KY/TN line band needs the county. */
export const inTennesseeBox = (lat: number, lng: number): boolean =>
  lat >= TN_BOUNDS[0][1] &&
  lat <= TN_BOUNDS[1][1] &&
  lng >= TN_BOUNDS[0][0] &&
  lng <= TN_BOUNDS[1][0];
