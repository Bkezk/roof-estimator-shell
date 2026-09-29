/**
 * Statewide Tennessee loader: every non-residential building of 5,000 sq ft and up in the 95
 * counties, from the national FEMA / ORNL "USA Structures" layer (docs/tennessee-buildings.md).
 * Run monthly by .github/workflows/refresh-tennessee.yml, or by hand:
 *
 *   npx vite-node scripts/load-tennessee.ts --county Davidson --dry-run
 *   npx vite-node scripts/load-tennessee.ts --all [--min-sqft 5000] [--shard 1/2] [--skip-fresh 2]
 *
 * Tennessee has no public statewide 911 address points or schools service, so unlike Kentucky
 * this is footprints only: the layer itself carries the occupancy class, the county and, for
 * many buildings, the street address. Per county: page through the layer 2,000 rows at a time
 * (OBJECTID order) → map each feature (tnBuildingRow) → upsert_buildings in batches of 200 →
 * log the refresh as "<County>, TN". Nothing a person typed is overwritten (upsert_buildings).
 *
 * --dry-run fetches and maps everything but writes nothing and needs no login; it prints the
 * counts, paging and a sample row. Writes need the 20260929210000 migration (upsert_buildings
 * with `state`); the loader stops if its first rows come back as Kentucky.
 *
 * Signs in exactly like scripts/load-kentucky.ts: LOADER_EMAIL and LOADER_PASSWORD (GitHub
 * secrets; never in the repo) or SUPABASE_SERVICE_ROLE_KEY; URL and public key from .env.
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import type { Database, Json } from "../src/integrations/supabase/types";
import type { ArcGisFeatureSet } from "../src/lib/gis/arcgis";
import { parseLooseJson } from "../src/lib/loose-json";
import {
  TN_COUNTIES,
  TN_PAGE_SIZE,
  tnBuildingRow,
  tnCountUrl,
  tnFipsForCounty,
  tnPageUrl,
  tnRefreshCounty,
  type TnBuildingRow,
} from "../src/lib/gis/tn-layers";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = args.includes("--all");
const only = flag("--county");
const minSqFt = Number(flag("--min-sqft") ?? 5000);
const dryRun = args.includes("--dry-run");
// --skip-fresh 2: leave out counties with a "<County>, TN" data_refreshes row from the last N
// days, so a cancelled pass can be resumed without redoing the finished counties.
const skipFreshDays = Number(flag("--skip-fresh") ?? 0);
// --shard 2/3: this run takes every 3rd county starting at the 2nd.
const shard = (() => {
  const m = /^(\d+)\/(\d+)$/.exec(flag("--shard") ?? "");
  return m ? { i: Number(m[1]) - 1, n: Number(m[2]) } : null;
})();
const BATCH = 200;
// A breather between write batches so the app stays usable while a load runs (owner, Sep 29:
// "I just don't want to not be able to work on it for a while"). About 510 batches statewide,
// so 400 ms adds roughly three and a half minutes to the run. --fast drops it.
const PAUSE_MS = args.includes("--fast") ? 0 : 400;

// Connection (same as the Kentucky loader). Not needed for --dry-run.
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
    "Need SUPABASE_URL (or .env) and either LOADER_EMAIL + LOADER_PASSWORD (a Prospecting login) or SUPABASE_SERVICE_ROLE_KEY (or pass --dry-run)",
  );
  process.exit(2);
}
const sb = dryRun
  ? null
  : createClient<Database>(url!, serviceKey ?? publicKey!, {
      auth: { persistSession: false, autoRefreshToken: true },
    });
const db = () => {
  if (!sb) throw new Error("no database in --dry-run");
  return sb;
};

async function fetchJson(u: string, tries = 3): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(u, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = parseLooseJson(await res.text()) as { error?: { message?: string } };
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

/**
 * A county's features, page by page. The next offset is what came back, not the page size,
 * and the loop runs while the server says there is more (exceededTransferLimit), so a server
 * that trims a heavy page below 2,000 cannot make the loader stop early.
 */
async function* pages(fips: string) {
  for (let offset = 0; ;) {
    const page = (await fetchJson(tnPageUrl(fips, offset, minSqFt))) as ArcGisFeatureSet;
    const feats = page.features ?? [];
    if (feats.length > 0) yield feats;
    if (feats.length === 0 || !page.exceededTransferLimit) return;
    offset += feats.length;
  }
}

const rpc = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await (
    db().rpc as unknown as (
      n: string,
      p: Record<string, unknown>,
    ) => Promise<{ data: T; error: { message: string } | null }>
  )(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
};

/** Tennessee counties with a data_refreshes row newer than `days` days. */
async function recentlyRefreshed(days: number): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("data_refreshes")
      .select("county")
      .like("county", "%, TN")
      .gte("ran_at", since)
      .range(from, from + 999);
    if (error) throw new Error(`data_refreshes: ${error.message}`);
    for (const r of data ?? []) out.add(r.county);
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * The first rows written in a run are read back: with the old upsert_buildings (before the
 * 20260929210000 migration) `state` is silently dropped and every row would land as 'KY'.
 */
let stateChecked = false;
async function checkStateStored(sourceKey: string) {
  if (stateChecked) return;
  const { data, error } = await db()
    .from("buildings")
    .select("state")
    .eq("source_key", sourceKey)
    .maybeSingle();
  if (error) throw new Error(`state check: ${error.message}`);
  if (data?.state !== "TN") {
    console.error(
      `Row ${sourceKey} was stored with state ${data?.state ?? "(missing)"}, not TN: apply supabase/migrations/20260929210000_buildings_state_tn.sql first.`,
    );
    process.exit(3);
  }
  stateChecked = true;
}

interface CountyResult {
  expected: number;
  fetched: number;
  rows: number;
  written: number;
  pages: number;
  sample: TnBuildingRow | null;
  /** perimeter ÷ the perimeter of a square of the same area (1 for a square, ~1.1–1.5 usual). */
  shapeRatios: number[];
}

async function loadCounty(county: string): Promise<CountyResult> {
  const t0 = Date.now();
  const fips = tnFipsForCounty(county);
  if (!fips) throw new Error(`not a Tennessee county: ${county}`);
  const { count: expected } = (await fetchJson(tnCountUrl(fips, minSqFt))) as { count: number };
  const res: CountyResult = {
    expected,
    fetched: 0,
    rows: 0,
    written: 0,
    pages: 0,
    sample: null,
    shapeRatios: [],
  };
  const seen = new Set<string>();
  for await (const feats of pages(fips)) {
    res.pages++;
    res.fetched += feats.length;
    const rows: TnBuildingRow[] = [];
    for (const f of feats) {
      const r = tnBuildingRow(f, county);
      // A key seen on an earlier page (the layer changed while paging) is sent once.
      if (!r || seen.has(r.source_key)) continue;
      seen.add(r.source_key);
      rows.push(r);
      if (r.roof_sqft && r.perimeter_ft) {
        res.shapeRatios.push(r.perimeter_ft / (4 * Math.sqrt(r.roof_sqft)));
      }
      // Sample: the first building with an address, else the first one.
      if (!res.sample || (!res.sample.address1 && r.address1)) res.sample = r;
    }
    res.rows += rows.length;
    if (!dryRun) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        res.written += await rpc<number>("upsert_buildings", { rows: batch as unknown as Json });
        await checkStateStored(batch[0]!.source_key);
        if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    }
    process.stdout.write(
      `\r[${county}] page ${res.pages}: ${res.fetched} of ${expected} fetched, ${dryRun ? `${res.rows} mapped` : `${res.written} written`}`,
    );
  }
  console.log("");
  const secs = Math.round((Date.now() - t0) / 1000);
  if (res.fetched !== expected) {
    console.warn(`[${county}] WARNING: fetched ${res.fetched} but the layer counts ${expected}`);
  }
  if (!dryRun) {
    const { error } = await db()
      .from("data_refreshes")
      .insert({
        county: tnRefreshCounty(county),
        ran_by: "scheduled",
        buildings: res.written,
        notes: `USA Structures, ${res.pages} pages, ${res.fetched} fetched (layer count ${expected}); ${secs} s`,
      });
    if (error) throw new Error(error.message);
  }
  console.log(
    `[${county}] done: ${res.rows} buildings ${dryRun ? "mapped (dry run, nothing written)" : `written (${res.written})`}, ${res.pages} pages, ${secs} s`,
  );
  return res;
}

async function signIn(): Promise<void> {
  if (dryRun || serviceKey) return;
  for (let attempt = 1; ; attempt++) {
    const { error } = await db().auth.signInWithPassword({ email: email!, password: password! });
    if (!error) break;
    if (attempt >= 6) throw new Error(`Could not sign in as ${email}: ${error.message}`);
    console.log(`sign-in failed (${error.message}); retrying in ${attempt * 30} s`);
    await new Promise((r) => setTimeout(r, attempt * 30_000));
  }
  await db().auth.startAutoRefresh();
}

const isAuthError = (msg: string) =>
  /row-level security|jwt|token|401|not authenticated|expired/i.test(msg);

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

function report(county: string, r: CountyResult) {
  if (!r.sample) return;
  const fp = r.sample.footprint as { type: string; coordinates: unknown[] } | null;
  const ring = (fp?.coordinates[0] as number[][] | undefined) ?? [];
  console.log(`[${county}] sample row:`);
  console.log(
    JSON.stringify(
      {
        ...r.sample,
        footprint: fp
          ? { type: fp.type, firstRing: `${ring.length} points`, first: ring[0] }
          : null,
      },
      null,
      2,
    ),
  );
  const s = r.shapeRatios;
  console.log(
    `[${county}] perimeter ÷ square-of-same-area: median ${median(s).toFixed(2)}, min ${Math.min(...s).toFixed(2)}, max ${Math.max(...s).toFixed(2)} (${s.length} rows)`,
  );
}

async function main() {
  try {
    await signIn();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  let counties = only ? [only] : all ? TN_COUNTIES.map((c) => c.name) : [];
  if (only && !tnFipsForCounty(only)) {
    console.error(`Not a Tennessee county: ${only}`);
    process.exit(2);
  }
  if (shard && !only) counties = counties.filter((_, idx) => idx % shard.n === shard.i);
  if (skipFreshDays > 0 && !only) {
    if (dryRun) {
      console.log("--skip-fresh ignored in a dry run (it reads the database)");
    } else {
      const fresh = await recentlyRefreshed(skipFreshDays);
      const before = counties.length;
      counties = counties.filter((c) => !fresh.has(tnRefreshCounty(c)));
      console.log(
        `skipping ${before - counties.length} counties refreshed in the last ${skipFreshDays} days; ${counties.length} to do`,
      );
    }
  }
  if (counties.length === 0) {
    console.error("Give --county <Name> or --all");
    process.exit(2);
  }
  console.log(
    `${dryRun ? "DRY RUN: " : ""}${counties.length} counties, SQFEET >= ${minSqFt}, not Residential, ${TN_PAGE_SIZE} a page`,
  );
  const failed: string[] = [];
  let total = 0;
  for (const c of counties) {
    try {
      const r = await loadCounty(c);
      total += r.rows;
      if (dryRun && counties.length <= 3) report(c, r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!dryRun && isAuthError(msg)) {
        console.error(`[${c}] session lost (${msg}); signing in again`);
        try {
          await signIn();
          total += (await loadCounty(c)).rows;
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
  console.log(`total: ${total} buildings ${dryRun ? "mapped (dry run)" : "loaded"}`);
  if (failed.length > 0) {
    console.error(`Failed counties: ${failed.join(", ")}`);
    process.exit(1);
  }
}

void main();
