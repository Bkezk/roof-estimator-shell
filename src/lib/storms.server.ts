/**
 * Storm call points — SERVER ONLY (fetches NOAA; load inside a handler with a dynamic import).
 *
 * Owner, Sep 28: "I don't care about history, just if there's been a major weather event in
 * the past week so they are potential call points." NOAA's Storm Prediction Center publishes
 * one CSV per day of every hail, wind and tornado report:
 *   https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_{hail,wind,torn}.csv
 * Columns (checked Sep 28): Time,Size|Speed|F_Scale,Location,County,State,Lat,Lon,Comments;
 * no quoting, hail Size in hundredths of an inch (100 = 1.00"), wind Speed in mph or UNK,
 * tornado F_Scale like EF1 or UNK. Today's file grows through the day, so the pass re-reads the
 * whole window every time and upserts on (date, kind, time, lat, lon).
 *
 * refreshStorms: fetch the window, keep the rows for the configured states, upsert, run the SQL
 * matcher (buildings within the radius of a qualifying report), and tell Prospecting users
 * when new buildings were flagged. Never throws for a single missing day (NOAA is sometimes a
 * day behind); the storm_settings row records what happened.
 */
import type { Database } from "@/integrations/supabase/types";
import { notify, serverClient, type Client } from "@/lib/notify.server";

export type StormKind = "hail" | "wind" | "tornado";
export interface SpcReport {
  report_date: string; // YYYY-MM-DD
  kind: StormKind;
  report_time: string;
  magnitude: number | null;
  location: string | null;
  county: string | null;
  state: string;
  lat: number;
  lng: number;
  comments: string | null;
}

const SPC = "https://www.spc.noaa.gov/climo/reports";
const FILE_KIND: Record<StormKind, string> = { hail: "hail", wind: "wind", tornado: "torn" };

/** YYMMDD for the SPC file name. */
export function spcDateCode(d: Date): string {
  return d.toISOString().slice(2, 10).replace(/-/g, "");
}
export function spcUrl(d: Date, kind: StormKind): string {
  return `${SPC}/${spcDateCode(d)}_rpts_${FILE_KIND[kind]}.csv`;
}

/** The magnitude column: hail hundredths → inches, wind mph, tornado EF number; UNK → null. */
export function parseMagnitude(kind: StormKind, raw: string): number | null {
  const s = raw.trim().toUpperCase();
  if (!s || s === "UNK") return null;
  if (kind === "tornado") {
    const m = /^E?F(\d)/.exec(s);
    return m ? Number(m[1]) : null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return kind === "hail" ? n / 100 : n;
}

/**
 * Parse one SPC CSV. The first seven columns never contain commas; everything after the
 * seventh comma is the free-text comment. Rows without a usable lat/lon are dropped.
 */
export function parseSpcCsv(
  text: string,
  kind: StormKind,
  reportDate: string,
  states: readonly string[],
): SpcReport[] {
  const out: SpcReport[] = [];
  const want = new Set(states.map((s) => s.toUpperCase()));
  const lines = text.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 7) continue;
    const [time, mag, location, county, state, latS, lngS] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const st = state.trim().toUpperCase();
    if (want.size && !want.has(st)) continue;
    const lat = Number(latS);
    const lng = Number(lngS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0) continue;
    const comments = parts.slice(7).join(",").trim();
    out.push({
      report_date: reportDate,
      kind,
      report_time: time.trim(),
      magnitude: parseMagnitude(kind, mag),
      location: location.trim() || null,
      county: county.trim() || null,
      state: st,
      lat,
      lng,
      comments: comments || null,
    });
  }
  return out;
}

/** The dates of the window, today (UTC) back `days` days inclusive. */
export function windowDates(days: number, now = new Date()): Date[] {
  const out: Date[] = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d);
  }
  return out;
}

export interface RefreshResult {
  fetched_files: number;
  failed_files: string[];
  reports_kept: number;
  reports_in_window: number;
  new_hits: number;
  buildings_flagged: number;
  notified: number;
}

type SettingsRow = Database["public"]["Tables"]["storm_settings"]["Row"];

export async function refreshStorms(sb: Client): Promise<RefreshResult> {
  const admin = await serverClient(sb);
  const { data: settings, error: sErr } = await admin
    .from("storm_settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (sErr) throw new Error(sErr.message);
  const s: SettingsRow = settings;
  const dates = windowDates(s.window_days);
  const kinds: StormKind[] = ["hail", "wind", "tornado"];
  const rows: SpcReport[] = [];
  const failed: string[] = [];
  let fetched = 0;
  for (const d of dates) {
    const ymd = d.toISOString().slice(0, 10);
    for (const kind of kinds) {
      const url = spcUrl(d, kind);
      try {
        const res = await fetch(url, { headers: { "User-Agent": "JBK Portal storm call points" } });
        if (!res.ok) {
          // 404 = NOAA has not published that day yet (or never will for an old date).
          if (res.status !== 404) failed.push(`${url} → ${res.status}`);
          continue;
        }
        fetched++;
        rows.push(...parseSpcCsv(await res.text(), kind, ymd, s.states));
      } catch (e) {
        failed.push(`${url} → ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  // Upsert on the natural key; the same row re-read tomorrow just refreshes fetched_at.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = `${r.report_date}|${r.kind}|${r.report_time}|${r.lat}|${r.lng}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (let i = 0; i < unique.length; i += 500) {
    const { error } = await admin
      .from("storm_reports")
      .upsert(unique.slice(i, i + 500), { onConflict: "report_date,kind,report_time,lat,lng" });
    if (error) throw new Error(error.message);
  }
  const { data: matched, error: mErr } = await admin.rpc("match_storm_reports");
  if (mErr) throw new Error(mErr.message);
  const m = matched?.[0] ?? { reports_in_window: 0, new_hits: 0, buildings_flagged: 0 };

  // New call points → one inbox note (email / push per each user's channels) to Prospecting.
  let notified = 0;
  if (m.new_hits > 0) {
    const { data: ids } = await admin.rpc("prospect_user_ids");
    if (ids?.length) {
      const { data: top } = await admin
        .from("storm_reports")
        .select("kind, magnitude, county, report_date")
        .gte(
          "report_date",
          new Date(Date.now() - s.window_days * 86400000).toISOString().slice(0, 10),
        )
        .order("magnitude", { ascending: false, nullsFirst: false })
        .limit(1);
      const t = top?.[0];
      const where = t?.county ? ` Biggest: ${describeReport(t)} in ${t.county} County.` : "";
      notified = await notify(
        ids,
        {
          kind: "storm",
          title: `Storm call points: ${m.buildings_flagged} building${m.buildings_flagged === 1 ? "" : "s"} hit in the last ${s.window_days} days`,
          body: `${m.new_hits} newly flagged since the last check.${where} Open Buildings and filter by Storm hit.`,
          url: "/prospect?storm=1",
        },
        admin,
      );
    }
  }
  const note = `${fetched} files, ${unique.length} reports kept, ${m.reports_in_window} in window, ${m.new_hits} new hits, ${m.buildings_flagged} buildings flagged${failed.length ? `; ${failed.length} file(s) failed` : ""}`;
  await admin.rpc("stamp_storm_fetch", { note });
  return {
    fetched_files: fetched,
    failed_files: failed,
    reports_kept: unique.length,
    reports_in_window: m.reports_in_window,
    new_hits: m.new_hits,
    buildings_flagged: m.buildings_flagged,
    notified,
  };
}

/** "1.75-inch hail", "70 mph wind", "EF2 tornado". */
export function describeReport(r: { kind: string; magnitude: number | null }): string {
  if (r.kind === "hail")
    return r.magnitude != null ? `${r.magnitude.toFixed(2).replace(/0$/, "")}-inch hail` : "hail";
  if (r.kind === "wind") return r.magnitude != null ? `${r.magnitude} mph wind` : "damaging wind";
  return r.magnitude != null ? `EF${r.magnitude} tornado` : "tornado";
}
