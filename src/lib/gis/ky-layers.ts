/**
 * Kentucky statewide ArcGIS layers → prospecting rows. Pure: no I/O.
 *
 * Everything here is pinned to owner-supplied samples (src/lib/gis/fixtures, 2026-09-24) from
 * `https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/`:
 *
 * - `Ky_ORNL_Building_Footprints_WGS84WM/MapServer/0` — one polygon per building, statewide.
 *   `SQFEET` is the footprint area (roof area for a flat roof), `LONGITUDE`/`LATITUDE` its
 *   centre, `FIPS` the county (21xxx), `BUILD_ID` the stable key. `PROP_ADDR`/`OCC_CLS` were
 *   null in every sampled record, so the address is joined later from the 911 points and the
 *   "commercial" filter is size (`SQFEET >= n`) until a better signal appears.
 * - `Ky_911_Site_Structure_Address_Points_WGS84WM/MapServer/0` — one point per addressed
 *   structure (NG911 schema). The address is assembled from `AddNum_Pre`, `Add_Number`,
 *   `AddNum_Suf`, `LSt_PreDir`, `LSt_Name`, `LSt_Type`, `LSt_PosDir`; `County` reads
 *   "MCLEAN COUNTY"; `Post_Comm`/`Post_Code` (postal city/zip) were null in the sample.
 * - `Ky_Schools_WGS84WM/MapServer/0` (and the other facility point layers) — a name, a street
 *   address, city, zip, county and WGS84 lat/lng columns; the point geometry is Web Mercator.
 * - `Ky_Imagery_Phase3_3IN_WGS84WM/MapServer` — a fused tile cache (256 px PNG8, standard Web
 *   Mercator levels 0–21, origin −20037508.34), so the map can pull tiles straight from
 *   `.../MapServer/tile/{z}/{y}/{x}`.
 */
import {
  mercatorToLngLat,
  num,
  parcelGeometry,
  str,
  type ArcGisFeature,
  type ArcGisField,
} from "./arcgis";
import type { ParcelGeometry } from "./arcgis";

export const KY_SERVICES = "https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services";
export const KY_FOOTPRINTS_LAYER = `${KY_SERVICES}/Ky_ORNL_Building_Footprints_WGS84WM/MapServer/0`;
export const KY_ADDRESS_POINTS_LAYER = `${KY_SERVICES}/Ky_911_Site_Structure_Address_Points_WGS84WM/MapServer/0`;
export const KY_SCHOOLS_LAYER = `${KY_SERVICES}/Ky_Schools_WGS84WM/MapServer/0`;
export const KY_WEBSTER_PARCELS_LAYER = `${KY_SERVICES}/Ky_PVA_Webster_Parcels_WGS84WM/MapServer/1`;
export const KY_IMAGERY_PHASE3_SERVICE = `${KY_SERVICES}/Ky_Imagery_Phase3_3IN_WGS84WM/MapServer`;

/**
 * Kentucky's 120 counties by FIPS code (state 21; county codes are the odd numbers 001–239 in
 * alphabetical order). Checked against the footprint sample: 21083 sits at −88.79/36.52
 * (south-west Graves County) and 21035 at −88.31/36.52 (south of Murray, Calloway County).
 */
export const KY_COUNTIES: readonly string[] = [
  "Adair",
  "Allen",
  "Anderson",
  "Ballard",
  "Barren",
  "Bath",
  "Bell",
  "Boone",
  "Bourbon",
  "Boyd",
  "Boyle",
  "Bracken",
  "Breathitt",
  "Breckinridge",
  "Bullitt",
  "Butler",
  "Caldwell",
  "Calloway",
  "Campbell",
  "Carlisle",
  "Carroll",
  "Carter",
  "Casey",
  "Christian",
  "Clark",
  "Clay",
  "Clinton",
  "Crittenden",
  "Cumberland",
  "Daviess",
  "Edmonson",
  "Elliott",
  "Estill",
  "Fayette",
  "Fleming",
  "Floyd",
  "Franklin",
  "Fulton",
  "Gallatin",
  "Garrard",
  "Grant",
  "Graves",
  "Grayson",
  "Green",
  "Greenup",
  "Hancock",
  "Hardin",
  "Harlan",
  "Harrison",
  "Hart",
  "Henderson",
  "Henry",
  "Hickman",
  "Hopkins",
  "Jackson",
  "Jefferson",
  "Jessamine",
  "Johnson",
  "Kenton",
  "Knott",
  "Knox",
  "Larue",
  "Laurel",
  "Lawrence",
  "Lee",
  "Leslie",
  "Letcher",
  "Lewis",
  "Lincoln",
  "Livingston",
  "Logan",
  "Lyon",
  "McCracken",
  "McCreary",
  "McLean",
  "Madison",
  "Magoffin",
  "Marion",
  "Marshall",
  "Martin",
  "Mason",
  "Meade",
  "Menifee",
  "Mercer",
  "Metcalfe",
  "Monroe",
  "Montgomery",
  "Morgan",
  "Muhlenberg",
  "Nelson",
  "Nicholas",
  "Ohio",
  "Oldham",
  "Owen",
  "Owsley",
  "Pendleton",
  "Perry",
  "Pike",
  "Powell",
  "Pulaski",
  "Robertson",
  "Rockcastle",
  "Rowan",
  "Russell",
  "Scott",
  "Shelby",
  "Simpson",
  "Spencer",
  "Taylor",
  "Todd",
  "Trigg",
  "Trimble",
  "Union",
  "Warren",
  "Washington",
  "Wayne",
  "Webster",
  "Whitley",
  "Wolfe",
  "Woodford",
];

/**
 * The core counties: Kentucky's top ten by business establishments (Census County Business
 * Patterns 2022, docs/ky-county-ranking.md), in rank order — the owner's rule of 2026-09-23.
 */
export const KY_CORE_COUNTIES: readonly string[] = [
  "Jefferson",
  "Fayette",
  "Kenton",
  "Boone",
  "Warren",
  "Daviess",
  "Hardin",
  "McCracken",
  "Campbell",
  "Madison",
];

/** "21083" → "Graves"; unknown → null. */
export function countyFromFips(fips: string | null | undefined): string | null {
  const m = /^21(\d{3})$/.exec((fips ?? "").trim());
  if (!m) return null;
  const code = Number(m[1]);
  if (code % 2 === 0) return null;
  return KY_COUNTIES[(code - 1) / 2] ?? null;
}

/** "Graves" → "21083"; unknown → null. */
export function fipsForCounty(county: string): string | null {
  const i = KY_COUNTIES.findIndex((c) => c.toLowerCase() === county.trim().toLowerCase());
  return i < 0 ? null : `21${String(i * 2 + 1).padStart(3, "0")}`;
}

/** "MCLEAN COUNTY" / "adair" / "McLean County" → the canonical county name; else trimmed input. */
export function canonicalCounty(name: string | null | undefined): string | null {
  const raw = str(name);
  if (!raw) return null;
  const bare = raw
    .replace(/\s+county$/i, "")
    .trim()
    .toLowerCase();
  return KY_COUNTIES.find((c) => c.toLowerCase() === bare) ?? raw;
}

/** What kind of layer a URL (or its field list) is; drives parsing and the upsert key. */
export type LayerKind = "parcel" | "footprint" | "address" | "facility";

export function detectLayerKind(layerUrl: string, fields: ArcGisField[]): LayerKind {
  const names = new Set(fields.map((f) => f.name.toUpperCase()));
  if (/Building_Footprints/i.test(layerUrl) || (names.has("SQFEET") && names.has("BUILD_ID"))) {
    return "footprint";
  }
  if (/Address_Points/i.test(layerUrl) || (names.has("ADD_NUMBER") && names.has("LST_NAME"))) {
    return "address";
  }
  if (/_PVA_.*_Parcels/i.test(layerUrl) || names.has("PARCEL_ID")) return "parcel";
  return "facility";
}

/** Point geometry (Mercator x/y) or explicit lat/lng columns → [lng, lat]. */
function pointOf(
  f: ArcGisFeature,
  latField?: string,
  lngField?: string,
): { lat: number; lng: number } | null {
  const a = f.attributes;
  const lat = latField ? num(a[latField]) : null;
  const lng = lngField ? num(a[lngField]) : null;
  if (lat !== null && lng !== null && lat !== 0 && lng !== 0) return { lat, lng };
  const g = f.geometry;
  if (g && typeof g.x === "number" && typeof g.y === "number") {
    const [lng2, lat2] = mercatorToLngLat([g.x, g.y]);
    return { lat: lat2, lng: lng2 };
  }
  return null;
}

// ── Building footprints (ORNL) ──────────────────────────────────────────────────────────────

export interface FootprintCandidate {
  buildId: string;
  fips: string | null;
  county: string | null;
  /** The published footprint area (SQFEET), rounded. */
  roofSqFt: number | null;
  heightFt: number | null;
  occupancyClass: string | null;
  primaryOccupancy: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  geometry: ParcelGeometry | null;
}

export function footprintFromFeature(f: ArcGisFeature): FootprintCandidate | null {
  const a = f.attributes;
  const buildId = str(a["BUILD_ID"]) ?? str(a["UUID"]) ?? str(a["OBJECTID"]);
  if (!buildId) return null;
  const geometry = f.geometry?.rings ? parcelGeometry(f.geometry.rings) : null;
  const sq = num(a["SQFEET"]);
  const fips = str(a["FIPS"]);
  const heightM = num(a["HEIGHT"]);
  const pt = pointOf(f, "LATITUDE", "LONGITUDE");
  return {
    buildId,
    fips,
    county: countyFromFips(fips),
    roofSqFt: sq && sq > 0 ? Math.round(sq) : (geometry?.computedAreaSqFt ?? null),
    heightFt: heightM && heightM > 0 ? Math.round(heightM * 3.2808 * 10) / 10 : null,
    occupancyClass: str(a["OCC_CLS"]),
    primaryOccupancy: str(a["PRIM_OCC"]),
    address: str(a["PROP_ADDR"]),
    city: str(a["PROP_CITY"]),
    zip: str(a["PROP_ZIP"]),
    lat: pt?.lat ?? geometry?.centroidLat ?? null,
    lng: pt?.lng ?? geometry?.centroidLng ?? null,
    geometry,
  };
}

// ── 911 site/structure address points ───────────────────────────────────────────────────────

export interface AddressPointCandidate {
  /** NG911 site id (`Site_NGUID`), else the OBJECTID. */
  key: string;
  address: string;
  city: string | null;
  zip: string | null;
  county: string | null;
  landmark: string | null;
  placeType: string | null;
  lat: number;
  lng: number;
}

/** "1169 STATE ROUTE 136 W" from the NG911 parts; null when there is no number or street. */
export function composeAddress(a: Record<string, unknown>): string | null {
  const number = [str(a["AddNum_Pre"]), str(a["Add_Number"]), str(a["AddNum_Suf"])]
    .filter(Boolean)
    .join("");
  const street = [
    str(a["LSt_PreDir"]),
    str(a["LSt_Name"]),
    str(a["LSt_Type"]),
    str(a["LSt_PosDir"]),
  ]
    .filter(Boolean)
    .join(" ");
  if (!number || !street) return null;
  return `${number} ${street}`;
}

export function addressPointFromFeature(f: ArcGisFeature): AddressPointCandidate | null {
  const a = f.attributes;
  const address = composeAddress(a);
  const pt = pointOf(f, "Lat", "Long");
  const key = str(a["Site_NGUID"]) ?? str(a["OBJECTID"]);
  if (!address || !pt || !key) return null;
  const muni = str(a["Inc_Muni"]);
  return {
    key,
    address,
    city: str(a["Post_Comm"]) ?? (muni && !/^unincorporated$/i.test(muni) ? muni : null),
    zip: str(a["Post_Code"]),
    county: canonicalCounty(str(a["County"])),
    landmark: str(a["LandmkName"]),
    placeType: str(a["Place_Type"]),
    lat: pt.lat,
    lng: pt.lng,
  };
}

// ── Facility point layers (schools, hospitals, …) ───────────────────────────────────────────

export interface FacilityFieldMap {
  id: string;
  name: string;
  address?: string;
  city?: string;
  zip?: string;
  county?: string;
  lat?: string;
  lng?: string;
  kind?: string;
}

const pick = (names: string[], ...candidates: string[]): string | undefined => {
  const upper = new Map(names.map((n) => [n.toUpperCase(), n]));
  for (const c of candidates) {
    const hit = upper.get(c.toUpperCase());
    if (hit) return hit;
  }
  return undefined;
};

/** Field map for a facility layer; only the Schools layer is sample-verified. */
export function guessFacilityFieldMap(fields: ArcGisField[]): FacilityFieldMap {
  const names = fields.map((f) => f.name);
  const oid = fields.find((f) => f.type === "esriFieldTypeOID")?.name;
  const map: FacilityFieldMap = {
    id:
      pick(names, "KDEID", "FACILITY_ID", "FAC_ID", "ID", "OBJECTID_1", "OBJECTID") ??
      oid ??
      "OBJECTID",
    name:
      pick(
        names,
        "SCHNAME",
        "NAME",
        "FACILITY",
        "FACILITY_NAME",
        "FACNAME",
        "HOSPITAL",
        "COMPANY",
        "SITE_NAME",
      ) ?? "NAME",
  };
  const set = (k: keyof FacilityFieldMap, ...c: string[]) => {
    const v = pick(names, ...c);
    if (v) (map as unknown as Record<string, string>)[k] = v;
  };
  set("address", "STREETADDRESS", "STREET_ADDRESS", "ADDRESS", "STREET", "ADDR", "SITE_ADDR");
  set("city", "CITY", "TOWN");
  set("zip", "ZIP", "ZIPCODE", "ZIP_CODE", "POSTAL");
  set("county", "COUNTY", "COUNTY_NAME", "CNTY");
  set("lat", "LATDDWGS84", "LATITUDE", "LAT", "Y");
  set("lng", "LONDDWGS84", "LONGITUDE", "LONG", "LON", "X");
  set("kind", "CLASSIFICA", "CLASSIFICATION", "TYPE", "FAC_TYPE", "SCHTYPE", "CATEGORY");
  return map;
}

export interface FacilityCandidate {
  key: string;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  county: string | null;
  kind: string | null;
  lat: number | null;
  lng: number | null;
}

export function facilityFromFeature(
  f: ArcGisFeature,
  map: FacilityFieldMap,
): FacilityCandidate | null {
  const a = f.attributes;
  const key = str(a[map.id]);
  const name = str(a[map.name]);
  if (!key || !name) return null;
  const pt = pointOf(f, map.lat, map.lng);
  return {
    key,
    name,
    address: map.address ? str(a[map.address]) : null,
    city: map.city ? str(a[map.city]) : null,
    zip: map.zip ? str(a[map.zip]) : null,
    county: map.county ? canonicalCounty(str(a[map.county])) : null,
    kind: map.kind ? str(a[map.kind]) : null,
    lat: pt?.lat ?? null,
    lng: pt?.lng ?? null,
  };
}

/** "…/Ky_Schools_WGS84WM/MapServer/0" → "Ky_Schools". */
export function layerShortName(layerUrl: string): string {
  const m = /\/([^/]+?)(?:_WGS84WM)?\/(?:MapServer|FeatureServer)\/\d+\/?$/i.exec(layerUrl);
  return m?.[1] ?? "layer";
}

const sqlLit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * How each county's 911 agency spells its own name in the statewide address-point layer —
 * the exact distinct values (owner-supplied, 2026-09-24). The comparison on the state server
 * is case-sensitive, so these exact strings are what the filter must use.
 */
export const KY_911_COUNTY_SPELLINGS: Record<string, string[]> = {
  Adair: ["ADAIR COUNTY"],
  Allen: ["Allen County"],
  Anderson: ["Anderson County"],
  Ballard: ["Ballard County"],
  Barren: ["Barren County"],
  Bath: ["Bath County"],
  Bell: ["Bell County"],
  Boone: ["BOONE COUNTY"],
  Bourbon: ["Bourbon County"],
  Boyd: ["BOYD COUNTY"],
  Boyle: ["Boyle County"],
  Bracken: ["Bracken County"],
  Breathitt: ["Breathitt County"],
  Breckinridge: ["Breckinridge County"],
  Bullitt: ["Bullitt County"],
  Butler: ["Butler County"],
  Caldwell: ["Caldwell County"],
  Calloway: ["Calloway County"],
  Campbell: ["CAMPBELL COUNTY"],
  Carlisle: ["Carlisle County"],
  Carroll: ["Carroll County"],
  Carter: ["Carter County"],
  Casey: ["Casey County", "CASEY"],
  Christian: ["CHRISTIAN COUNTY"],
  Clark: ["Clark"],
  Clay: ["Clay County"],
  Clinton: ["CLINTON COUNTY"],
  Crittenden: ["Crittenden County"],
  Cumberland: ["Cumberland County"],
  Daviess: ["Daviess County"],
  Edmonson: ["Edmonson County"],
  Elliott: ["ELLIOTT COUNTY"],
  Estill: ["Estill County"],
  Fayette: ["Fayette County"],
  Fleming: ["Fleming County"],
  Floyd: ["Floyd County"],
  Franklin: ["Franklin County"],
  Fulton: ["FULTON"],
  Gallatin: ["GALLATIN COUNTY"],
  Garrard: ["Garrard County"],
  Grant: ["Grant County"],
  Graves: ["Graves County"],
  Grayson: ["GRAYSON COUNTY"],
  Green: ["Green County"],
  Greenup: ["Greenup County"],
  Hancock: ["Hancock County"],
  Hardin: ["HARDIN COUNTY"],
  Harlan: ["Harlan County"],
  Harrison: ["Harrison County"],
  Hart: ["Hart County"],
  Henderson: ["Henderson County"],
  Henry: ["Henry County"],
  Hickman: ["Hickman County"],
  Hopkins: ["Hopkins County"],
  Jackson: ["JACKSON County"],
  Jefferson: ["JEFFERSON COUNTY"],
  Jessamine: ["Jessamine County"],
  Johnson: ["JOHNSON COUNTY"],
  Kenton: ["KENTON COUNTY"],
  Knott: ["Knott County"],
  Knox: ["KNOX COUNTY"],
  Larue: ["LaRue County"],
  Laurel: ["Laurel County"],
  Lawrence: ["Lawrence County"],
  Lee: ["Lee County"],
  Leslie: ["Leslie County"],
  Letcher: ["Letcher County"],
  Lewis: ["LEWIS COUNTY"],
  Lincoln: ["Lincoln County"],
  Livingston: ["Livingston County"],
  Logan: ["Logan County"],
  Lyon: ["Lyon County"],
  Madison: ["Madison County"],
  Magoffin: ["Magoffin County"],
  Marion: ["MARION", "MARION COUNTY", "MARION County COUNTY"],
  Marshall: ["Marshall County"],
  Martin: ["MARTIN COUNTY"],
  Mason: ["Mason County"],
  McCracken: ["McCracken County"],
  McCreary: ["McCreary County"],
  McLean: ["MCLEAN COUNTY"],
  Meade: ["Meade County"],
  Menifee: ["Menifee County"],
  Mercer: ["Mercer County"],
  Metcalfe: ["Metcalfe County"],
  Monroe: ["MONROE COUNTY"],
  Montgomery: ["Montgomery County"],
  Morgan: ["Morgan County"],
  Muhlenberg: ["Muhlenberg County"],
  Nelson: ["Nelson County"],
  Nicholas: ["Nicholas County"],
  Ohio: ["Ohio County"],
  Oldham: ["Oldham County"],
  Owen: ["Owen County"],
  Owsley: ["Owsley County"],
  Pendleton: ["Pendleton County"],
  Perry: ["PERRY County"],
  Pike: ["Pike County"],
  Powell: ["Powell County"],
  Pulaski: ["Pulaski County"],
  Robertson: ["Robertson County"],
  Rockcastle: ["Rockcastle County"],
  Rowan: ["ROWAN COUNTY", "ROWAN COUNTRY"],
  Russell: ["RUSSELL COUNTY"],
  Scott: ["Scott County"],
  Shelby: ["Shelby County"],
  Simpson: ["Simpson County"],
  Spencer: ["Spencer County"],
  Taylor: ["Taylor County"],
  Todd: ["TODD COUNTY"],
  Trigg: ["TRIGG COUNTY"],
  Trimble: ["Trimble County"],
  Union: ["Union County"],
  Warren: ["Warren County"],
  Washington: ["Washington County"],
  Wayne: ["Wayne County"],
  Webster: ["Webster County"],
  Whitley: ["Whitley County"],
  Wolfe: ["Wolfe County"],
  Woodford: ["WOODFORD COUNTY"],
};
/** "McLean" → the spellings a county's own file might use for itself. */
export function countySpellings(county: string, withSuffix: boolean): string[] {
  const c = county.trim();
  const upper = c.toUpperCase();
  const title = c;
  const bases = [...new Set([upper, title, c.toLowerCase()])];
  const out: string[] = [...bases];
  if (withSuffix) {
    for (const b of bases) {
      const suffix = b === upper ? " COUNTY" : b === title ? " County" : " county";
      out.push(`${b}${suffix}`, `${b}${b === upper ? " CO" : " Co"}`);
    }
  }
  return [...new Set(out)];
}

/** The per-kind where clause that scopes a statewide layer to one county. */
export function countyWhere(kind: LayerKind, county: string, minSqFt = 5000): string {
  switch (kind) {
    case "footprint": {
      const fips = fipsForCounty(county);
      return fips ? `FIPS = '${fips}' AND SQFEET >= ${minSqFt}` : `SQFEET >= ${minSqFt}`;
    }
    // Plain equality only: a function on the column (UPPER(County) = …) makes the state server
    // scan every row in Kentucky and the request times out. Both layers store the county in
    // capitals (McLean and Adair samples), so the upper-cased literal matches as is.
    // Each county's 911 agency spells its own name: Hardin's file says "HARDIN COUNTY", Ballard's
    // returned 3 rows for that pattern. An IN list of the usual spellings keeps the index.
    case "address": {
      const exact = KY_911_COUNTY_SPELLINGS[canonicalCounty(county) ?? county] ?? [];
      const all = [...new Set([...exact, ...countySpellings(county, true)])];
      return `County IN (${all.map(sqlLit).join(",")})`;
    }
    case "facility":
      return `COUNTY IN (${countySpellings(county, false).map(sqlLit).join(",")})`;
    case "parcel":
      return "CLASS IN ('COMMERCIAL','PUBLIC SERVICE')";
  }
}

// ── County ranking (buildings ≥ n sq ft per county) ─────────────────────────────────────────

/**
 * One request that counts footprints per county: ArcGIS `outStatistics` grouped by FIPS.
 * The build container cannot reach the state server, so the owner runs it in a browser and
 * pastes the JSON into `parseCountyRanking`.
 */
export function countyRankingUrl(layerUrl = KY_FOOTPRINTS_LAYER, minSqFt = 5000): string {
  const p = new URLSearchParams();
  p.set("where", `SQFEET >= ${minSqFt}`);
  p.set(
    "outStatistics",
    JSON.stringify([
      { statisticType: "count", onStatisticField: "BUILD_ID", outStatisticFieldName: "n" },
    ]),
  );
  p.set("groupByFieldsForStatistics", "FIPS");
  p.set("orderByFields", "n DESC");
  p.set("returnGeometry", "false");
  p.set("f", "pjson");
  return `${layerUrl.replace(/\/+$/, "")}/query?${p.toString()}`;
}

export function parseCountyRanking(body: {
  features?: { attributes: Record<string, unknown> }[];
}): { fips: string; county: string | null; count: number }[] {
  return (body.features ?? [])
    .map((f) => {
      const fips = str(f.attributes["FIPS"]) ?? "";
      const count = num(f.attributes["n"] ?? f.attributes["N"] ?? f.attributes["count"]) ?? 0;
      return { fips, county: countyFromFips(fips), count };
    })
    .filter((r) => r.fips)
    .sort((a, b) => b.count - a["count"]);
}

// ── Imagery tile cache ──────────────────────────────────────────────────────────────────────

export interface TileServiceInfo {
  singleFusedMapCache?: boolean;
  tileInfo?: {
    rows?: number;
    cols?: number;
    origin?: { x?: number; y?: number };
    lods?: { level: number; resolution: number }[];
    spatialReference?: { wkid?: number; latestWkid?: number };
  };
  fullExtent?: { xmin: number; ymin: number; xmax: number; ymax: number };
}

const MERCATOR_ORIGIN = 20037508.342787;
const LOD0_RESOLUTION = 156543.03392804097;

/**
 * Is this ArcGIS map service a standard Web Mercator tile cache (so `tile/{z}/{y}/{x}` lines up
 * with the XYZ tiles a web map requests)? Returns the usable zoom range and WGS84 bounds.
 */
export function tileScheme(
  info: TileServiceInfo,
): { minZoom: number; maxZoom: number; bounds: [number, number, number, number] } | null {
  const t = info.tileInfo;
  if (!info.singleFusedMapCache || !t?.lods?.length || !t.origin) return null;
  if (t.rows !== 256 || t.cols !== 256) return null;
  const sr = t.spatialReference?.latestWkid ?? t.spatialReference?.wkid;
  if (sr !== 3857 && sr !== 102100) return null;
  if (
    Math.abs((t.origin.x ?? 0) + MERCATOR_ORIGIN) > 1 ||
    Math.abs((t.origin.y ?? 0) - MERCATOR_ORIGIN) > 1
  ) {
    return null;
  }
  for (const lod of t.lods) {
    const expected = LOD0_RESOLUTION / 2 ** lod.level;
    if (Math.abs(lod.resolution / expected - 1) > 1e-6) return null;
  }
  const levels = t.lods.map((l) => l.level);
  const e = info.fullExtent;
  const bounds: [number, number, number, number] = e
    ? [...mercatorToLngLat([e.xmin, e.ymin]), ...mercatorToLngLat([e.xmax, e.ymax])]
    : [-89.6, 36.4, -81.9, 39.2];
  return { minZoom: Math.min(...levels), maxZoom: Math.max(...levels), bounds };
}

/** The XYZ tile template for an ArcGIS tile cache (ArcGIS orders the path z/y/x). */
export const tileUrlTemplate = (serviceUrl: string): string =>
  `${serviceUrl.replace(/\/+$/, "")}/tile/{z}/{y}/{x}`;

// ── Point-in-polygon (attaching a footprint to a promoted address point) ──────────────────

/** Ray-cast test of [lng, lat] against a GeoJSON Polygon / MultiPolygon (holes respected). */
export function pointInFootprint(
  lng: number,
  lat: number,
  footprint: { type: string; coordinates: unknown } | null | undefined,
): boolean {
  if (!footprint) return false;
  const inRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0]!;
      const yi = ring[i]![1]!;
      const xj = ring[j]![0]!;
      const yj = ring[j]![1]!;
      const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  };
  const inPolygon = (rings: number[][][]) =>
    rings.length > 0 && inRing(rings[0]!) && !rings.slice(1).some((h) => inRing(h));
  if (footprint.type === "Polygon") return inPolygon(footprint.coordinates as number[][][]);
  if (footprint.type === "MultiPolygon") {
    return (footprint.coordinates as number[][][][]).some((poly) => inPolygon(poly));
  }
  return false;
}

/**
 * A spatial query: the footprints that contain any of `points` (WGS84 [lng, lat]), sent as an
 * ArcGIS multipoint so one request covers a whole batch of promoted buildings. POST body, since
 * a few hundred points overflow a URL.
 */
export function footprintsAtPointsRequest(
  layerUrl: string,
  points: [number, number][],
): { url: string; body: URLSearchParams } {
  const body = new URLSearchParams();
  body.set("f", "pjson");
  body.set("where", "1=1");
  body.set("geometry", JSON.stringify({ points, spatialReference: { wkid: 4326 } }));
  body.set("geometryType", "esriGeometryMultipoint");
  body.set("inSR", "4326");
  body.set("spatialRel", "esriSpatialRelIntersects");
  body.set(
    "outFields",
    "BUILD_ID,SQFEET,HEIGHT,FIPS,PROP_ADDR,PROP_CITY,PROP_ZIP,OCC_CLS,PRIM_OCC,LATITUDE,LONGITUDE,UUID",
  );
  body.set("returnGeometry", "true");
  body.set("outSR", "102100");
  return { url: `${layerUrl.replace(/\/+$/, "")}/query`, body };
}

// ── Tap-to-add: the footprint under one point ───────────────────────────────────────────────

/** Query for the footprint(s) containing one WGS84 point. */
export function footprintAtPointUrl(layerUrl: string, lng: number, lat: number): string {
  const p = new URLSearchParams();
  p.set("f", "pjson");
  p.set("where", "1=1");
  p.set("geometry", `${lng},${lat}`);
  p.set("geometryType", "esriGeometryPoint");
  p.set("inSR", "4326");
  p.set("spatialRel", "esriSpatialRelIntersects");
  p.set(
    "outFields",
    "BUILD_ID,SQFEET,HEIGHT,FIPS,PROP_ADDR,PROP_CITY,PROP_ZIP,OCC_CLS,PRIM_OCC,LATITUDE,LONGITUDE,UUID",
  );
  p.set("returnGeometry", "true");
  p.set("outSR", "102100");
  return `${layerUrl.replace(/\/+$/, "")}/query?${p.toString()}`;
}

/**
 * Every building outline in the state, drawn by the state server per map tile (a dynamic
 * ArcGIS "export" with the tile's bounds), so the map shows what is NOT stored yet.
 */
export const footprintOutlineTileUrl = (serviceUrl: string): string =>
  `${serviceUrl.replace(/\/MapServer\/\d+\/?$/, "/MapServer")}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:0&f=image`;
