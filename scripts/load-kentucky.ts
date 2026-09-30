/**
 * Statewide loader — the same county pipeline the Buildings page runs, for all 120 counties,
 * from a machine that can reach the state server (GitHub Actions monthly, or a laptop):
 *
 *   npx vite-node scripts/load-kentucky.ts --county Hardin
 *   npx vite-node scripts/load-kentucky.ts --all [--min-sqft 5000] [--skip-footprints] [--trim] [--shard 1/2] [--skip-fresh 2]
 *   npx vite-node scripts/load-kentucky.ts --all --approx-only      (backfill approximate addresses)
 *   npx vite-node scripts/load-kentucky.ts --all --from Fleming     (resume a pass at a county)
 *   npx vite-node scripts/load-kentucky.ts --dry-run --county Graves (no database; prints the match)
 *
 * Signs in as a Prospecting login: LOADER_EMAIL and LOADER_PASSWORD in the environment (GitHub
 * secrets; never in the repo). The project URL and public key are read from the committed .env.
 * Per county: footprints of the size floor → every 911 address point, matched to the buildings
 * IN MEMORY (only linked and business points reach the database) → promote business points
 * with no building → attach their outlines → schools → log the refresh. Nothing a person typed
 * is overwritten (upsert_buildings). Footprints are a one-time survey, so --skip-footprints
 * makes the monthly run refresh addresses and facilities only; --trim deletes a county's
 * leftover house points (cleanup after the first statewide runs).
 *
 * Approximate addresses (owner, Sep 29): after the exact match, the outlines still without an
 * address take the nearest 911 point within 300 m when the next-nearest address is at least
 * twice as far, stored flagged (buildings.address_approx, src/lib/gis/approx-address.ts).
 * --no-approx skips that pass; --approx-only runs only that pass (for counties already loaded:
 * no footprints, no points stored, no promotion, no schools, no data_refreshes row).
 * --dry-run --county X touches no database at all: it reads the county's footprints and 911
 * points from the public state layers, runs both passes in memory and prints the counts and a
 * sample of the approximate matches, so the rules can be eyeballed before a statewide run.
 */
import { createClient } from "@supabase/supabase-js";

import type { Database, Json } from "../src/integrations/supabase/types";
import { parcelQueryUrl, type ArcGisFeatureSet } from "../src/lib/gis/arcgis";
import {
  APPROX_SEARCH_M,
  Grid,
  approxMatch,
  exactRadiusM,
  metres,
  type ApproxOutcome,
} from "../src/lib/gis/approx-address";
import {
  KY_ADDRESS_POINTS_LAYER,
  KY_COUNTIES,
  KY_FOOTPRINTS_LAYER,
  KY_SCHOOLS_LAYER,
  addressPointFromFeature,
  classifyPlace,
  countyWhere,
  facilityFromFeature,
  footprintFromFeature,
  footprintsAtPointsRequest,
  guessFacilityFieldMap,
  layerShortName,
  pointInFootprint,
} from "../src/lib/gis/ky-layers";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = args.includes("--all");
const only = flag("--county");
// --from Fleming: with --all, start at that county (resume a pass that stopped part way).
const fromCounty = flag("--from");
const minSqFt = Number(flag("--min-sqft") ?? 5000);
const skipFootprints = args.includes("--skip-footprints");
const trim = args.includes("--trim");
const dryRun = args.includes("--dry-run");
const approxOnly = args.includes("--approx-only");
const noApprox = args.includes("--no-approx");
if (approxOnly && noApprox) {
  console.error("--approx-only and --no-approx contradict each other");
  process.exit(2);
}
if (dryRun && !only) {
  console.error("--dry-run needs --county <Name> (one county)");
  process.exit(2);
}
// --skip-fresh 2: leave out counties that already have a data_refreshes row from the last N
// days, so a pass that was cancelled part-way (the database starves when the app and the
// loader share the small instance) can be resumed without redoing the finished counties.
const skipFreshDays = Number(flag("--skip-fresh") ?? 0);
// --shard 2/2: this run takes every other county starting at the 2nd (GitHub runs shards in
// parallel so the whole state fits inside one job's time limit).
const shard = (() => {
  const m = /^(\d+)\/(\d+)$/.exec(flag("--shard") ?? "");
  return m ? { i: Number(m[1]) - 1, n: Number(m[2]) } : null;
})();
const pageSize = 500;
// The approximate pass runs unless --no-approx, or unless the database lacks the migration that
// stores the flag (main() checks; writing a guess without its flag would pass it off as exact).
let runApprox = !noApprox;
let approxSkippedNoMigration = false;

// Connection: the project URL and PUBLIC key come from the committed .env (they are public by
// design; the app ships them to every browser). Writes need a signed-in user with Prospecting
// access: LOADER_EMAIL / LOADER_PASSWORD (a dedicated login made in Users & access). A
// SUPABASE_SERVICE_ROLE_KEY still works when one is at hand.
import { readFileSync } from "node:fs";
const dotenv = (() => {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
      if (m) out[m[1]!] = m[2]!;
    }
  } catch {
    /* no .env */
  }
  return out;
})();
const url = process.env["SUPABASE_URL"] ?? dotenv["SUPABASE_URL"] ?? dotenv["VITE_SUPABASE_URL"];
const publicKey =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  dotenv["SUPABASE_PUBLISHABLE_KEY"] ??
  dotenv["VITE_SUPABASE_PUBLISHABLE_KEY"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const email = process.env["LOADER_EMAIL"];
const password = process.env["LOADER_PASSWORD"];
if (!dryRun && (!url || !(serviceKey || (publicKey && email && password)))) {
  console.error(
    "Need SUPABASE_URL (or .env) and either LOADER_EMAIL + LOADER_PASSWORD (a Prospecting login) or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(2);
}
// A dry run must never reach the real project: its client points at a host that does not exist
// (and the dry-run path makes no database call at all).
const sb = dryRun
  ? createClient<Database>("https://dry-run.invalid", "dry-run", {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : createClient<Database>(url!, serviceKey ?? publicKey!, {
      auth: { persistSession: false, autoRefreshToken: true },
    });

import { parseLooseJson } from "../src/lib/loose-json";

/** One request may take this long, headers and body together, before it is abandoned. */
const FETCH_TIMEOUT_MS = 90_000;

async function fetchJson(u: string, body?: URLSearchParams, tries = 3): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    // An AbortController with an ordinary timer: run 14 (Sep 30) sat on one Fleming page for
    // three hours with AbortSignal.timeout() in place, so the timer here is one the event loop
    // keeps, and it covers reading the body as well as the headers.
    const ctl = new AbortController();
    const timer = setTimeout(
      () => ctl.abort(new Error(`no answer in ${FETCH_TIMEOUT_MS / 1000} s`)),
      FETCH_TIMEOUT_MS,
    );
    try {
      const res = await fetch(u, {
        method: body ? "POST" : "GET",
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(body ? { body: body.toString() } : {}),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = parseLooseJson(await res.text()) as { error?: { message?: string } };
      if (json && typeof json === "object" && json.error) {
        throw new Error(json.error.message ?? "ArcGIS error");
      }
      return json;
    } catch (e) {
      const msg =
        e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      if (attempt >= tries) throw new Error(`${msg} (${tries} tries: ${u.slice(0, 120)}…)`);
      console.error(`  retry ${attempt}/${tries - 1} after: ${msg}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * A county that prints nothing for this long is stuck (a request the timeout somehow missed, or
 * a server answering a byte at a time): it is failed and the run moves to the next county, so
 * one county cannot hold the whole pass (run 14 sat on Fleming for three hours).
 */
const STALL_MS = 10 * 60_000;
let lastOutputAt = Date.now();
{
  const w = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    lastOutputAt = Date.now();
    return (w as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
}
/** Run `work`, but give up when nothing has been printed for STALL_MS. */
async function withStallWatch<T>(work: Promise<T>, what: string): Promise<T> {
  lastOutputAt = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const watch = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      if (Date.now() - lastOutputAt > STALL_MS)
        reject(new Error(`${what}: no progress for ${STALL_MS / 60_000} minutes`));
    }, 15_000);
  });
  try {
    return await Promise.race([work, watch]);
  } finally {
    if (timer) clearInterval(timer);
  }
}

/**
 * Run a chunked database step (fill / promote / trim) until a call comes back short. The API
 * role's statement timeout is 30 s; when a chunk hits it, the chunk is halved and retried
 * rather than failing the county (the first statewide run lost every county this way).
 */
async function chunked(
  name: string,
  params: Record<string, unknown>,
  limit: number,
  progress?: (total: number) => void,
): Promise<number> {
  let total = 0;
  let size = limit;
  for (;;) {
    let n: number;
    try {
      n = await rpc<number>(name, { ...params, p_limit: size });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/statement timeout/i.test(msg) && size > 25) {
        size = Math.max(25, Math.floor(size / 2));
        console.log(`\n${name}: timed out, retrying ${size} at a time`);
        continue;
      }
      throw e;
    }
    total += n;
    progress?.(total);
    if (n < size) return total;
  }
}

/** Every feature matching `where`, page by page. */
async function* pages(layerUrl: string, where: string) {
  for (let offset = 0; ; offset += pageSize) {
    const page = (await fetchJson(
      parcelQueryUrl(layerUrl, { where, offset, count: pageSize }),
    )) as ArcGisFeatureSet;
    const feats = page.features ?? [];
    if (feats.length > 0) yield feats;
    if (feats.length < pageSize || !page.exceededTransferLimit) return;
  }
}

const rpc = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  // The Database type knows these functions; a loose call keeps the script short.
  const { data, error } = await (
    sb.rpc as unknown as (
      n: string,
      p: Record<string, unknown>,
    ) => Promise<{ data: T; error: { message: string } | null }>
  )(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
};

interface CountyBuilding {
  id: string;
  lat: number;
  lng: number;
  roofSqFt: number | null;
  /** A footprint or promoted point with no address yet: the matcher's target. */
  needsAddress: boolean;
}

interface KeptPoint {
  key: string;
  address: string;
  city: string | null;
  zip: string | null;
  county: string | null;
  landmark: string | null;
  placeType: string | null;
  lat: number;
  lng: number;
  kind: ReturnType<typeof classifyPlace>;
  buildingId: string | null;
}

/** The county's stored buildings with a location (one read, paged). */
async function countyBuildings(county: string): Promise<CountyBuilding[]> {
  const out: CountyBuilding[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("buildings")
      .select("id, centroid_lat, centroid_lng, roof_sqft, address1, source")
      .eq("county", county)
      .is("deleted_at", null)
      .not("centroid_lat", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      out.push({
        id: r.id,
        lat: r.centroid_lat!,
        lng: r.centroid_lng!,
        roofSqFt: r.roof_sqft,
        needsAddress: (r.address1 ?? "") === "" && (r.source === "ornl" || r.source === "ky911"),
      });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Counties with a data_refreshes row newer than `days` days (any pass, hand or scheduled). */
async function recentlyRefreshed(days: number): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const out = new Set<string>();
  // PostgREST pages at 1,000 rows; the table holds one row per county per pass.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("data_refreshes")
      .select("county")
      .gte("ran_at", since)
      .range(from, from + 999);
    if (error) throw new Error(`data_refreshes: ${error.message}`);
    for (const r of data ?? []) out.add(r.county);
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * The county's 911 points worth holding in memory: what reads as a business, what sits near a
 * stored building (the exact match and the link), and — for the approximate pass — every usable
 * point within 600 m of a building still without an address (rule 2 needs the second-nearest).
 * Only the linked and business points ever reach the database.
 */
async function countyPoints(
  county: string,
  blds: CountyBuilding[],
  bGrid: Grid,
  withApprox: boolean,
): Promise<KeptPoint[]> {
  const needGrid = new Grid();
  if (withApprox) blds.forEach((b, i) => b.needsAddress && needGrid.add(b.lat, b.lng, i));
  const kept: KeptPoint[] = [];
  let seen = 0;
  for await (const feats of pages(KY_ADDRESS_POINTS_LAYER, countyWhere("address", county))) {
    seen += feats.length;
    for (const f of feats) {
      const c = addressPointFromFeature(f);
      if (!c) continue;
      const kind = classifyPlace(c.placeType, c.landmark);
      // Some counties type every point ("RESIDENTIAL" on each house), so the type alone is not
      // a reason to keep it: keep what reads commercial, or sits near a stored building.
      if (
        kind === "commercial" ||
        bGrid.around(c.lat, c.lng).length > 0 ||
        (withApprox &&
          kind !== "other" &&
          // 1 % slack: the grid is measured from the point, the distance from the building.
          needGrid.within(c.lat, c.lng, APPROX_SEARCH_M * 1.01).length > 0)
      )
        kept.push({ ...c, kind, buildingId: null });
    }
    process.stdout.write(`\r[${county}] address points kept ${kept.length} of ${seen}`);
  }
  console.log("");
  return kept;
}

/** One row for apply_building_addresses. */
interface AddressRow {
  id: string;
  address: string;
  city: string | null;
  zip: string | null;
  landmark: string | null;
  kind: KeptPoint["kind"];
  place_type: string | null;
  approx: boolean;
  approx_m: number | null;
}

/**
 * Exact match: for each building without an address, the nearest point (not "other") inside
 * max(100 m, √roof area) — the same rule as fill_footprint_addresses. Links the point to the
 * first building it addresses (kept[].buildingId), which decides what is stored and promoted.
 */
function exactPass(
  blds: CountyBuilding[],
  kept: KeptPoint[],
): { rows: AddressRow[]; matched: Set<string> } {
  const pGrid = new Grid();
  kept.forEach((k, i) => {
    if (k.kind !== "other") pGrid.add(k.lat, k.lng, i);
  });
  const rows: AddressRow[] = [];
  const matched = new Set<string>();
  for (const b of blds) {
    if (!b.needsAddress) continue;
    const radius = exactRadiusM(b.roofSqFt);
    let best: KeptPoint | null = null;
    let bestD = Infinity;
    for (const i of pGrid.around(b.lat, b.lng)) {
      const k = kept[i]!;
      const d = metres(b.lat, b.lng, k.lat, k.lng);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (!best || bestD > radius) continue;
    if (!best.buildingId) best.buildingId = b.id;
    matched.add(b.id);
    rows.push({
      id: b.id,
      address: best.address,
      city: best.city,
      zip: best.zip,
      landmark: best.landmark,
      kind: best.kind,
      place_type: best.placeType,
      approx: false,
      approx_m: null,
    });
  }
  return { rows, matched };
}

interface ApproxPassResult {
  rows: AddressRow[];
  contested: number;
  none: number;
  /** Every building the pass looked at, with what the rules said (the dry run prints these). */
  results: { b: CountyBuilding; r: ApproxOutcome<KeptPoint> }[];
}

/**
 * Approximate match (owner's rules, Sep 29; src/lib/gis/approx-address.ts) for the outlines
 * the exact pass left blank. The same address assembly and landmark handling as the exact
 * pass, but the point is not linked (nothing is stored or promoted from a guess) and its place
 * type is not sent (it describes the addressed structure, not this building).
 */
function approxPass(
  blds: CountyBuilding[],
  kept: KeptPoint[],
  matched: Set<string>,
): ApproxPassResult {
  const grid = new Grid();
  kept.forEach((k, i) => {
    if (k.kind !== "other") grid.add(k.lat, k.lng, i);
  });
  const out: ApproxPassResult = { rows: [], contested: 0, none: 0, results: [] };
  for (const b of blds) {
    if (!b.needsAddress || matched.has(b.id)) continue;
    const r = approxMatch(
      b,
      grid.within(b.lat, b.lng, APPROX_SEARCH_M).map((i) => kept[i]!),
    );
    out.results.push({ b, r });
    if (r.outcome === "contested") out.contested++;
    else if (r.outcome === "none") out.none++;
    else {
      out.rows.push({
        id: b.id,
        address: r.point.address,
        city: r.point.city,
        zip: r.point.zip,
        landmark: r.point.landmark,
        kind: r.point.kind,
        place_type: null,
        approx: true,
        approx_m: Math.round(r.distanceM),
      });
    }
  }
  return out;
}

/** apply_building_addresses in batches of 200; fills only buildings still without an address. */
async function writeAddresses(county: string, rows: AddressRow[], what: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    n += await rpc<number>("apply_building_addresses", {
      rows: rows.slice(i, i + 200) as unknown as Json,
    });
    process.stdout.write(`\r[${county}] ${what} written ${n} of ${rows.length}`);
  }
  if (rows.length > 0) console.log("");
  return n;
}

async function loadCounty(county: string) {
  const t0 = Date.now();
  const log = (m: string) => console.log(`[${county}] ${m}`);
  let buildings = 0;
  if (!skipFootprints && !approxOnly) {
    for await (const feats of pages(
      KY_FOOTPRINTS_LAYER,
      countyWhere("footprint", county, minSqFt),
    )) {
      const rows = feats
        .map(footprintFromFeature)
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .map((c) => ({
          source_key: `ornl:${c.buildId}`,
          source: "ornl",
          county: c.county ?? county,
          name: c.primaryOccupancy ?? "",
          address1: c.address ?? "",
          city: c.city,
          zip: c.zip,
          land_use: c.occupancyClass,
          roof_sqft: c.roofSqFt,
          perimeter_ft: c.geometry?.computedPerimeterFt ?? null,
          height_ft: c.heightFt,
          footprint: c.geometry?.footprint ?? null,
          centroid_lat: c.lat,
          centroid_lng: c.lng,
          source_layer: KY_FOOTPRINTS_LAYER,
          created_by: null,
          created_by_name: "scheduled load",
        }));
      for (let i = 0; i < rows.length; i += 200) {
        buildings += await rpc<number>("upsert_buildings", {
          rows: rows.slice(i, i + 200) as unknown as Json,
        });
      }
      process.stdout.write(`\r[${county}] footprints ${buildings}`);
    }
    console.log("");
  }
  // Address points. The state has 2.5 million and 85 % are houses nowhere near a prospect,
  // so the matching happens HERE, in memory, against the county's buildings, and the database
  // only ever sees the results: the points that matched a building (linked) or read as a
  // business, one batched address update, and the promoted businesses. Runs 5–7 did the
  // matching in the database and starved the small instance (docs/TODO.md item 3).
  const blds = await countyBuildings(county);
  const bGrid = new Grid();
  blds.forEach((b, i) => bGrid.add(b.lat, b.lng, i));
  const kept = await countyPoints(county, blds, bGrid, runApprox);
  const exact = exactPass(blds, kept);
  let addressed = 0;
  if (!approxOnly) addressed = await writeAddresses(county, exact.rows, "addresses");
  // Approximate pass (owner, Sep 29): the outlines the exact match left blank. Nothing is
  // linked, stored or promoted from it, and it never sets land use.
  let approximate = 0;
  if (runApprox) {
    const ap = approxPass(blds, kept, exact.matched);
    approximate = await writeAddresses(county, ap.rows, "approximate addresses");
    log(
      `approximate pass: ${ap.rows.length} matched, ${ap.contested} left blank (another address less than twice as far), ${ap.none} left blank (no address point within 300 m)`,
    );
  }
  log(`addresses matched: ${addressed} addresses, ${approximate} approximate`);
  if (approxOnly) {
    if (exact.rows.length > 0) {
      log(
        `${exact.rows.length} buildings have an exact match waiting (not written by --approx-only; the next full run writes them)`,
      );
    }
    log(
      `done (approximate pass only): ${approximate} approximate, ${Math.round((Date.now() - t0) / 1000)} s`,
    );
    return;
  }
  // Store only the points that matter: linked to a building, or a business.
  const toStore = kept.filter((k) => k.buildingId || k.kind === "commercial");
  let points = 0;
  for (let i = 0; i < toStore.length; i += 200) {
    const rows = toStore.slice(i, i + 200).map((c) => ({
      source_key: `ky911:${c.key}`,
      county: c.county ?? county,
      address: c.address,
      city: c.city,
      zip: c.zip,
      landmark: c.landmark,
      place_type: c.placeType,
      lat: c.lat,
      lng: c.lng,
      building_id: c.buildingId,
      source_layer: KY_ADDRESS_POINTS_LAYER,
      imported_at: new Date().toISOString(),
    }));
    const { error } = await sb
      .from("address_points")
      .upsert(rows, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) throw new Error(error.message);
    points += rows.length;
    process.stdout.write(`\r[${county}] points stored ${points} of ${toStore.length}`);
  }
  console.log("");
  // Promote: a business point with no stored building inside its radius becomes a building
  // (source ky911, idempotent on source_key — the same rule as promote_commercial_points).
  const promoteRows: Array<Record<string, unknown>> = [];
  for (const k of kept) {
    if (k.kind !== "commercial" || k.buildingId) continue;
    let covered = false;
    for (const i of bGrid.around(k.lat, k.lng)) {
      const b = blds[i]!;
      const radius = Math.max(100, Math.sqrt((b.roofSqFt ?? 0) * 0.092903));
      if (metres(k.lat, k.lng, b.lat, b.lng) <= radius) {
        covered = true;
        break;
      }
    }
    if (covered) continue;
    promoteRows.push({
      source_key: `ky911:${k.key}`,
      source: "ky911",
      county: k.county ?? county,
      name: k.landmark ?? "",
      address1: k.address,
      city: k.city,
      zip: k.zip,
      land_use: k.placeType,
      roof_sqft: null,
      perimeter_ft: null,
      height_ft: null,
      footprint: null,
      centroid_lat: k.lat,
      centroid_lng: k.lng,
      source_layer: KY_ADDRESS_POINTS_LAYER,
      created_by: null,
      created_by_name: "scheduled load",
    });
  }
  let promoted = 0;
  for (let i = 0; i < promoteRows.length; i += 200) {
    promoted += await rpc<number>("upsert_buildings", {
      rows: promoteRows.slice(i, i + 200) as unknown as Json,
    });
  }
  log(`named businesses added: ${promoted}`);
  // Outlines for the promoted buildings: one multipoint request per 150.
  let attached = 0;
  for (;;) {
    const { data: pending, error } = await sb
      .from("buildings")
      .select("id, centroid_lat, centroid_lng")
      .eq("county", county)
      .eq("source", "ky911")
      .is("deleted_at", null)
      .is("roof_sqft", null)
      .not("centroid_lat", "is", null)
      .order("id")
      .limit(150);
    if (error) throw new Error(error.message);
    if (!pending || pending.length === 0) break;
    const req = footprintsAtPointsRequest(
      KY_FOOTPRINTS_LAYER,
      pending.map((r) => [r.centroid_lng!, r.centroid_lat!] as [number, number]),
    );
    const page = (await fetchJson(req.url, req.body)) as ArcGisFeatureSet;
    const polys = (page.features ?? [])
      .map(footprintFromFeature)
      .filter((c): c is NonNullable<typeof c> => c !== null && c.geometry !== null);
    const unmatched: string[] = [];
    for (const r of pending) {
      const hit = polys.find((c) =>
        pointInFootprint(r.centroid_lng!, r.centroid_lat!, c.geometry!.footprint),
      );
      if (!hit) {
        unmatched.push(r.id);
        continue;
      }
      const { error: uErr } = await sb
        .from("buildings")
        .update({
          roof_sqft: hit.roofSqFt,
          perimeter_ft: hit.geometry!.computedPerimeterFt,
          height_ft: hit.heightFt,
          footprint: hit.geometry!.footprint as unknown as Json,
        })
        .eq("id", r.id);
      if (uErr) throw new Error(uErr.message);
      attached++;
    }
    if (unmatched.length > 0) {
      const { error: zErr } = await sb
        .from("buildings")
        .update({ roof_sqft: 0 })
        .in("id", unmatched);
      if (zErr) throw new Error(zErr.message);
    }
    process.stdout.write(`\r[${county}] outlines attached ${attached}`);
  }
  console.log("");
  // Facilities (schools; add more layers here as their samples are verified).
  let facilities = 0;
  const schoolFields = (await fetchJson(`${KY_SCHOOLS_LAYER}?f=pjson`)) as {
    fields?: { name: string; type: string }[];
  };
  const fmap = guessFacilityFieldMap(schoolFields.fields ?? []);
  for await (const feats of pages(KY_SCHOOLS_LAYER, countyWhere("facility", county))) {
    const rows = feats
      .map((f) => facilityFromFeature(f, fmap))
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({
        source_key: `${layerShortName(KY_SCHOOLS_LAYER)}:${c.key}`,
        source: "facility",
        county: c.county ?? county,
        name: c.name,
        address1: c.address ?? "",
        city: c.city,
        zip: c.zip,
        land_use: c.kind,
        roof_sqft: null,
        perimeter_ft: null,
        height_ft: null,
        footprint: null,
        centroid_lat: c.lat,
        centroid_lng: c.lng,
        source_layer: KY_SCHOOLS_LAYER,
        created_by: null,
        created_by_name: "scheduled load",
      }));
    if (rows.length > 0)
      facilities += await rpc<number>("upsert_buildings", { rows: rows as unknown as Json });
  }
  // Nothing junk is stored any more, so trimming is only for cleaning up after the first
  // statewide runs (--trim): deletes the county's unlinked house points in chunks.
  let trimmed = 0;
  if (trim) {
    trimmed = await chunked("trim_address_points", { p_county: county }, 5000, (n) =>
      process.stdout.write(`\r[${county}] trimming house points… ${n}`),
    );
    console.log("");
  }
  const { error: rErr } = await sb.from("data_refreshes").insert({
    county,
    ran_by: "scheduled",
    buildings,
    addressed,
    promoted,
    points_kept: points,
    facilities,
    notes: `${approximate} approximate addresses; ${attached} named businesses given an outline; ${Math.round((Date.now() - t0) / 1000)} s`,
  });
  if (rErr) throw new Error(rErr.message);
  log(
    `done: ${buildings} buildings by size, ${promoted} named businesses (${attached} with outlines), ${addressed} addresses, ${approximate} approximate, ${facilities} schools, ${points} points kept${trimmed ? `, ${trimmed} house points trimmed` : ""}, ${Math.round((Date.now() - t0) / 1000)} s`,
  );
}

/**
 * Sign in as the loader login. supabase-js refreshes an expired token only on the next request,
 * and outside a browser it never starts the proactive refresh ticker on its own — run 6 lost its
 * session an hour in, after which every insert was rejected by row-level security as anonymous.
 * So: start the ticker, and re-sign in whenever a county fails on an auth / RLS error.
 */
async function signIn(): Promise<void> {
  if (serviceKey) return;
  // The auth gateway answers "Gateway Timeout" while the database instance is catching its
  // breath after a heavy run (run 8 died on its very first request), so try for a few minutes.
  for (let attempt = 1; ; attempt++) {
    const { error } = await sb.auth.signInWithPassword({ email: email!, password: password! });
    if (!error) break;
    if (attempt >= 6) throw new Error(`Could not sign in as ${email}: ${error.message}`);
    console.log(`sign-in failed (${error.message}); retrying in ${attempt * 30} s`);
    await new Promise((r) => setTimeout(r, attempt * 30_000));
  }
  await sb.auth.startAutoRefresh();
}

const isAuthError = (msg: string) =>
  /row-level security|jwt|token|401|not authenticated|expired/i.test(msg);

/**
 * Is the approximate-address migration (20260930040000_address_approx.sql) applied? Without it
 * apply_building_addresses would drop the `approx` field and store a guess as an exact address.
 */
async function approxColumnPresent(): Promise<boolean> {
  const { error } = await sb.from("buildings").select("address_approx").limit(1);
  if (!error) return true;
  if (/address_approx/i.test(error.message)) return false;
  throw new Error(`checking for buildings.address_approx: ${error.message}`);
}

/**
 * --dry-run: no database. The county's footprints (the loader's own query and size floor) and
 * 911 points come from the public state layers; both passes run in memory exactly as in a load
 * (every outline counts as unaddressed, as a fresh load would see it) and the result is printed.
 */
async function dryRunCounty(county: string) {
  const t0 = Date.now();
  const blds: CountyBuilding[] = [];
  for await (const feats of pages(KY_FOOTPRINTS_LAYER, countyWhere("footprint", county, minSqFt))) {
    for (const f of feats) {
      const c = footprintFromFeature(f);
      if (!c || c.lat === null || c.lng === null) continue;
      blds.push({
        id: c.buildId,
        lat: c.lat,
        lng: c.lng,
        roofSqFt: c.roofSqFt,
        needsAddress: !c.address,
      });
    }
    process.stdout.write(`\r[${county}] outlines ${blds.length}`);
  }
  console.log("");
  const bGrid = new Grid();
  blds.forEach((b, i) => bGrid.add(b.lat, b.lng, i));
  const kept = await countyPoints(county, blds, bGrid, true);
  const exact = exactPass(blds, kept);
  const ap = approxPass(blds, kept, exact.matched);
  const approx = ap.results.filter(
    (x): x is { b: CountyBuilding; r: Extract<ApproxOutcome<KeptPoint>, { outcome: "approx" }> } =>
      x.r.outcome === "approx",
  );
  const contested = ap.results.filter(
    (
      x,
    ): x is {
      b: CountyBuilding;
      r: Extract<ApproxOutcome<KeptPoint>, { outcome: "contested" }>;
    } => x.r.outcome === "contested",
  );
  const needing = blds.filter((b) => b.needsAddress).length;
  const pct = (n: number) => `${((100 * n) / Math.max(1, blds.length)).toFixed(1)} %`;
  const m = (d: number | null) => (d === null ? "none ≤ 600 m" : `${Math.round(d)} m`);
  // Same-address second points that rule 2 does not count as contenders.
  const sameAddr = approx.filter(
    (x) => x.r.strictNextM !== null && x.r.strictNextM < 2 * x.r.distanceM,
  ).length;
  console.log(`\n=== ${county} County dry run (footprints >= ${minSqFt} sq ft; no database) ===`);
  console.log(`outlines:                                   ${blds.length}`);
  console.log(`  without an address in the footprint layer: ${needing}`);
  console.log(
    `exact matches (100 m / roof size):          ${exact.rows.length} (${pct(exact.rows.length)})`,
  );
  console.log(
    `left without an address after exact:        ${ap.results.length} (${pct(ap.results.length)})`,
  );
  console.log(
    `approximate matches (rules 1–3):            ${approx.length} (${pct(approx.length)})`,
  );
  console.log(`  of which a second point with the SAME address lay < 2× away: ${sameAddr}`);
  console.log(`left blank, rule 2 (two close contenders):  ${ap.contested}`);
  console.log(`left blank, nothing within 300 m:           ${ap.none}`);
  // How close rule 2 came: next-nearest ÷ nearest for the contested ones (for the owner's eye).
  const ratios = contested.map((x) => x.r.nextM / Math.max(1e-9, x.r.distanceM));
  console.log(
    `  rule 2 blanks by next ÷ nearest: < 1.25×: ${ratios.filter((q) => q < 1.25).length}, 1.25–1.5×: ${ratios.filter((q) => q >= 1.25 && q < 1.5).length}, 1.5–2×: ${ratios.filter((q) => q >= 1.5).length}`,
  );
  console.log(`address points read / kept in memory:       ${kept.length} kept`);
  const bands = [100, 150, 200, 250, 300];
  const band = (lo: number, hi: number) =>
    approx.filter((x) => x.r.distanceM > lo && x.r.distanceM <= hi).length;
  console.log(
    `approximate distances: ${[[0, 100], ...bands.slice(0, -1).map((lo, i) => [lo, bands[i + 1]!])]
      .map(([lo, hi]) => `${lo}–${hi} m: ${band(lo!, hi!)}`)
      .join(", ")}`,
  );
  const sample = <T>(xs: T[], n: number): T[] =>
    xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]!);
  console.log(`\nSample of ${Math.min(20, approx.length)} approximate matches (evenly spread):`);
  for (const { b, r } of sample(approx, 20)) {
    const p = r.point;
    console.log(
      `  ${(b.roofSqFt ?? 0).toLocaleString().padStart(7)} sq ft  ${b.lat.toFixed(5)},${b.lng.toFixed(5)}  ≈ ${p.address}${p.city ? `, ${p.city}` : ""}  ${Math.round(r.distanceM)} m; next address ${m(r.nextM)}${r.strictNextM !== null && r.strictNextM !== r.nextM ? ` (same-address point ${Math.round(r.strictNextM)} m)` : ""}${p.placeType || p.landmark ? `  [${[p.placeType, p.landmark].filter(Boolean).join(" / ")}]` : ""}`,
    );
  }
  console.log(`\nSample of ${Math.min(5, contested.length)} left blank by rule 2:`);
  for (const { b, r } of sample(contested, 5)) {
    console.log(
      `  ${(b.roofSqFt ?? 0).toLocaleString().padStart(7)} sq ft  ${b.lat.toFixed(5)},${b.lng.toFixed(5)}  ${r.point.address} ${Math.round(r.distanceM)} m vs ${r.next.address} ${Math.round(r.nextM)} m`,
    );
  }
  console.log(`\n${Math.round((Date.now() - t0) / 1000)} s`);
}

async function main() {
  if (dryRun) {
    await dryRunCounty(only!);
    return;
  }
  try {
    await signIn();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  if (runApprox && !(await approxColumnPresent())) {
    const msg =
      "APPROXIMATE ADDRESSES SKIPPED: buildings.address_approx is missing — apply supabase/migrations/20260930040000_address_approx.sql (while no load is running), then rerun with --approx-only.";
    if (approxOnly) {
      console.error(`::error::${msg}`);
      process.exit(1);
    }
    console.error(`::warning::${msg}`);
    runApprox = false;
    approxSkippedNoMigration = true;
  }
  let counties = only ? [only] : all ? [...KY_COUNTIES] : [];
  if (fromCounty && !only) {
    const at = counties.findIndex((c) => c.toLowerCase() === fromCounty.toLowerCase());
    if (at < 0) {
      console.error(`--from: no Kentucky county called "${fromCounty}"`);
      process.exit(2);
    }
    counties = counties.slice(at);
    console.log(`starting at ${counties[0]}: ${counties.length} counties to do`);
  }
  if (shard && !only) counties = counties.filter((_, idx) => idx % shard.n === shard.i);
  if (skipFreshDays > 0 && !only) {
    const fresh = await recentlyRefreshed(skipFreshDays);
    const before = counties.length;
    counties = counties.filter((c) => !fresh.has(c));
    console.log(
      `skipping ${before - counties.length} counties refreshed in the last ${skipFreshDays} days; ${counties.length} to do`,
    );
  }
  if (counties.length === 0) {
    console.error("Give --county <Name> or --all");
    process.exit(2);
  }
  const failed: string[] = [];
  for (const c of counties) {
    try {
      await withStallWatch(loadCounty(c), c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isAuthError(msg)) {
        // Session lost: sign in again and give the county one more go.
        console.error(`[${c}] session lost (${msg}); signing in again`);
        try {
          await signIn();
          await withStallWatch(loadCounty(c), c);
          continue;
        } catch (e2) {
          failed.push(c);
          console.error(`[${c}] FAILED: ${e2 instanceof Error ? e2.message : String(e2)}`);
          continue;
        }
      }
      failed.push(c);
      console.error(`[${c}] FAILED: ${msg}`);
    }
  }
  if (failed.length > 0) {
    console.error(`Failed counties: ${failed.join(", ")}`);
    process.exit(1);
  }
  if (approxSkippedNoMigration) {
    // The exact refresh finished; fail the run anyway so the skipped pass is not missed.
    console.error(
      "::error::The approximate-address pass was skipped (migration 20260930040000_address_approx.sql not applied).",
    );
    process.exit(1);
  }
}

void main();
