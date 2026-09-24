/**
 * Statewide loader — the same county pipeline the Buildings page runs, for all 120 counties,
 * from a machine that can reach the state server (GitHub Actions monthly, or a laptop):
 *
 *   npx vite-node scripts/load-kentucky.ts --county Hardin
 *   npx vite-node scripts/load-kentucky.ts --all [--min-sqft 5000] [--skip-footprints] [--shard 1/4]
 *
 * Signs in as a Prospecting login: LOADER_EMAIL and LOADER_PASSWORD in the environment (GitHub
 * secrets; never in the repo). The project URL and public key are read from the committed .env. Per county: footprints of the size floor → every 911 address point → match
 * addresses → promote named / commercially typed points → attach their outlines → schools →
 * trim the house points → log the refresh. Nothing a person typed is overwritten
 * (upsert_buildings). Footprints are a one-time survey, so --skip-footprints makes the monthly
 * run refresh addresses and facilities only.
 */
import { createClient } from "@supabase/supabase-js";

import type { Database, Json } from "../src/integrations/supabase/types";
import { parcelQueryUrl, type ArcGisFeatureSet } from "../src/lib/gis/arcgis";
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
const minSqFt = Number(flag("--min-sqft") ?? 5000);
const skipFootprints = args.includes("--skip-footprints");
// --shard 2/4: this run takes every 4th county starting at the 2nd (GitHub runs shards in
// parallel so the whole state fits inside one job's time limit).
const shard = (() => {
  const m = /^(\d+)\/(\d+)$/.exec(flag("--shard") ?? "");
  return m ? { i: Number(m[1]) - 1, n: Number(m[2]) } : null;
})();
const pageSize = 500;

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
if (!url || !(serviceKey || (publicKey && email && password))) {
  console.error(
    "Need SUPABASE_URL (or .env) and either LOADER_EMAIL + LOADER_PASSWORD (a Prospecting login) or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(2);
}
const sb = createClient<Database>(url, serviceKey ?? publicKey!, {
  auth: { persistSession: false, autoRefreshToken: true },
});

async function fetchJson(u: string, body?: URLSearchParams, tries = 3): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(u, {
        method: body ? "POST" : "GET",
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(body ? { body: body.toString() } : {}),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as { error?: { message?: string } };
      if (json && typeof json === "object" && json.error) {
        throw new Error(json.error.message ?? "ArcGIS error");
      }
      return json;
    } catch (e) {
      if (attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
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

/** A cheap "is there a stored building within ~250 m" test for one county (grid of 0.003°). */
async function centroidGrid(county: string): Promise<(lat: number, lng: number) => boolean> {
  const cells = new Set<string>();
  const key = (lat: number, lng: number) => `${Math.floor(lat / 0.003)}|${Math.floor(lng / 0.003)}`;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("buildings")
      .select("centroid_lat, centroid_lng")
      .eq("county", county)
      .is("deleted_at", null)
      .not("centroid_lat", "is", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const la = r.centroid_lat!;
      const ln = r.centroid_lng!;
      // Mark the cell and its neighbours so anything within one cell (≈ 330 m) counts as near.
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) cells.add(key(la + a * 0.003, ln + b * 0.003));
    }
    if (!data || data.length < 1000) break;
  }
  return (lat, lng) => cells.has(key(lat, lng));
}

async function loadCounty(county: string) {
  const t0 = Date.now();
  const log = (m: string) => console.log(`[${county}] ${m}`);
  let buildings = 0;
  if (!skipFootprints) {
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
  // Address points: the state has 2.5 million and 85 % are houses nowhere near a prospect.
  // Keep, before anything touches the database, only the points near a stored building
  // (grid lookup against the county's centroids, 250 m — wider than any match radius) or
  // carrying a landmark / place type (the ones that can become businesses). The trim step
  // then has little to do and the database stays responsive for the people using it.
  const near = await centroidGrid(county);
  let points = 0;
  let seen = 0;
  for await (const feats of pages(KY_ADDRESS_POINTS_LAYER, countyWhere("address", county))) {
    seen += feats.length;
    const rows = feats
      .map(addressPointFromFeature)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      // Some counties type every point ("RESIDENTIAL" on each house), so the type alone is not
      // a reason to keep it: keep what reads commercial, or sits near a stored building.
      .filter((c) => classifyPlace(c.placeType, c.landmark) === "commercial" || near(c.lat, c.lng))
      .map((c) => ({
        source_key: `ky911:${c.key}`,
        county: c.county ?? county,
        address: c.address,
        city: c.city,
        zip: c.zip,
        landmark: c.landmark,
        place_type: c.placeType,
        lat: c.lat,
        lng: c.lng,
        source_layer: KY_ADDRESS_POINTS_LAYER,
        imported_at: new Date().toISOString(),
      }));
    if (rows.length > 0) {
      const { error } = await sb
        .from("address_points")
        .upsert(rows, { onConflict: "source_key", ignoreDuplicates: false });
      if (error) throw new Error(error.message);
      points += rows.length;
    }
    process.stdout.write(`\r[${county}] address points kept ${points} of ${seen}`);
  }
  console.log("");
  // Chunked database steps: each call handles a few hundred rows (well inside the statement
  // timeout) and the loop runs until a call comes back short.
  await rpc<number>("reset_address_checks", { p_county: county });
  const { count: before } = await sb
    .from("buildings")
    .select("id", { count: "exact", head: true })
    .eq("county", county)
    .is("deleted_at", null)
    .neq("address1", "");
  for (;;) {
    const n = await rpc<number>("fill_footprint_addresses", { p_county: county, p_limit: 400 });
    process.stdout.write(`\r[${county}] matching addresses… ${n} checked`);
    if (n < 400) break;
  }
  const { count: after } = await sb
    .from("buildings")
    .select("id", { count: "exact", head: true })
    .eq("county", county)
    .is("deleted_at", null)
    .neq("address1", "");
  const addressed = (after ?? 0) - (before ?? 0);
  console.log("");
  log(`addresses matched: ${addressed}`);
  let promoted = 0;
  for (;;) {
    const n = await rpc<number>("promote_commercial_points", { p_county: county, p_limit: 300 });
    promoted += n;
    if (n < 300) break;
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
  let trimmed = 0;
  for (;;) {
    const n = await rpc<number>("trim_address_points", { p_county: county, p_limit: 5000 });
    trimmed += n;
    if (n < 5000) break;
  }
  const { error: rErr } = await sb.from("data_refreshes").insert({
    county,
    ran_by: "scheduled",
    buildings,
    addressed,
    promoted,
    points_kept: points - trimmed,
    facilities,
    notes: `${attached} named businesses given an outline; ${Math.round((Date.now() - t0) / 1000)} s`,
  });
  if (rErr) throw new Error(rErr.message);
  log(
    `done: ${buildings} buildings by size, ${promoted} named businesses (${attached} with outlines), ${addressed} addresses, ${facilities} schools, ${points - trimmed} points kept, ${Math.round((Date.now() - t0) / 1000)} s`,
  );
}

async function main() {
  if (!serviceKey) {
    const { error } = await sb.auth.signInWithPassword({ email: email!, password: password! });
    if (error) {
      console.error(`Could not sign in as ${email}: ${error.message}`);
      process.exit(2);
    }
  }
  let counties = only ? [only] : all ? [...KY_COUNTIES] : [];
  if (shard && !only) counties = counties.filter((_, idx) => idx % shard.n === shard.i);
  if (counties.length === 0) {
    console.error("Give --county <Name> or --all");
    process.exit(2);
  }
  const failed: string[] = [];
  for (const c of counties) {
    try {
      await loadCounty(c);
    } catch (e) {
      failed.push(c);
      console.error(`[${c}] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed.length > 0) {
    console.error(`Failed counties: ${failed.join(", ")}`);
    process.exit(1);
  }
}

void main();
