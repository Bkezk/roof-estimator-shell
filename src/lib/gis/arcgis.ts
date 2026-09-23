/**
 * Kentucky PVA parcel services (ArcGIS REST) → prospecting building candidates. Pure: no I/O.
 *
 * Verified on the owner's Webster County sample (src/lib/gis/fixtures/webster-parcels.json,
 * 2026-09-24): one MapServer per county under
 * `https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/Ky_PVA_<County>_Parcels_WGS84WM/MapServer/<layer>`,
 * polygons in Web Mercator (wkid 102100 / 3857, metres), `AREA` = square feet
 * (= ACRES × 43,560 exactly), `PERIMETER` = feet, `Shape_Area` = Mercator-inflated (ignored),
 * `NAME` = owner of record, `ADDRESS1/2 + CITY/STATE/ZIPCODE` = the OWNER's mailing address,
 * `LOCATION` = the property's own address (sometimes a description), `CLASS` = property class
 * (FARM / RESIDENTIAL / …), `DEED` = deed book-page, `YEAR` = tax year (not year built).
 * Field names differ by county: `guessFieldMap` reads them off the layer's field list.
 *
 * A PARCEL is land, not a roof: its area is the lot, so it fills `lot_sqft`; roof square feet
 * come later from building footprints / imagery.
 */

export interface ArcGisField {
  name: string;
  type: string;
  alias?: string;
}

export interface ArcGisFeature {
  attributes: Record<string, unknown>;
  geometry?: { rings?: number[][][] } | null;
}

export interface ArcGisFeatureSet {
  fields?: ArcGisField[];
  features?: ArcGisFeature[];
  spatialReference?: { wkid?: number; latestWkid?: number };
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string };
}

/** Which attribute carries what, per county layer. */
export interface ParcelFieldMap {
  parcelId: string;
  owner: string;
  ownerAddress1?: string;
  ownerAddress2?: string;
  ownerCity?: string;
  ownerState?: string;
  ownerZip?: string;
  /** The property's own (situs) address, when the county publishes one. */
  location?: string;
  description?: string;
  /** Property class / land use. */
  landUse?: string;
  acres?: string;
  /** Lot area in square feet, when published. */
  areaSqFt?: string;
  /** Lot perimeter in feet, when published. */
  perimeterFt?: string;
  deed?: string;
  taxYear?: string;
}

/** The Webster County layer, as sampled. */
export const WEBSTER_FIELD_MAP: ParcelFieldMap = {
  parcelId: "PARCEL_ID",
  owner: "NAME",
  ownerAddress1: "ADDRESS1",
  ownerAddress2: "ADDRESS2",
  ownerCity: "CITY",
  ownerState: "STATE",
  ownerZip: "ZIPCODE",
  location: "LOCATION",
  description: "DESCRIPTIO",
  landUse: "CLASS",
  acres: "ACRES",
  areaSqFt: "AREA",
  perimeterFt: "PERIMETER",
  deed: "DEED",
  taxYear: "YEAR",
};

const pick = (names: string[], ...candidates: string[]): string | undefined => {
  const upper = new Map(names.map((n) => [n.toUpperCase(), n]));
  for (const c of candidates) {
    const hit = upper.get(c.toUpperCase());
    if (hit) return hit;
  }
  return undefined;
};

/**
 * Best-effort field map from a layer's field list (other counties name things differently).
 * Anything not found is left out; `parcelId` and `owner` fall back to the first plausible names.
 */
export function guessFieldMap(fields: ArcGisField[]): ParcelFieldMap {
  const names = fields.map((f) => f.name);
  const map: ParcelFieldMap = {
    parcelId:
      pick(names, "PARCEL_ID", "PARCELID", "PIN", "PIDN", "MAP_NO", "PARCEL", "AM_NUM") ??
      "PARCEL_ID",
    owner: pick(names, "NAME", "OWNER", "OWNER_NAME", "OWNERNAME", "OWNER1", "DEEDNAME") ?? "NAME",
  };
  const set = (k: keyof ParcelFieldMap, ...c: string[]) => {
    const v = pick(names, ...c);
    if (v) (map as unknown as Record<string, string>)[k] = v;
  };
  set("ownerAddress1", "ADDRESS1", "ADDRESS", "OWNER_ADDR", "MAIL_ADDR", "MAILADDR");
  set("ownerAddress2", "ADDRESS2", "MAIL_ADDR2");
  set("ownerCity", "CITY", "MAIL_CITY", "OWNER_CITY");
  set("ownerState", "STATE", "MAIL_STATE", "OWNER_STATE");
  set("ownerZip", "ZIPCODE", "ZIP", "MAIL_ZIP", "OWNER_ZIP");
  set(
    "location",
    "LOCATION",
    "SITUS",
    "SITUS_ADDR",
    "PROP_ADDR",
    "PROPADDR",
    "PHYS_ADDR",
    "PROPERTY_ADDRESS",
  );
  set("description", "DESCRIPTIO", "DESCRIPTION", "LEGAL", "LEGAL_DESC");
  set("landUse", "CLASS", "LAND_USE", "LANDUSE", "PROP_CLASS", "USE_CODE", "PROPCLASS");
  set("acres", "ACRES", "ACREAGE", "CALC_ACRES", "GIS_ACRES");
  set("areaSqFt", "AREA", "SQFT", "SQ_FT");
  set("perimeterFt", "PERIMETER");
  set("deed", "DEED", "DEED_BOOK", "DEEDBOOK", "DB_PG");
  set("taxYear", "YEAR", "TAX_YEAR");
  return map;
}

const R = 6378137;
/** Web Mercator metres → [lng, lat] degrees. */
export function mercatorToLngLat([x, y]: number[]): [number, number] {
  const lng = ((x ?? 0) / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp((y ?? 0) / R)) - Math.PI / 2) * (180 / Math.PI);
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

/** Shoelace area of a ring in its own units (Mercator m² here). */
function ringArea(ring: number[][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    s += (x1 ?? 0) * (y2 ?? 0) - (x2 ?? 0) * (y1 ?? 0);
  }
  return Math.abs(s) / 2;
}

function ringLength(ring: number[][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    s += Math.hypot((x2 ?? 0) - (x1 ?? 0), (y2 ?? 0) - (y1 ?? 0));
  }
  return s;
}

export interface ParcelGeometry {
  /** GeoJSON Polygon / MultiPolygon in WGS84 (lng, lat). */
  footprint: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
  centroidLat: number;
  centroidLng: number;
  /** True ground area (Mercator area ÷ cos²(lat)) in sq ft — a fallback when the county has none. */
  computedAreaSqFt: number;
  computedPerimeterFt: number;
}

/** Convert Mercator rings to WGS84 GeoJSON with a centroid and ground-corrected measures. */
export function parcelGeometry(rings: number[][][]): ParcelGeometry | null {
  const valid = rings.filter((r) => r.length >= 4);
  if (valid.length === 0) return null;
  const outer = valid.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
  const n = outer.length - 1;
  const cx = outer.slice(0, n).reduce((s, p) => s + (p[0] ?? 0), 0) / n;
  const cy = outer.slice(0, n).reduce((s, p) => s + (p[1] ?? 0), 0) / n;
  const [centroidLng, centroidLat] = mercatorToLngLat([cx, cy]);
  const k = Math.cos((centroidLat * Math.PI) / 180);
  const areaM2 = valid.reduce((s, r) => s + ringArea(r), 0) * k * k;
  const perimM = ringLength(outer) * k;
  const toLngLat = (r: number[][]) => r.map(mercatorToLngLat);
  return {
    footprint:
      valid.length === 1
        ? { type: "Polygon", coordinates: [toLngLat(outer)] }
        : { type: "MultiPolygon", coordinates: valid.map((r) => [toLngLat(r)]) },
    centroidLat,
    centroidLng,
    computedAreaSqFt: Math.round(areaM2 * 10.7639),
    computedPerimeterFt: Math.round(perimM / 0.3048),
  };
}

/** A parcel as the Buildings table wants it (plus the raw class for filtering). */
export interface ParcelCandidate {
  parcelId: string;
  ownerName: string | null;
  ownerAddress: string | null;
  /** The property's own address when published, else null. */
  location: string | null;
  description: string | null;
  landUse: string | null;
  acres: number | null;
  lotSqFt: number | null;
  perimeterFt: number | null;
  deed: string | null;
  taxYear: number | null;
  geometry: ParcelGeometry | null;
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One ArcGIS feature → a candidate, using the county's field map. */
export function parcelFromFeature(f: ArcGisFeature, map: ParcelFieldMap): ParcelCandidate | null {
  const a = f.attributes;
  const parcelId = str(a[map.parcelId]);
  if (!parcelId) return null;
  const geometry = f.geometry?.rings ? parcelGeometry(f.geometry.rings) : null;
  const acres = map.acres ? num(a[map.acres]) : null;
  const areaField = map.areaSqFt ? num(a[map.areaSqFt]) : null;
  const lotSqFt =
    areaField && areaField > 0
      ? Math.round(areaField)
      : acres && acres > 0
        ? Math.round(acres * 43560)
        : (geometry?.computedAreaSqFt ?? null);
  const perimField = map.perimeterFt ? num(a[map.perimeterFt]) : null;
  const perimeterFt =
    perimField && perimField > 0 ? Math.round(perimField) : (geometry?.computedPerimeterFt ?? null);
  const ownerAddress = [
    [
      str(map.ownerAddress1 ? a[map.ownerAddress1] : null),
      str(map.ownerAddress2 ? a[map.ownerAddress2] : null),
    ]
      .filter(Boolean)
      .join(" "),
    [
      str(map.ownerCity ? a[map.ownerCity] : null),
      [str(map.ownerState ? a[map.ownerState] : null), str(map.ownerZip ? a[map.ownerZip] : null)]
        .filter(Boolean)
        .join(" "),
    ]
      .filter(Boolean)
      .join(", "),
  ]
    .filter((x) => x && x.trim())
    .join(", ");
  const taxYear = map.taxYear ? num(a[map.taxYear]) : null;
  return {
    parcelId,
    ownerName: str(a[map.owner]),
    ownerAddress: ownerAddress || null,
    location: map.location ? str(a[map.location]) : null,
    description: map.description ? str(a[map.description]) : null,
    landUse: map.landUse ? str(a[map.landUse]) : null,
    acres,
    lotSqFt,
    perimeterFt,
    deed: map.deed ? str(a[map.deed]) : null,
    taxYear: taxYear !== null ? Math.round(taxYear) : null,
    geometry,
  };
}

/** Does the situs `location` look like a street address (starts with a house number)? */
export const looksLikeAddress = (s: string | null | undefined): boolean =>
  !!s && /^\d+[A-Z]?\s+\S/.test(s.trim());

/** The layer's `/query` URL for one page of results (count-only when `countOnly`). */
export function parcelQueryUrl(
  layerUrl: string,
  opts: { where: string; offset?: number; count?: number; countOnly?: boolean; geometry?: boolean },
): string {
  const base = layerUrl.replace(/\/+$/, "");
  const p = new URLSearchParams();
  p.set("where", opts.where.trim() || "1=1");
  p.set("f", "pjson");
  if (opts.countOnly) {
    p.set("returnCountOnly", "true");
  } else {
    p.set("outFields", "*");
    p.set("returnGeometry", opts.geometry === false ? "false" : "true");
    p.set("outSR", "102100");
    p.set("resultOffset", String(opts.offset ?? 0));
    p.set("resultRecordCount", String(opts.count ?? 500));
    p.set("orderByFields", "OBJECTID");
  }
  return `${base}/query?${p.toString()}`;
}

/** The layer's metadata URL (fields, maxRecordCount, extent). */
export const layerInfoUrl = (layerUrl: string): string => `${layerUrl.replace(/\/+$/, "")}?f=pjson`;

/** "Ky_PVA_Webster_Parcels_WGS84WM" → "Webster". */
export function countyFromServiceUrl(url: string): string | null {
  const m = /Ky_PVA_([A-Za-z]+)_Parcels/i.exec(url);
  return m?.[1] ?? null;
}
