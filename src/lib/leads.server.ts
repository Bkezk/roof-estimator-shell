/**
 * Construction leads — SERVER ONLY (fetches public sites; load inside a handler with a
 * dynamic import).
 *
 * Owner, Sep 28: "Is there any way to get data on new builds before they're built, giving us
 * time to submit a bid?" Two public feeds, checked Sep 28:
 *
 *   State of KY online planroom  https://www.stateofkyplanroom.com/
 *     The Division of Engineering and Contract Administration's list of every state-funded
 *     project in bid phase (100 rows that day, 9 of them roof jobs). Plain HTML, no login:
 *     one <tr> per job with the name linked to ViewJob.aspx?job_id=N, the location under it,
 *     then Company Name, Project Type, Pre-Bid Date, Bid Date ("10/20/2026 01:30 PM ET").
 *     The list is at the site root; the per-job pages need a browser session, so the lead
 *     links there for the documents.
 *
 *   Louisville Metro active construction permits (LOJIC open data, ArcGIS REST)
 *     https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0
 *     Fields: PERMIT_NUMBER, PERMIT_TYPE ("Commercial New", "Commercial Addition", ...),
 *     PERMIT_STATUS, CONTRACTOR, WORK_TYPE, SQFT, PROJECT_COSTS, ADDRESS, CITY, ZIPCODE,
 *     LATITUDE, LONGITUDE, ISSUE_DATE (epoch ms). A permit means construction is starting,
 *     so the roof is still months out on a new build.
 *
 * refreshLeads: pull both, upsert on (source, external_id) keeping the team's status, mark
 * what dropped off the source as gone, and tell Prospecting users about new roof leads.
 * Nothing here touches bids.
 */
import type { Database, Json } from "@/integrations/supabase/types";
import { notify, serverClient, type Client } from "@/lib/notify.server";

export type LeadSource = "ky_planroom" | "louisville_permits";
type LeadInsert = Database["public"]["Tables"]["leads"]["Insert"];
type SettingsRow = Database["public"]["Tables"]["lead_settings"]["Row"];

export const PLANROOM_URL = "https://www.stateofkyplanroom.com/";
export const planroomJobUrl = (jobId: string) =>
  `https://www.stateofkyplanroom.com/ViewJob.aspx?job_id=${jobId}`;
export const LOUISVILLE_PERMITS_LAYER =
  "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0";
export const LOUISVILLE_PERMITS_PAGE =
  "https://data.louisvilleky.gov/datasets/LOJIC::louisville-metro-ky-active-construction-permits/explore";

const UA = "JBK Portal construction leads";

/* ------------------------------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------------------------------- */

/** Second Sunday of March through the first Sunday of November (2:00 local): US daylight time. */
export function isUsDaylightTime(y: number, m: number, d: number, h: number): boolean {
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const start = nthSunday(2, 2); // March
  const end = nthSunday(10, 1); // November
  if (m < 2 || m > 10) return false;
  if (m > 2 && m < 10) return true;
  if (m === 2) return d > start || (d === start && h >= 2);
  return d < end || (d === end && h < 2);
}

/** "10/20/2026 01:30 PM ET" → ISO instant (Eastern, daylight or standard by date). */
export function parseEasternDate(text: string): string | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(text);
  if (!m) return null;
  const month = Number(m[1]) - 1;
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = m[4] ? Number(m[4]) % 12 : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  if (m[6]?.toUpperCase() === "PM") hour += 12;
  const offset = isUsDaylightTime(year, month, day, hour) ? 4 : 5;
  return new Date(Date.UTC(year, month, day, hour + offset, minute)).toISOString();
}

/* ------------------------------------------------------------------------------------------------
 * The planroom list
 * ---------------------------------------------------------------------------------------------- */

export interface PlanroomJob {
  jobId: string;
  name: string;
  location: string | null;
  company: string | null;
  projectType: string | null;
  prebidAt: string | null;
  bidAt: string | null;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** One job per <tr> whose first cell links ViewJob.aspx?job_id=N. Tolerates cell order drift. */
export function parsePlanroomHtml(html: string): PlanroomJob[] {
  const out: PlanroomJob[] = [];
  const seen = new Set<string>();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const link = /<a[^>]*href="ViewJob\.aspx\?job_id=(\d+)"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!link) continue;
    const jobId = link[1]!;
    if (seen.has(jobId)) continue;
    const cells = (row.match(/<td[\s\S]*?<\/td>/gi) ?? []).map((c) => c);
    if (cells.length < 5) continue;
    const first = cells[0]!;
    // The location follows the name on its own line (after <br /> and the pin icon).
    const afterLink = first.slice(first.indexOf("</a>") + 4);
    const location = decode(afterLink) || null;
    const company = decode(cells[1]!) || null;
    const projectType = decode(cells[2]!) || null;
    const prebidAt = parseEasternDate(decode(cells[3]!));
    const bidAt = parseEasternDate(decode(cells[4]!));
    seen.add(jobId);
    out.push({
      jobId,
      name: decode(link[2]!),
      location,
      company,
      projectType,
      prebidAt,
      bidAt,
    });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Louisville permits
 * ---------------------------------------------------------------------------------------------- */

export interface LouisvillePermit {
  PERMIT_NUMBER: string;
  PERMIT_TYPE: string | null;
  PERMIT_STATUS: string | null;
  CONTRACTOR: string | null;
  WORK_TYPE: string | null;
  SQFT: number | null;
  PROJECT_COSTS: number | null;
  ADDRESS: string | null;
  CITY: string | null;
  ZIPCODE: string | null;
  LATITUDE: number | null;
  LONGITUDE: number | null;
  ISSUE_DATE: number | null;
}

const sqlQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The ArcGIS query for the permits worth a call: the chosen types, big enough, recent. */
export function louisvilleQueryUrl(
  s: Pick<SettingsRow, "louisville_types" | "louisville_min_sqft" | "louisville_days">,
  offset = 0,
  now = new Date(),
): string {
  const since = new Date(now.getTime() - s.louisville_days * 86400000).toISOString().slice(0, 10);
  const types = s.louisville_types.length
    ? `PERMIT_TYPE IN (${s.louisville_types.map(sqlQuote).join(",")})`
    : "1=1";
  const where = `${types} AND ISSUE_DATE >= DATE '${since}' AND SQFT >= ${Number(s.louisville_min_sqft) || 0}`;
  const q = new URLSearchParams({
    where,
    outFields:
      "PERMIT_NUMBER,PERMIT_TYPE,PERMIT_STATUS,CONTRACTOR,WORK_TYPE,SQFT,PROJECT_COSTS,ADDRESS,CITY,ZIPCODE,LATITUDE,LONGITUDE,ISSUE_DATE",
    orderByFields: "ISSUE_DATE DESC",
    resultRecordCount: "1000",
    resultOffset: String(offset),
    returnGeometry: "false",
    f: "json",
  });
  return `${LOUISVILLE_PERMITS_LAYER}/query?${q.toString()}`;
}

async function fetchLouisville(s: SettingsRow): Promise<LouisvillePermit[]> {
  const out: LouisvillePermit[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const res = await fetch(louisvilleQueryUrl(s, offset), { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Louisville permits → ${res.status}`);
    const json = (await res.json()) as {
      error?: { message?: string };
      features?: { attributes: LouisvillePermit }[];
      exceededTransferLimit?: boolean;
    };
    if (json.error) throw new Error(`Louisville permits → ${json.error.message ?? "error"}`);
    out.push(...(json.features ?? []).map((f) => f.attributes));
    if (!json.exceededTransferLimit) break;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Rows
 * ---------------------------------------------------------------------------------------------- */

/** Keyword match, case-insensitive, at a word start ("roof" also catches "roofing", "Roofs"). */
export function isRoofLead(text: string, keywords: string[]): boolean {
  const hay = text.toLowerCase();
  return keywords.some((k) => {
    const kw = k.trim().toLowerCase();
    if (!kw) return false;
    const re = new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    return re.test(hay);
  });
}

export function planroomLead(j: PlanroomJob, keywords: string[]): LeadInsert {
  const text = `${j.name} ${j.projectType ?? ""}`;
  return {
    source: "ky_planroom",
    external_id: j.jobId,
    title: j.name,
    agency: j.company,
    location: j.location,
    project_type: j.projectType,
    prebid_at: j.prebidAt,
    bid_at: j.bidAt,
    url: planroomJobUrl(j.jobId),
    is_roof: isRoofLead(text, keywords),
    raw: j as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

export function louisvilleLead(p: LouisvillePermit, keywords: string[]): LeadInsert {
  const address = (p.ADDRESS ?? "").trim();
  const type = (p.PERMIT_TYPE ?? "").trim();
  const text = `${type} ${p.WORK_TYPE ?? ""} ${address}`;
  return {
    source: "louisville_permits",
    external_id: p.PERMIT_NUMBER,
    title: address ? `${address}${type ? ` — ${type}` : ""}` : p.PERMIT_NUMBER,
    agency: null,
    contractor: (p.CONTRACTOR ?? "").trim() || null,
    location: [p.CITY, p.ZIPCODE].filter(Boolean).join(" ") || null,
    county: "Jefferson",
    address: address || null,
    city: (p.CITY ?? "").trim() || null,
    lat: p.LATITUDE,
    lng: p.LONGITUDE,
    project_type: type || null,
    sqft: p.SQFT,
    project_cost: p.PROJECT_COSTS,
    issued_on: p.ISSUE_DATE ? new Date(p.ISSUE_DATE).toISOString().slice(0, 10) : null,
    url: LOUISVILLE_PERMITS_PAGE,
    // A whole new commercial building is a roof to bid whatever the permit is called.
    is_roof: /commercial (new|addition)/i.test(type) || isRoofLead(text, keywords),
    raw: p as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The refresh
 * ---------------------------------------------------------------------------------------------- */

export interface RefreshLeadsResult {
  planroom: number;
  louisville: number;
  new_leads: number;
  new_roof_leads: number;
  gone: number;
  failed: string[];
  notified: number;
}

export async function refreshLeads(sb: Client): Promise<RefreshLeadsResult> {
  const admin = await serverClient(sb);
  const { data: settings, error: sErr } = await admin
    .from("lead_settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (sErr) throw new Error(sErr.message);
  const s: SettingsRow = settings;
  const failed: string[] = [];
  const rows: LeadInsert[] = [];
  const fetchedSources = new Set<LeadSource>();

  try {
    const res = await fetch(PLANROOM_URL, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`→ ${res.status}`);
    const jobs = parsePlanroomHtml(await res.text());
    if (!jobs.length) throw new Error("no jobs parsed (page layout changed?)");
    rows.push(...jobs.map((j) => planroomLead(j, s.roof_keywords)));
    fetchedSources.add("ky_planroom");
  } catch (e) {
    failed.push(`State planroom ${e instanceof Error ? e.message : String(e)}`);
  }
  let louisvilleCount = 0;
  try {
    const permits = await fetchLouisville(s);
    louisvilleCount = permits.length;
    rows.push(...permits.map((p) => louisvilleLead(p, s.roof_keywords)));
    fetchedSources.add("louisville_permits");
  } catch (e) {
    failed.push(`Louisville permits ${e instanceof Error ? e.message : String(e)}`);
  }
  const planroomCount = rows.length - louisvilleCount;

  // Which of these are new? Compare against what is stored before the upsert.
  const { data: existing, error: eErr } = await admin.from("leads").select("source, external_id");
  if (eErr) throw new Error(eErr.message);
  const known = new Set((existing ?? []).map((r) => `${r.source}|${r.external_id}`));
  const fresh = rows.filter((r) => !known.has(`${r.source}|${r.external_id}`));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("leads")
      .upsert(rows.slice(i, i + 500), { onConflict: "source,external_id" });
    if (error) throw new Error(error.message);
  }

  // Dropped off a source that answered: mark gone (kept for history; hidden by default).
  let gone = 0;
  for (const source of fetchedSources) {
    const ids = rows.filter((r) => r.source === source).map((r) => r.external_id);
    const { data: g, error } = await admin
      .from("leads")
      .update({ gone_at: new Date().toISOString() })
      .eq("source", source)
      .is("gone_at", null)
      .not("external_id", "in", `(${ids.map((x) => `"${x.replace(/"/g, '\\"')}"`).join(",")})`)
      .select("id");
    if (error) throw new Error(error.message);
    gone += g?.length ?? 0;
  }

  const newRoof = fresh.filter((r) => r.is_roof);
  let notified = 0;
  if (newRoof.length) {
    const { data: ids } = await admin.rpc("prospect_user_ids");
    if (ids?.length) {
      const top = newRoof
        .slice(0, 3)
        .map((r) => describeLead(r))
        .join("; ");
      notified = await notify(
        ids,
        {
          kind: "lead",
          title: `${newRoof.length} new roof lead${newRoof.length === 1 ? "" : "s"}`,
          body: `${top}${newRoof.length > 3 ? "; …" : ""}`,
          url: "/prospect/leads?roof=1",
        },
        admin,
      );
    }
  }
  const note = `${planroomCount} planroom, ${louisvilleCount} Louisville, ${fresh.length} new (${newRoof.length} roof), ${gone} gone${failed.length ? `; ${failed.join("; ")}` : ""}`;
  await admin.rpc("stamp_lead_fetch", { note });
  return {
    planroom: planroomCount,
    louisville: louisvilleCount,
    new_leads: fresh.length,
    new_roof_leads: newRoof.length,
    gone,
    failed,
    notified,
  };
}

/** "Jackson SOB Roof Replacement (Jackson, bids Oct 20)" for a notification line. */
export function describeLead(r: {
  title: string;
  location?: string | null;
  bid_at?: string | null;
  issued_on?: string | null;
}): string {
  const parts: string[] = [];
  if (r.location) parts.push(r.location);
  if (r.bid_at) {
    const d = new Date(r.bid_at);
    parts.push(
      `bids ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}`,
    );
  } else if (r.issued_on) {
    const d = new Date(`${r.issued_on}T12:00:00Z`);
    parts.push(
      `permit ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
    );
  }
  return parts.length ? `${r.title} (${parts.join(", ")})` : r.title;
}
