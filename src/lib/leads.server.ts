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
 * Tennessee (owner, Sep 29: "we actually cover TN as well, can we replicate what we have for
 * leads for TN?" — the whole state), checked from the sandbox Sep 29:
 *
 *   STREAM construction bid list (tn_stream)  STREAM_BID_LIST_URL
 *     The State of Tennessee Real Estate Asset Management list of every state building project
 *     out for bid (5 that day). One Bootstrap accordion item per project: the button reads
 *     "142/013-01-2022 - Name" (the SBC project number), the table under it has Project,
 *     Designer (the A/E firm, contact, phone, e-mail: who to call to bid), Description, Pre-Bid
 *     and Bid Opening rows in prose, times "Local Time (Central Time)" or "(Eastern Time)".
 *     The STREAM RFP page (CM/GC and design-build selections) is read into the same source.
 *
 *   UT system construction bids (ut_bids)  utBidsUrl(slug), one page per campus
 *     "Invitations to Bid" (a PDF link, the post date, sometimes a moved bid opening) above
 *     "Bid Results" (history: used only to close an invitation that has been opened). The
 *     site answers 403 to a bare request and 200 to a browser's headers (UT_HEADERS).
 *
 *   Metro Nashville building permits issued (nashville_permits)  NASHVILLE_PERMITS_LAYER
 *     ArcGIS REST, no key: Permit__, Permit_Type_Description ("Building Commercial - New"),
 *     Permit_Subtype_Description, Date_Issued (epoch ms), Const_Cost, Address, City, ZIP,
 *     Contact, Purpose (free-text scope), Lat, Lon. No square footage: filtered on cost.
 *
 *   SAM.gov: the daily pull asks for Kentucky and Tennessee (two requests, one daily slot).
 *
 * Tennessee, round two (owner, Sep 29: bring Tennessee up to Kentucky's coverage — the other
 * cities, the schools and universities, a statewide feed), checked from the sandbox Sep 29:
 *
 *   BidNet Direct purchasing groups (bidnet)  BIDNET_GROUPS, TN and KY
 *     Cities, counties, school districts and utilities statewide post their solicitations
 *     there; the open list is public (25 a page: 272 TN, 183 KY that day), the issuing agency,
 *     number and documents are members-only. Read once a day behind the source_fetched_at
 *     gate, one page at a time; BidNet answers some requests with an AWS WAF robot check,
 *     which is skipped (never solved or retried) and reported.
 *
 *   Chattanooga permits (chattanooga_permits)  CHATTANOOGA_PERMITS_LAYER
 *     The Chattanooga-Hamilton County RPA's building permits (ArcGIS REST, no key): new
 *     construction only, a month or two behind; new non-residential over the Nashville cost
 *     floor in the last 180 days.
 *
 *   Knox County solicitations (knox_county_bids)  KNOX_COUNTY_BIDS_URL
 *     One HTML table: title, number, deadline day, buyer, the solicitation PDF, a pre-bid note.
 *
 *   TN university bid lists (tn_university_bids)  TN_UNIVERSITIES
 *     ETSU, Tennessee Tech, Austin Peay, MTSU and TBR (community colleges, TCATs, TSU): the
 *     designer to call, pre-bid and bid opening times, the invitation PDF.
 *
 * Tennessee, round three (Sep 29): Metro Nashville's and the City of Chattanooga's own bid lists
 * (nashville_bids, chattanooga_bids) sit in Oracle Cloud procurement portals that only render in
 * a browser. A nightly GitHub Actions job reads them in headless Chromium and posts the rows to
 * /api/cron/leads-import (importBrowserBids below; src/lib/leads-browser.ts has the portals).
 * refreshLeads never pulls them, so it never marks them gone either.
 *
 * refreshLeads: pull them all, upsert on (source, external_id) keeping the team's status, mark
 * what dropped off the source as gone, and tell Prospecting users about new roof leads.
 * Nothing here touches bids.
 */
import type { Database, Json } from "@/integrations/supabase/types";
import {
  BROWSER_PORTALS,
  currentRounds,
  negotiationRound,
  type BrowserImportPayload,
  type BrowserSource,
  type PortalRow,
} from "@/lib/leads-browser";
import { notify, serverClient, type Client } from "@/lib/notify.server";

export type LeadSource =
  | "ky_planroom"
  | "louisville_permits"
  | "lynn_bids"
  | "bgky_bids"
  | "paducah_bids"
  | "campus_planrooms"
  | "sam_gov"
  | "tn_stream"
  | "ut_bids"
  | "nashville_permits"
  | "bidnet"
  | "chattanooga_permits"
  | "knox_county_bids"
  | "tn_university_bids"
  // Round three: read by the nightly browser job and posted to /api/cron/leads-import.
  | "nashville_bids"
  | "chattanooga_bids";
type LeadInsert = Database["public"]["Tables"]["leads"]["Insert"];
type SettingsRow = Database["public"]["Tables"]["lead_settings"]["Row"];

export const PLANROOM_URL = "https://www.stateofkyplanroom.com/";
// The list links "ViewJob.aspx?job_id=N" relative to /View/ (the root redirects there); the
// job page asks for a free planroom sign-in. Owner, Sep 29: the bare path was a 404.
export const planroomJobUrl = (jobId: string) =>
  `https://www.stateofkyplanroom.com/View/ViewJob.aspx?job_id=${jobId}`;
export const LOUISVILLE_PERMITS_LAYER =
  "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/active_construction_permits/FeatureServer/0";
export const LOUISVILLE_PERMITS_PAGE =
  "https://data.louisvilleky.gov/datasets/LOJIC::louisville-metro-ky-active-construction-permits/explore";
/**
 * Where a permit card goes: the open-data explorer cannot deep-link one permit (owner, Sep 29:
 * "just pulls up this map") and Google Maps is blocked on the owner's network, so the card
 * opens the site on the app's own Buildings map (outlines on, ready to tap) when the permit
 * carries a point; a permit without one searches the Buildings list for its address.
 */
export function permitSiteUrl(p: {
  LATITUDE: number | null;
  LONGITUDE: number | null;
  ADDRESS: string | null;
  CITY: string | null;
}): string {
  if (p.LATITUDE != null && p.LONGITUDE != null) return `/prospect?at=${p.LATITUDE},${p.LONGITUDE}`;
  // No point: search the Buildings list for the address (outside map sites are blocked there).
  return `/prospect?q=${encodeURIComponent((p.ADDRESS ?? "").trim())}`;
}

/**
 * Lynn Imaging's public bids list (owner, Sep 29): the reprographics planroom behind the state's,
 * posting every project it prints plans for — housing authorities, cities, counties, water
 * districts, colleges, hospitals, churches — the day plans go out for bid. WordPress RSS: title,
 * link, pubDate, and the scope paragraph with "Project Location:" and a "More Details" link to
 * the job in Lynn's planroom (ViewJob.aspx?job_id=N, browser session needed).
 */
export const LYNN_FEED_URL = "https://www.lynnimaging.com/bids/feed/";
export const lynnJobUrl = (jobId: string) =>
  `https://www.lynnimaging.com/distribution/View/ViewJob.aspx?job_id=${jobId}`;
/** Bowling Green's bids page: an "Open Opportunities" table (title → Bonfire, posted date). */
export const BGKY_BIDS_URL = "https://www.bgky.org/bids";
/** Paducah's bids page: "Active Requests for Bids or Proposals", one heading per request. */
export const PADUCAH_BIDS_URL = "https://paducahky.gov/request-bids-or-proposals";

/**
 * The other Lynn-run planrooms the owner's one login covers (Sep 29): universities and school
 * districts, each with a public job list in the state planroom's exact format. The row's
 * "Company Name" is whoever issued the plans (the institution, or the construction manager /
 * architect running the bid — the party a roofing sub bids to).
 */
export const CAMPUS_PLANROOMS: { domain: string; label: string }[] = [
  { domain: "ukplanroom.com", label: "University of Kentucky" },
  { domain: "wkuplanroom.com", label: "Western Kentucky University" },
  { domain: "nkuplanroom.com", label: "Northern Kentucky University" },
  { domain: "ekuplanroom.com", label: "Eastern Kentucky University" },
  { domain: "uoflplanroom.com", label: "University of Louisville" },
  { domain: "jcpsplanroom.com", label: "Jefferson County Public Schools" },
  { domain: "kctcsplanroom.com", label: "KCTCS" },
];
export const campusListUrl = (domain: string) =>
  `https://www.${domain}/View/ViewJobList.aspx?group_id=public_all`;
export const campusJobUrl = (domain: string, jobId: string) =>
  `https://www.${domain}/View/ViewJob.aspx?job_id=${jobId}`;

/**
 * SAM.gov contract opportunities (federal: Fort Knox, Fort Campbell, the VA, the Corps'
 * Louisville District). Get Opportunities v2: postedFrom/postedTo MM/dd/yyyy (required, ≤ 1
 * year apart), ncode = NAICS, state = place of performance, ptype o/p/k = solicitation,
 * pre-solicitation, combined synopsis. Needs SAM_GOV_API_KEY (the owner's, ~10 calls a day on
 * a personal key): one call a run.
 */
export const SAM_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
export const SAM_NAICS_ROOFING = "238160";

/** Both states SAM.gov is asked about in the one daily pull. */
export const SAM_STATES = ["KY", "TN"] as const;

/**
 * Tennessee's STREAM office (General Services): the construction bid list and the RFP page.
 * The bid list has no page per project, so a lead links the list with the SBC number after #.
 */
export const STREAM_BID_LIST_URL =
  "https://www.tn.gov/generalservices/stream/stream/contractors/construction-bid-list.html";
export const STREAM_RFP_URL =
  "https://www.tn.gov/generalservices/stream/stream/contractors/requests-for-proposal--rfps-.html";

/** The UT system's capital projects office: one bids page per campus. */
export const UT_BIDS_BASE =
  "https://tennessee.edu/about/divisions/finance-admin/capital-projects/construction-opportunities/";
export const utBidsUrl = (slug: string) => `${UT_BIDS_BASE}${slug}-bids/`;
export type UsZone = "ET" | "CT";
export interface UtCampus {
  slug: string;
  label: string;
  city: string;
  county: string;
  /** The campus's clock, for a bid time the page states without a zone. */
  zone: UsZone;
}
export const UT_CAMPUSES: UtCampus[] = [
  { slug: "utk", label: "UT Knoxville", city: "Knoxville", county: "Knox", zone: "ET" },
  { slug: "utc", label: "UT Chattanooga", city: "Chattanooga", county: "Hamilton", zone: "ET" },
  {
    slug: "uthsc",
    label: "UT Health Science Center",
    city: "Memphis",
    county: "Shelby",
    zone: "CT",
  },
  {
    slug: "utia",
    label: "UT Institute of Agriculture",
    city: "Knoxville",
    county: "Knox",
    zone: "ET",
  },
  {
    slug: "ips",
    label: "UT Institute for Public Service",
    city: "Knoxville",
    county: "Knox",
    zone: "ET",
  },
  { slug: "utm", label: "UT Martin", city: "Martin", county: "Weakley", zone: "CT" },
  { slug: "uts", label: "UT Southern", city: "Pulaski", county: "Giles", zone: "CT" },
];
/** tennessee.edu answers 403 to a bare request (checked Sep 29) and 200 to a browser's headers. */
export const UT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Metro Nashville Codes: building permits issued (Nashville open data, ArcGIS REST, no key). */
export const NASHVILLE_PERMITS_LAYER =
  "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0";

const UA = "JBK Portal construction leads";
/**
 * Every outside call gives up after 25 s so one slow site cannot hang the whole run (Lynn's feed
 * has taken 15 s). `headers` add to (or replace) the default User-Agent.
 */
const fetchTimeout = (url: string, ms = 25000, headers: Record<string, string> = {}) =>
  fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(ms) });

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

/**
 * A wall-clock time in US Eastern or Central → ISO instant. Central (America/Chicago) switches
 * on the same local 2:00 a.m. dates as Eastern and sits one hour further from UTC.
 */
function zonedIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: UsZone,
): string {
  const standard = zone === "ET" ? 5 : 6;
  const offset = isUsDaylightTime(year, month, day, hour) ? standard - 1 : standard;
  return new Date(Date.UTC(year, month, day, hour + offset, minute)).toISOString();
}

function parseNumericDate(text: string, zone: UsZone): string | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(text);
  if (!m) return null;
  let hour = m[4] ? Number(m[4]) % 12 : 0;
  if (m[6]?.toUpperCase() === "PM") hour += 12;
  return zonedIso(
    Number(m[3]),
    Number(m[1]) - 1,
    Number(m[2]),
    hour,
    m[5] ? Number(m[5]) : 0,
    zone,
  );
}

/** "10/20/2026 01:30 PM ET" → ISO instant (Eastern, daylight or standard by date). */
export function parseEasternDate(text: string): string | null {
  return parseNumericDate(text, "ET");
}

/** "10/20/2026 01:30 PM" read as Central time (Nashville, Memphis, West Tennessee). */
export function parseCentralDate(text: string): string | null {
  return parseNumericDate(text, "CT");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date written out, as the Tennessee pages do, → ISO instant:
 *   "At 9:00 a.m. Local Time (Central Time) on Thursday, October 1, 2026"
 *   "on Wednesday, August 26, 2026 at 10:30 a.m. Local Time (Eastern Time)."
 *   "Bid Opening has been moved to Friday, February 27th at 2:00 pm ET" (no year: the first
 *   such date on or after `ref`, the day it was posted).
 * The zone is the one the text names (Eastern Time / ET / EST / EDT, Central Time / CT / CST /
 * CDT), else `zone`. No time of day → midnight local. Null when there is no date.
 */
export function parseWrittenDateTime(text: string, zone: UsZone, ref?: Date): string | null {
  const d =
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i.exec(
      text,
    );
  if (!d) return null;
  const month = MONTHS.indexOf(d[1]!.slice(0, 3).toLowerCase());
  const day = Number(d[2]);
  let year: number;
  if (d[3]) year = Number(d[3]);
  else if (ref) {
    year = ref.getUTCFullYear();
    // Written without a year: the next such date from the reference day.
    if (Date.UTC(year, month, day) < Date.UTC(year, ref.getUTCMonth(), ref.getUTCDate())) year++;
  } else return null;
  const check = new Date(Date.UTC(year, month, day));
  if (check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  let hour = 0;
  let minute = 0;
  const t = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/i.exec(text);
  if (t) {
    hour = (Number(t[1]) % 12) + (t[3]!.toLowerCase() === "p" ? 12 : 0);
    minute = t[2] ? Number(t[2]) : 0;
  } else if (/\bnoon\b/i.test(text)) hour = 12;
  const eastern = /\bEastern(?:\s+(?:Standard|Daylight))?\s+Time\b|\bE[SD]?T\b/.exec(text);
  const central = /\bCentral(?:\s+(?:Standard|Daylight))?\s+Time\b|\bC[SD]?T\b/.exec(text);
  let z = zone;
  if (eastern && (!central || eastern.index < central.index)) z = "ET";
  else if (central) z = "CT";
  return zonedIso(year, month, day, hour, minute, z);
}

/** The calendar day ("2026-09-25") an instant falls on in US Eastern or Central time. */
function zoneDay(ms: number, zone: UsZone): string {
  const offset = zone === "ET" ? 5 : 6;
  const std = new Date(ms - offset * 3600000);
  const daylight = isUsDaylightTime(
    std.getUTCFullYear(),
    std.getUTCMonth(),
    std.getUTCDate(),
    std.getUTCHours(),
  );
  return new Date(daylight ? ms - (offset - 1) * 3600000 : std.getTime())
    .toISOString()
    .slice(0, 10);
}

/** The calendar day ("2026-09-25") an instant falls on in Central time. */
export function centralDay(ms: number): string {
  return zoneDay(ms, "CT");
}

/** The calendar day an instant falls on in Eastern time (Chattanooga, Knoxville). */
export function easternDay(ms: number): string {
  return zoneDay(ms, "ET");
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
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
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
    const res = await fetchTimeout(louisvilleQueryUrl(s, offset));
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
 * Lynn Imaging bids (RSS)
 * ---------------------------------------------------------------------------------------------- */

export interface LynnPost {
  /** Lynn's planroom job id when the post links one; else the post's own URL. */
  id: string;
  title: string;
  postUrl: string;
  jobUrl: string | null;
  location: string | null;
  scope: string;
  postedAt: string | null;
}

const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? cdata(m[1]!) : null;
};

/** One post per <item>; the scope is the content with its tags dropped. */
export function parseLynnFeed(xml: string): LynnPost[] {
  const out: LynnPost[] = [];
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const title = decode(tag(item, "title") ?? "");
    const postUrl = (tag(item, "link") ?? "").trim();
    if (!title || !postUrl) continue;
    const content = tag(item, "content:encoded") ?? tag(item, "description") ?? "";
    const job = /ViewJob\.aspx\?job_id=(\d+)/.exec(content);
    const text = decode(content.replace(/<br\s*\/?>|<\/p>/gi, "\n"))
      .replace(/More Details\s*$/i, "")
      .trim();
    const loc = /Project Location:\s*([^\n]+?)(?:\s+More Details)?\s*$/im.exec(text);
    const pub = tag(item, "pubDate");
    const posted = pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null;
    // The scope without the repeated title line and the location line.
    const scope = text
      .replace(title, "")
      .replace(/Project Location:[^\n]*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    out.push({
      id: job ? job[1]! : postUrl,
      title,
      postUrl,
      jobUrl: job ? lynnJobUrl(job[1]!) : null,
      location: loc ? loc[1]!.trim() : null,
      scope,
      postedAt: posted,
    });
  }
  return out;
}

export function lynnLead(p: LynnPost, keywords: string[]): LeadInsert {
  // "Owner – Project" is Lynn's title convention; the owner becomes the agency.
  const dash = p.title.split(/\s[–—-]\s/);
  const agency = dash.length > 1 ? dash[0]!.trim() : null;
  const town = (p.location ?? "").replace(/,?\s*(Kentucky|KY)\s*$/i, "").trim() || null;
  return {
    source: "lynn_bids",
    external_id: p.id,
    title: p.title,
    agency,
    location: town,
    city: town,
    project_type: null,
    url: p.jobUrl ?? p.postUrl,
    note: null,
    is_roof: isRoofLead(`${p.title} ${p.scope}`, keywords),
    raw: { ...p } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Bowling Green and Paducah city bid pages (HTML)
 * ---------------------------------------------------------------------------------------------- */

export interface CityBid {
  id: string;
  title: string;
  url: string;
  postedAt: string | null;
  scope: string | null;
  /** Due date text when the page states one ("October 13"), left as written. */
  dueText: string | null;
  /** Who to ask: "Melanie Townsend, Engineering Project Manager — mtownsend@paducahky.gov — 270-444-8690". */
  contact: string | null;
}

/** "Sep 21, 2026" / "September 21, 2026" → ISO date, else null. */
export function parseLongDate(text: string): string | null {
  const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (!m) return null;
  const t = Date.parse(`${m[1]} ${m[2]}, ${m[3]} 12:00:00 UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * Bowling Green: the rows of the table under the "Open Opportunities" heading. The title cell
 * reads "Reference #: 2027-11. Name: Parking Lot Overlay - Police East Precinct" and links the
 * Bonfire opportunity; the second cell is the posted date.
 */
export function parseBgkyBids(html: string): CityBid[] {
  const start = html.search(/Open Opportunities/i);
  if (start < 0) return [];
  const table = /<table[\s\S]*?<\/table>/i.exec(html.slice(start));
  if (!table) return [];
  const out: CityBid[] = [];
  for (const row of table[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const link = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!link) continue;
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
    const raw = decode(link[2]!);
    const m = /Reference\s*#:\s*([^.]+)\.\s*Name:\s*(.+)$/i.exec(raw);
    const id = m ? m[1]!.trim() : link[1]!.trim();
    const title = m ? m[2]!.trim() : raw;
    out.push({
      id,
      title,
      url: link[1]!.trim(),
      postedAt: cells[1] ? parseLongDate(decode(cells[1])) : null,
      scope: null,
      dueText: null,
      contact: null,
    });
  }
  return out;
}

/**
 * Paducah: the headings under "Active Requests for Bids or Proposals" (each an <h4>), with the
 * paragraphs up to the next heading as the scope and any "received no later than …" sentence
 * as the due-date text. The first linked PDF in the block is the packet.
 */
export function parsePaducahBids(html: string): CityBid[] {
  const start = html.search(/Active Requests for Bids or Proposals/i);
  if (start < 0) return [];
  const body = html.slice(start);
  const out: CityBid[] = [];
  const parts = body.split(/<h4[^>]*>/i).slice(1);
  for (const part of parts) {
    const end = part.search(/<\/h4>/i);
    if (end < 0) continue;
    const title = decode(part.slice(0, end));
    if (!title || /^Bid Results/i.test(title)) continue;
    let rest = part.slice(end + 5);
    const stop = rest.search(/<h[1-3][^>]*>/i);
    if (stop >= 0) rest = rest.slice(0, stop);
    const pdf = /<a[^>]*href="([^"]+\.pdf)"/i.exec(rest);
    // The site hides e-mail addresses as "name<span …-image></span>domain": put the @ back.
    const text = decode(
      rest.replace(/<span[^>]*-image"[^>]*><\/span>/gi, "@").replace(/<\/p>/gi, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
    const who =
      /(?:directed to|contact)\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3}(?:,\s*[^,.@]{3,60}?)?)(?=,?\s+(?:at|by|via)\b|\.|,\s*at\b)/.exec(
        text,
      );
    const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(text);
    const phones = [...new Set(text.match(/\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/g) ?? [])];
    const contact =
      [who?.[1]?.trim(), email?.[0], phones.slice(0, 2).join(" / ")].filter(Boolean).join(" — ") ||
      null;
    // "…received no later than 4:30 p.m. CT on Tuesday, October 13." — the sentence ends at
    // the period followed by a new sentence, not at the one inside "p.m.".
    // (Case-sensitive on purpose: the lookahead must not treat "p.m. CT" as a sentence end.)
    const due = /(?:[Rr]eceived|[Ss]ubmitted)[^.]*?no later than.*?\.(?=\s+[A-Z][a-z]|\s*$)/.exec(
      text,
    );
    const first = /^.*?\.(?=\s+[A-Z][a-z]|\s*$)/.exec(text);
    const scope = (first ? first[0] : text).slice(0, 400) || null;
    out.push({
      id: title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 120),
      title,
      url: pdf ? new URL(pdf[1]!, PADUCAH_BIDS_URL).href : PADUCAH_BIDS_URL,
      postedAt: null,
      scope,
      dueText: due ? due[0].trim() : null,
      contact,
    });
  }
  return out;
}

export function cityLead(
  b: CityBid,
  source: "bgky_bids" | "paducah_bids",
  keywords: string[],
): LeadInsert {
  const city = source === "bgky_bids" ? "Bowling Green" : "Paducah";
  const county = source === "bgky_bids" ? "Warren" : "McCracken";
  return {
    source,
    external_id: b.id,
    title: b.title,
    agency: `City of ${city}`,
    location: city,
    city,
    county,
    url: b.url,
    issued_on: b.postedAt,
    contact: b.contact,
    is_roof: isRoofLead(`${b.title} ${b.scope ?? ""}`, keywords),
    raw: { ...b } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Tennessee: STREAM (state building projects)
 * ---------------------------------------------------------------------------------------------- */

export interface StreamProject {
  /** "bid": the construction bid list; "rfp": the RFP page (CM/GC, design-build selections). */
  kind: "bid" | "rfp";
  /** The SBC project number, "142/013-01-2022". */
  sbc: string;
  name: string;
  /** "Bledsoe County Correctional Complex". */
  facility: string | null;
  /** The RFP page's AGENCY column ("Military"). */
  agency: string | null;
  city: string | null;
  /** "Bledsoe" (without "County"). */
  county: string | null;
  description: string | null;
  /** The designer (A/E firm) running the bid, and its contact. */
  designer: string | null;
  designerContact: string | null;
  designerPhone: string | null;
  designerEmail: string | null;
  prebidText: string | null;
  prebidAt: string | null;
  bidText: string | null;
  bidAt: string | null;
  /** RFP page: the first attachment (the RFP document). */
  documentUrl: string | null;
}

/** A cell's lines: one per <p> or <br>, tags dropped, blanks skipped. */
const cellLines = (html: string): string[] =>
  html
    .split(/<\/p>|<br\s*\/?>|<\/li>/i)
    .map((x) => decode(x))
    .filter(Boolean);

/** "Pikeville, Bledsoe County, Tennessee" → town and county. */
function tnPlace(line: string | undefined): { city: string | null; county: string | null } {
  if (!line) return { city: null, county: null };
  const county = /([A-Z][\w .'-]*?)\s+County\b/i.exec(line);
  const city = line.split(",")[0]!.trim();
  return {
    city: city && !/County\b/i.test(city) && !/^Tennessee$/i.test(city) ? city : null,
    county: county ? county[1]!.trim() : null,
  };
}
const isPlaceLine = (l: string) => /\bCounty\b.*\bTennessee\b|,\s*(Tennessee|TN)\s*$/i.test(l);

/**
 * The bid list: one project per accordion item. Labels are matched loosely ("Bid Opening
 * (WebEx):" and "Bid Opening (WebEx) :" both occur). Times default to Central (the bid
 * openings are held in Nashville); a line that says Eastern Time is read as Eastern.
 */
export function parseStreamBidList(html: string): StreamProject[] {
  const out: StreamProject[] = [];
  const seen = new Set<string>();
  for (const item of html.split(/<div[^>]*class="accordion-item"[^>]*>/i).slice(1)) {
    const button = /<button[^>]*accordion-button[^>]*>([\s\S]*?)<\/button>/i.exec(item);
    if (!button) continue;
    const heading = decode(button[1]!);
    const cells: Record<string, string> = {};
    for (const row of item.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const th = /<th[^>]*>([\s\S]*?)<\/th>/i.exec(row);
      if (!th) continue;
      const label = decode(th[1]!)
        .toLowerCase()
        .replace(/\(.*?\)/g, "")
        .replace(/[\s:]+/g, " ")
        .trim();
      const td = row.slice(th.index + th[0].length).match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
      const body = td.map((c) => c.replace(/^<td[^>]*>|<\/td>$/gi, "")).join("</p>");
      const key = label.startsWith("project")
        ? "project"
        : label.startsWith("designer")
          ? "designer"
          : label.startsWith("description")
            ? "description"
            : /^pre-?\s?bid/.test(label)
              ? "prebid"
              : /^bid (opening|date)/.test(label)
                ? "bid"
                : null;
      if (key && !(key in cells)) cells[key] = body;
    }
    const project = cellLines(cells["project"] ?? "");
    const head = /^(\S+)\s+[-–—]\s+(.+)$/.exec(heading);
    const sbcLine = project.find((l) => /SBC Project No/i.test(l));
    const sbc =
      (sbcLine ? /SBC Project No\.?\s*:?\s*(\S+)/i.exec(sbcLine)?.[1] : null) ??
      (head ? head[1]! : null);
    if (!sbc || seen.has(sbc)) continue;
    seen.add(sbc);
    const name = project[0] ?? (head ? head[2]!.trim() : heading);
    const placeLine = project.find(isPlaceLine);
    const facility =
      project.slice(1).find((l) => l !== placeLine && l !== sbcLine && l !== name) ?? null;
    const designer = cellLines(cells["designer"] ?? "");
    const field = (re: RegExp) => {
      const l = designer.find((x) => re.test(x));
      return l ? l.replace(re, "").trim() || null : null;
    };
    const email =
      /mailto:([^"'>\s]+)/i.exec(cells["designer"] ?? "")?.[1] ?? field(/^E-?mail\s*:\s*/i);
    const prebidText = decode(cells["prebid"] ?? "") || null;
    const bidLines = cellLines(cells["bid"] ?? "");
    const bidText =
      bidLines.find((l) => /\b\d{4}\b/.test(l) && /[A-Z][a-z]+\.?\s+\d{1,2}/.test(l)) ??
      bidLines[0] ??
      null;
    out.push({
      kind: "bid",
      sbc,
      name,
      facility,
      agency: null,
      ...tnPlace(placeLine),
      description: decode(cells["description"] ?? "") || null,
      designer:
        designer.find((l) => !/^(Contact|Phone|Fax|E-?mail)\b/i.test(l))?.replace(/\s+/g, " ") ??
        null,
      designerContact: field(/^Contact\s*:\s*/i),
      designerPhone: field(/^Phone\s*:\s*/i),
      designerEmail: email ? decodeURIComponent(email) : null,
      prebidText,
      prebidAt: prebidText ? parseWrittenDateTime(prebidText, "CT") : null,
      bidText,
      bidAt: bidText ? parseWrittenDateTime(bidText, "CT") : null,
      documentUrl: null,
    });
  }
  return out;
}

/**
 * The RFP page: one table, columns found by their headings (SBC No., AGENCY, PROJECT TITLE,
 * ATTACHMENTS); the title cell's second line is the place. No dates on the list (they are in
 * the RFP document).
 */
export function parseStreamRfps(html: string): StreamProject[] {
  const table = /<table[\s\S]*?<\/table>/gi;
  const out: StreamProject[] = [];
  for (const t of html.match(table) ?? []) {
    const heads = (t.match(/<th[^>]*>[\s\S]*?<\/th>/gi) ?? []).map((h) => decode(h).toLowerCase());
    const col = (re: RegExp) => heads.findIndex((h) => re.test(h));
    const iSbc = col(/sbc/);
    const iTitle = col(/title/);
    if (iSbc < 0 || iTitle < 0) continue;
    const iAgency = col(/agency/);
    const iFiles = col(/attach/);
    for (const row of t.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
      const sbc = decode(cells[iSbc] ?? "");
      if (!sbc) continue;
      const lines = cellLines((cells[iTitle] ?? "").replace(/^<td[^>]*>/i, ""));
      const name = lines[0];
      if (!name) continue;
      const href = /<a[^>]*href="([^"]+)"/i.exec(cells[iFiles] ?? "")?.[1];
      out.push({
        kind: "rfp",
        sbc,
        name,
        facility: null,
        agency: iAgency >= 0 ? decode(cells[iAgency] ?? "") || null : null,
        ...tnPlace(lines.find(isPlaceLine)),
        description:
          lines
            .slice(1)
            .filter((l) => !isPlaceLine(l))
            .join(" ") || null,
        designer: null,
        designerContact: null,
        designerPhone: null,
        designerEmail: null,
        prebidText: null,
        prebidAt: null,
        bidText: null,
        bidAt: null,
        documentUrl: href ? new URL(decode(href), STREAM_RFP_URL).href : null,
      });
    }
  }
  return out;
}

export function streamLead(p: StreamProject, keywords: string[]): LeadInsert {
  const rfp = p.kind === "rfp";
  return {
    source: "tn_stream",
    // An RFP (CM/GC selection) and the later bid for the same SBC number are two leads.
    external_id: rfp ? `rfp:${p.sbc}` : p.sbc,
    title: p.name,
    agency: p.facility ?? (p.agency ? `State of Tennessee — ${p.agency}` : "State of Tennessee"),
    location: [p.city, p.county ? `${p.county} County` : null].filter(Boolean).join(", ") || null,
    city: p.city,
    county: p.county,
    state: "TN",
    project_type: rfp ? "Request for proposals" : null,
    contractor: p.designer,
    // The designer runs the bid: who to ask for the documents and to bid to.
    contact: rfp
      ? null
      : [p.designer, p.designerContact, p.designerPhone, p.designerEmail]
          .filter(Boolean)
          .join(" — ") || null,
    prebid_at: p.prebidAt,
    bid_at: p.bidAt,
    url: rfp ? (p.documentUrl ?? STREAM_RFP_URL) : `${STREAM_BID_LIST_URL}#${p.sbc}`,
    is_roof: isRoofLead(`${p.name} ${p.description ?? ""}`, keywords),
    raw: { ...p } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Tennessee: UT system campus bid pages
 * ---------------------------------------------------------------------------------------------- */

export interface UtBid {
  /** The PDF's file name ("UTK-Frieson-Center-Reno-Expansion-Invitation-to-Bid-FINAL.pdf"). */
  id: string;
  title: string;
  /** The invitation PDF (or the campus page when the entry has no link). */
  url: string;
  /** "2026-08-19". */
  postedAt: string | null;
  /** The entry's sub-bullets as written. */
  notes: string[];
  bidText: string | null;
  bidAt: string | null;
  /** The bid date came from the page's own Bid Results list (the bid has been opened). */
  closedByResult: boolean;
  /** "UT Capital Projects — Knoxville office 865-974-2231" when the page shows it. */
  contact: string | null;
}

/** The top-level <li> items of a list block, each with its own nested items' text. */
function listItems(block: string): { head: string; notes: string[] }[] {
  const out: { head: string; notes: string[] }[] = [];
  let depth = 0;
  let cur: { head: string; notes: string[]; buf: string } | null = null;
  let note: string | null = null;
  for (const tok of block.split(/(<\/?(?:ul|ol|li)\b[^>]*>)/i)) {
    const t = tok.toLowerCase();
    if (/^<(ul|ol)\b/.test(t)) depth++;
    else if (/^<\/(ul|ol)/.test(t)) depth--;
    else if (/^<li\b/.test(t)) {
      if (depth === 1) cur = { head: "", notes: [], buf: "" };
      else if (cur) note = "";
    } else if (/^<\/li/.test(t)) {
      if (depth === 1 && cur) {
        out.push({ head: cur.head, notes: cur.notes });
        cur = null;
      } else if (cur && note !== null) {
        const n = decode(note);
        if (n) cur.notes.push(n);
        note = null;
      }
    } else if (cur) {
      if (depth === 1) cur.head += tok;
      else if (note !== null) note += tok;
    }
  }
  return out;
}

/** The HTML from the <h2> whose text matches `re` up to the next <h2> (or the end of <main>). */
function h2Section(html: string, re: RegExp): string | null {
  const heads = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  const i = heads.findIndex((h) => re.test(decode(h[1]!)));
  if (i < 0) return null;
  const start = heads[i]!.index! + heads[i]![0].length;
  const next = heads[i + 1]?.index ?? html.length;
  const main = html.indexOf("</main>", start);
  return html.slice(start, main >= 0 ? Math.min(next, main) : next);
}

/**
 * One campus page: the entries under "Invitations to Bid" (the "Bid Results" list below it is
 * history; an invitation that shows up there, bid on or after it was posted, takes that bid
 * date so it reads as closed). A sub-bullet that moves the bid opening ("moved from X to Y")
 * gives the bid time (the Y); dates without a zone are the campus's.
 */
export function parseUtBids(html: string, campus: UtCampus): UtBid[] {
  const section = h2Section(html, /Invitations? to Bid/i);
  if (section === null) return [];
  const office = /<h3>\s*([A-Z][\w ]*?) Offices?\s*<\/h3>[\s\S]{0,400}?(\d{3}-\d{3}-\d{4})/i.exec(
    html,
  );
  const contact = office ? `UT Capital Projects — ${office[1]} office ${office[2]}` : null;
  const results = new Map<string, string>();
  for (const r of listItems(h2Section(html, /Bid Results/i) ?? "")) {
    const title = decode(r.head);
    const date = r.notes.find((n) => /Bid Date/i.test(n));
    if (title && date) results.set(normTitle(title), date.replace(/^.*?Bid Date\s*:?\s*/i, ""));
  }
  const out: UtBid[] = [];
  const seen = new Set<string>();
  for (const item of listItems(section)) {
    const link = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(item.head);
    if (!link) continue; // "No information available at this time."
    const title = decode(link[2]!);
    if (!title) continue;
    const url = new URL(decode(link[1]!), utBidsUrl(campus.slug)).href;
    const file = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    const id = /\.\w{2,4}$/.test(file)
      ? file
      : title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 120);
    if (seen.has(id)) continue;
    seen.add(id);
    const posted = item.notes.find((n) => /Post(ed)?\s+Date/i.test(n));
    const postedAt = posted ? parseLongDate(posted) : null;
    const ref = postedAt ? new Date(`${postedAt}T12:00:00Z`) : undefined;
    let bidText: string | null = null;
    let bidAt: string | null = null;
    for (const n of item.notes) {
      if (n === posted || !/\bbid|opening|due\b/i.test(n)) continue;
      // "moved from March 10, 2026 to March 12, 2026 at 2:00 pm CT" → the new date.
      const moved = /\bfrom\b[\s\S]*?\bto\s+([\s\S]+)$/i.exec(n);
      const at = parseWrittenDateTime(moved ? moved[1]! : n, campus.zone, ref);
      if (at) {
        bidText = n;
        bidAt = at;
        break;
      }
    }
    let closedByResult = false;
    const result = results.get(normTitle(title));
    if (!bidAt && result) {
      const at = parseWrittenDateTime(result, campus.zone, ref);
      if (at && (!postedAt || at.slice(0, 10) >= postedAt)) {
        bidText = `Bid Date: ${result}`;
        bidAt = at;
        closedByResult = true;
      }
    }
    out.push({
      id,
      title,
      url,
      postedAt,
      notes: item.notes,
      bidText,
      bidAt,
      closedByResult,
      contact,
    });
  }
  return out;
}

export function utLead(b: UtBid, campus: UtCampus, keywords: string[]): LeadInsert {
  return {
    source: "ut_bids",
    external_id: `${campus.slug}:${b.id}`,
    title: b.title,
    agency: campus.label,
    location: campus.city,
    city: campus.city,
    county: campus.county,
    state: "TN",
    bid_at: b.bidAt,
    issued_on: b.postedAt,
    url: b.url,
    contact: b.contact,
    is_roof: isRoofLead(b.title, keywords),
    raw: { ...b, campus: campus.slug, page: utBidsUrl(campus.slug) } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Tennessee: Metro Nashville building permits
 * ---------------------------------------------------------------------------------------------- */

export interface NashvillePermit {
  Permit__: string;
  Permit_Type_Description: string | null;
  Permit_Subtype_Description: string | null;
  Parcel?: string | null;
  Date_Entered?: number | null;
  Date_Issued: number | null;
  Const_Cost: number | null;
  Address: string | null;
  City: string | null;
  State?: string | null;
  Subdivision_Lot?: string | null;
  Contact: string | null;
  Purpose: string | null;
  Lon: number | null;
  Lat: number | null;
  ZIP: string | null;
  [k: string]: unknown;
}

/** The ArcGIS query: the chosen permit types, at least the minimum cost, issued in the window. */
export function nashvilleQueryUrl(
  s: Pick<SettingsRow, "nashville_types" | "nashville_min_cost" | "louisville_days">,
  offset = 0,
  now = new Date(),
): string {
  const since = new Date(now.getTime() - s.louisville_days * 86400000).toISOString().slice(0, 10);
  const types = s.nashville_types.length
    ? `Permit_Type_Description IN (${s.nashville_types.map(sqlQuote).join(",")})`
    : "1=1";
  const min = Number(s.nashville_min_cost) || 0;
  const where = `${types} AND Date_Issued >= DATE '${since}'${min > 0 ? ` AND Const_Cost >= ${min}` : ""}`;
  const q = new URLSearchParams({
    where,
    outFields: "*",
    orderByFields: "Date_Issued DESC",
    resultRecordCount: "1000",
    resultOffset: String(offset),
    returnGeometry: "false",
    f: "json",
  });
  return `${NASHVILLE_PERMITS_LAYER}/query?${q.toString()}`;
}

async function fetchNashville(s: SettingsRow): Promise<NashvillePermit[]> {
  const out: NashvillePermit[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const res = await fetchTimeout(nashvilleQueryUrl(s, offset));
    if (!res.ok) throw new Error(`→ ${res.status}`);
    const json = (await res.json()) as {
      error?: { message?: string };
      features?: { attributes: NashvillePermit }[];
      exceededTransferLimit?: boolean;
    };
    if (json.error) throw new Error(`→ ${json.error.message ?? "error"}`);
    out.push(...(json.features ?? []).map((f) => f.attributes));
    if (!json.exceededTransferLimit) break;
  }
  return out;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function nashvilleLead(p: NashvillePermit, keywords: string[]): LeadInsert {
  const type = (p.Permit_Type_Description ?? "").trim();
  const subtype = (p.Permit_Subtype_Description ?? "").trim();
  const purpose = (p.Purpose ?? "").replace(/\s+/g, " ").trim();
  const address = (p.Address ?? "").trim();
  const city = (p.City ?? "").trim();
  const name = (p.Contact ?? "").trim();
  // The scope text often ends with the applicant's phone and e-mail ("Poc: … 615-704-4478 …").
  const phone = /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/.exec(purpose)?.[0] ?? null;
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(purpose)?.[0] ?? null;
  const sf = /(\d[\d,]{2,})\s*(?:SF|sq\.?\s?ft|square\s+feet)\b/i.exec(purpose);
  const shortType = type.replace(/^Building\s+/i, "");
  return {
    source: "nashville_permits",
    external_id: p.Permit__,
    title: [shortType, subtype].filter(Boolean).join(" — ") || p.Permit__,
    agency: "Metro Nashville Codes",
    contractor: name || null,
    contact: [name, phone, email].filter(Boolean).join(" — ") || null,
    // "151 OLD HERMITAGE AVE, Nashville, TN 37210": the address is the permit's site.
    location: [address, city ? titleCase(city) : null, `TN${p.ZIP ? ` ${p.ZIP}` : ""}`]
      .filter(Boolean)
      .join(", "),
    county: "Davidson",
    state: "TN",
    address: address || null,
    city: city ? titleCase(city) : null,
    lat: p.Lat,
    lng: p.Lon,
    project_type: subtype || null,
    sqft: sf ? Number(sf[1]!.replace(/,/g, "")) : null,
    project_cost: p.Const_Cost,
    issued_on: p.Date_Issued ? centralDay(p.Date_Issued) : null,
    // No link (owner, Sep 29: permits are not linked to the map); the card shows the permit.
    url: null,
    // As with Louisville: a whole new commercial building (or shell / addition) is a roof to
    // bid whatever the permit is called; a roofing permit is roof work by definition.
    is_roof:
      /commercial - (new|addition|shell|roofing)/i.test(type) ||
      isRoofLead(`${subtype} ${purpose}`, keywords),
    raw: p as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Tennessee round two (Sep 29): BidNet (cities, counties and school districts, TN and KY),
 * Chattanooga permits, Knox County solicitations, the public universities' bid lists
 * ---------------------------------------------------------------------------------------------- */

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "369/005-05-2024" out of a line or a file name ("373-003-01-2026-invitation-to-bid.pdf"). */
function sbcNumber(text: string): string | null {
  const m = /\b(\d{3})[/-](\d{3}-\d{2}-\d{4}[A-Z]{0,3})\b/.exec(text);
  return m ? `${m[1]}/${m[2]}` : null;
}

const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);

/** A block of HTML as text lines: one per paragraph, heading, line break, cell or list item. */
const htmlLines = (html: string): string[] =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .split(
      /<\/p>|<p\b[^>]*>|<br\s*\/?>|<\/li>|<\/h\d>|<h\d\b[^>]*>|<\/td>|<\/th>|<\/tr>|<\/div>|<hr\b[^>]*>/i,
    )
    .map((x) => decode(x))
    .filter(Boolean);

/**
 * Lines grouped under their labels ("Pre-Bid:", "Bid Opening", …): each label's lines run to
 * the next label. A label with its value on the same line ("Contact: X") keeps the rest.
 */
function labeledBlocks(lines: string[], labels: [string, RegExp][]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const line of lines) {
    const hit = labels.find(([, re]) => re.test(line));
    if (hit) {
      cur = hit[0];
      out[cur] ??= [];
      const rest = line.replace(hit[1], "").trim();
      if (rest) out[cur]!.push(rest);
    } else if (cur) out[cur]!.push(line);
  }
  return out;
}

/**
 * The first line that carries a written date, with the next line when the time of day sits
 * there ("Wednesday, August 26 , 2026" / "at 2:00 PM, local time").
 */
function whenIn(lines: string[], zone: UsZone): { text: string; at: string } | null {
  const hasTime = (l: string) => /\b\d{1,2}(?::\d{2})?\s*[ap]\.?\s?m\b|\bnoon\b/i.test(l);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\s+,/g, ",");
    if (!parseWrittenDateTime(line, zone)) continue;
    const next = lines[i + 1];
    const text = !hasTime(line) && next && hasTime(next) ? `${line} ${next}` : line;
    const at = parseWrittenDateTime(text.replace(/\s+,/g, ","), zone);
    if (at) return { text, at };
  }
  return null;
}

const PHONE_RE = /\(?\d{3}\)?[-. ]\s?\d{3}[-. ]\d{4}/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;

/* ---- BidNet Direct: the Tennessee and Kentucky purchasing groups --------------------------- */

export interface BidnetGroup {
  state: "TN" | "KY";
  /** The group's path on bidnetdirect.com. */
  slug: string;
  /** Stands in for the issuing agency (members-only on BidNet). */
  label: string;
}
/**
 * BidNet Direct's state purchasing groups (Sep 29): cities, counties, school districts, utilities
 * and some state agencies post there. The list is public; the issuing agency, the solicitation
 * number and the documents are members-only, so a lead links the public abstract page.
 */
export const BIDNET_GROUPS: BidnetGroup[] = [
  { state: "TN", slug: "tennessee", label: "Tennessee Purchasing Group (BidNet)" },
  { state: "KY", slug: "kentucky", label: "Kentucky Purchasing Group (BidNet)" },
];
export const BIDNET_BASE = "https://www.bidnetdirect.com";
export const bidnetPageUrl = (slugPath: string, page: number) =>
  page <= 1
    ? `${BIDNET_BASE}/${slugPath}`
    : `${BIDNET_BASE}/${slugPath}/solicitations/open-bids/page${page}`;
/** Rows per list page, and the most pages one pull reads. */
const BIDNET_PAGE_SIZE = 25;
const BIDNET_MAX_PAGES = 20;
/** Pause between two BidNet requests. */
const BIDNET_PAUSE_MS = 300;
/** Abstract pages read per run for a roof row's exact closing time. */
const BIDNET_MAX_ABSTRACTS = 8;

export interface BidnetRow {
  /** The abstract id ("444177732225"). */
  id: string;
  title: string;
  /** "Tennessee". */
  region: string | null;
  /** "2026-09-29". */
  publishedOn: string | null;
  /** "2026-10-22" (the list shows the day only). */
  closingOn: string | null;
  /** The public abstract page. */
  url: string;
}

/** "09/29/2026" → "2026-09-29". */
const mdyToIso = (s: string | null | undefined): string | null => {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s ?? "");
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
};

/**
 * BidNet answers some requests with an AWS WAF "verify you're not a robot" page (HTTP 202, a
 * 2 KB page that loads challenge.js) instead of the list. It is never solved or retried here.
 */
export function isBidnetChallenge(status: number, html: string): boolean {
  return (
    status === 202 || /awsWafCookieDomainList|token\.awswaf\.com|challenge-container/.test(html)
  );
}

/**
 * One list page: one row per `<tr class="mets-table-row">` with the title linked to the
 * abstract, the region, and the published / closing dates (MM/DD/YYYY). `total` is the
 * "272 Open Solicitations" header; `lastPage` the pager's highest page.
 */
export function parseBidnetList(html: string): {
  rows: BidnetRow[];
  total: number | null;
  lastPage: number | null;
} {
  const rows: BidnetRow[] = [];
  const seen = new Set<string>();
  for (const part of html.split(/<tr\b[^>]*class="[^"]*mets-table-row[^"]*"[^>]*>/i).slice(1)) {
    const row = part.split(/<\/tr>/i)[0]!;
    const a = /<a\b([^>]*\bsolicitation-link\b[^>]*)>([\s\S]*?)<\/a>/i.exec(row);
    if (!a) continue;
    const href = /href="([^"]+)"/i.exec(a[1]!)?.[1];
    const id = href ? /\/(\d+)\/abstract\b/.exec(href)?.[1] : null;
    if (!href || !id || seen.has(id)) continue;
    seen.add(id);
    const date = (cls: string) =>
      mdyToIso(new RegExp(`${cls}[\\s\\S]*?date-value">([^<]*)<`, "i").exec(row)?.[1] ?? null);
    rows.push({
      id,
      title: decode(a[2]!),
      region: decode(/sol-region-item">([\s\S]*?)<\/span>/i.exec(row)?.[1] ?? "") || null,
      publishedOn: date("sol-publication-date"),
      closingOn: date("sol-closing-date"),
      url: new URL(decode(href), BIDNET_BASE).href,
    });
  }
  const total = /([\d,]+)\s+Open Solicitations/i.exec(html);
  const pages = [...html.matchAll(/data-page-number="(\d+)"/g)].map((m) => Number(m[1]));
  return {
    rows,
    total: total ? Number(total[1]!.replace(/,/g, "")) : null,
    lastPage: pages.length ? Math.max(...pages) : null,
  };
}

/** The abstract page's public dates: "Closing Date 10/22/2026 04:00 PM EDT". */
export function parseBidnetAbstract(html: string): {
  publishedText: string | null;
  closingText: string | null;
  closingAt: string | null;
} {
  const field = (label: string) => {
    const m = new RegExp(
      `${label}\\s*</span>\\s*<div[^>]*mets-field-body[^>]*>([\\s\\S]*?)</div>`,
      "i",
    ).exec(html);
    return m ? decode(m[1]!) || null : null;
  };
  const closingText = field("Closing Date");
  const closingAt = closingText
    ? /\bC[SD]?T\b/.test(closingText)
      ? parseCentralDate(closingText)
      : parseEasternDate(closingText)
    : null;
  return { publishedText: field("Publication Date"), closingText, closingAt };
}

/** Words after "City of" that are a department, not the town ("City of Franklin Park Department"). */
const NOT_TOWN =
  /^(Park|Parks|Department|Police|Fire|Public|Water|Utilities|Utility|Street|Streets|Schools?|Board|Recreation|Housing|Airport|Transit)$/;
/**
 * The place a BidNet title names, when it names one: "… for City of Clarksville", "Warren
 * County …", "Kingsport City Schools", "Hamilton County Schools". Light on purpose: null when
 * the title says nothing (the issuing agency is members-only).
 */
export function bidnetPlace(title: string): { city: string | null; county: string | null } {
  const cityOf = /\bCity of ([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/.exec(title);
  let city: string | null = null;
  if (cityOf) {
    const words = cityOf[1]!.split(" ");
    city = words.length > 1 && NOT_TOWN.test(words[1]!) ? words[0]! : cityOf[1]!;
  }
  city ??= /\b([A-Z][a-zA-Z]+) City Schools\b/.exec(title)?.[1] ?? null;
  // One word ("Warren", "McMinn"), or "Van Buren": "Demolition Svc Warren County" is Warren.
  const county = /\b((?:Van )?[A-Z][a-zA-Z]+) County\b/.exec(title)?.[1] ?? null;
  return { city, county };
}

export function bidnetLead(
  r: BidnetRow,
  group: BidnetGroup,
  keywords: string[],
  closing?: { at: string; text: string } | null,
): LeadInsert {
  const { city, county } = bidnetPlace(r.title);
  // The list gives the closing day only; 4:00 PM Eastern is the time the abstracts show
  // (read from the abstract for roof rows when it could be).
  const assumed = r.closingOn
    ? parseEasternDate(
        `${r.closingOn.slice(5, 7)}/${r.closingOn.slice(8, 10)}/${r.closingOn.slice(0, 4)} 04:00 PM`,
      )
    : null;
  return {
    source: "bidnet",
    external_id: r.id,
    title: r.title,
    agency: group.label,
    location: city ?? (county ? `${county} County` : null),
    city,
    county,
    state: group.state,
    bid_at: closing?.at ?? assumed,
    issued_on: r.publishedOn,
    url: r.url,
    contact: null,
    is_roof: isRoofLead(r.title, keywords),
    raw: {
      ...r,
      group: group.slug,
      closing_text: closing?.text ?? null,
      closing_time: closing
        ? "read from the abstract page"
        : "4:00 PM ET assumed (list shows the day only)",
    } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/**
 * Every page of one group's open list, one request at a time with a short pause. Page 1 gives
 * the count, hence the number of pages. A page answered with the robot check is skipped (not
 * retried) and reported in `problem`; so is a page that fails, and the pages left when the run's
 * time budget (`deadline`, epoch ms) runs out. Throws when page 1 cannot be read.
 */
export async function fetchBidnetList(
  group: BidnetGroup,
  deadline: number,
  headers: Record<string, string> = UT_HEADERS,
): Promise<{ rows: BidnetRow[]; pages: number; read: number; requests: number; problem?: string }> {
  const get = async (page: number) => {
    const res = await fetchTimeout(bidnetPageUrl(group.slug, page), 20000, headers);
    return { status: res.status, ok: res.ok, html: await res.text() };
  };
  const first = await get(1);
  if (isBidnetChallenge(first.status, first.html))
    throw new Error(
      "→ the first page answered with a robot check (AWS WAF challenge; not retried), so nothing was read this time",
    );
  if (!first.ok) throw new Error(`→ ${first.status}`);
  const one = parseBidnetList(first.html);
  if (!one.rows.length && one.total !== 0 && !/0\s+Open Solicitations/i.test(first.html))
    throw new Error("nothing parsed (page layout changed?)");
  const pages = Math.min(
    BIDNET_MAX_PAGES,
    one.total != null ? Math.max(1, Math.ceil(one.total / BIDNET_PAGE_SIZE)) : (one.lastPage ?? 1),
  );
  const rows = new Map(one.rows.map((r) => [r.id, r]));
  const challenged: number[] = [];
  const problems: string[] = [];
  let read = 1;
  let requests = 1;
  for (let p = 2; p <= pages; p++) {
    if (Date.now() > deadline) {
      problems.push(`stopped after page ${p - 1} of ${pages} (the run's time budget)`);
      break;
    }
    await pause(BIDNET_PAUSE_MS);
    requests++;
    try {
      const r = await get(p);
      if (isBidnetChallenge(r.status, r.html)) challenged.push(p);
      else if (!r.ok) problems.push(`page ${p} → ${r.status}`);
      else {
        for (const row of parseBidnetList(r.html).rows)
          if (!rows.has(row.id)) rows.set(row.id, row);
        read++;
      }
    } catch (e) {
      problems.push(`page ${p} ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (challenged.length)
    problems.unshift(
      `${challenged.length} of ${pages} pages answered with a robot check (AWS WAF challenge; not retried): page ${challenged.join(", ")}`,
    );
  return {
    rows: [...rows.values()],
    pages,
    read,
    requests,
    ...(problems.length
      ? { problem: `→ ${read} of ${pages} pages read; ${problems.join("; ")}` }
      : {}),
  };
}

/** One abstract page's closing time (null on the robot check or any failure: not an error). */
export async function fetchBidnetClosing(
  url: string,
  headers: Record<string, string> = UT_HEADERS,
): Promise<{ at: string; text: string } | null> {
  try {
    const res = await fetchTimeout(url, 15000, headers);
    const html = await res.text();
    if (!res.ok || isBidnetChallenge(res.status, html)) return null;
    const a = parseBidnetAbstract(html);
    return a.closingAt && a.closingText ? { at: a.closingAt, text: a.closingText } : null;
  } catch {
    return null;
  }
}

/* ---- Chattanooga permits (Chattanooga-Hamilton County RPA, ArcGIS) ------------------------ */

/**
 * The Regional Planning Agency's building permits layer (the service name is historical; the
 * data ran to 2026-07-31 on Sep 29, a month or two behind). Only new construction is in it.
 */
export const CHATTANOOGA_PERMITS_LAYER =
  "https://services2.arcgis.com/cclAu9OKhOfjeUdr/arcgis/rest/services/Building_Permits_to_April_2021/FeatureServer/0";
/** The layer lags one to two months, so it is read further back than the Louisville window. */
export const CHATTANOOGA_DAYS = 180;
/** Census Bureau building-permit codes for new non-residential construction (DEV_TYPE_C). */
export const CENSUS_NONRES: Record<string, string> = {
  "213": "Hotels and motels",
  "214": "Other shelter",
  "318": "Amusement and recreation",
  "319": "Churches and religious",
  "320": "Industrial",
  "321": "Parking garages",
  "322": "Service stations and repair garages",
  "323": "Hospitals and institutional",
  "324": "Offices, banks and professional",
  "325": "Public works and utilities",
  "326": "Schools and educational",
  "327": "Stores and customer services",
  "328": "Other non-residential",
  "329": "Structures other than buildings",
};

export interface ChattanoogaPermit {
  PERMIT_NUM: string;
  ADDRESS: string | null;
  VALUATION: number | null;
  PERMIT_DAT: number | null;
  PERMIT_YEAR?: number | null;
  CATEGORY: string | null;
  P_TYPE: string | null;
  DEV_TYPE_C: string | null;
  P_DESC: string | null;
  CITY: string | null;
  [k: string]: unknown;
}

/**
 * New non-residential permits issued in the last CHATTANOOGA_DAYS at or over the cost floor
 * (the Nashville one, shared), leaving out code 329 (structures other than buildings: towers,
 * signs, walls). Points in WGS84.
 */
export function chattanoogaQueryUrl(minCost: number, offset = 0, now = new Date()): string {
  const since = new Date(now.getTime() - CHATTANOOGA_DAYS * 86400000).toISOString().slice(0, 10);
  const min = Number(minCost) || 0;
  const where = `P_TYPE = 'Non-Residential' AND PERMIT_DAT >= DATE '${since}' AND (DEV_TYPE_C IS NULL OR DEV_TYPE_C <> '329')${min > 0 ? ` AND VALUATION >= ${min}` : ""}`;
  const q = new URLSearchParams({
    where,
    outFields:
      "PERMIT_NUM,ADDRESS,VALUATION,PERMIT_DAT,PERMIT_YEAR,CATEGORY,P_TYPE,DEV_TYPE_C,P_DESC,CITY",
    orderByFields: "PERMIT_DAT DESC",
    resultRecordCount: "1000",
    resultOffset: String(offset),
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  return `${CHATTANOOGA_PERMITS_LAYER}/query?${q.toString()}`;
}

export async function fetchChattanooga(
  minCost: number,
): Promise<{ permit: ChattanoogaPermit; lat: number | null; lng: number | null }[]> {
  const out: { permit: ChattanoogaPermit; lat: number | null; lng: number | null }[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const res = await fetchTimeout(chattanoogaQueryUrl(minCost, offset));
    if (!res.ok) throw new Error(`→ ${res.status}`);
    const json = (await res.json()) as {
      error?: { message?: string };
      features?: { attributes: ChattanoogaPermit; geometry?: { x?: number; y?: number } | null }[];
      exceededTransferLimit?: boolean;
    };
    if (json.error) throw new Error(`→ ${json.error.message ?? "error"}`);
    for (const f of json.features ?? [])
      out.push({
        permit: f.attributes,
        lat: typeof f.geometry?.y === "number" ? f.geometry.y : null,
        lng: typeof f.geometry?.x === "number" ? f.geometry.x : null,
      });
    if (!json.exceededTransferLimit) break;
  }
  return out;
}

export function chattanoogaLead(
  p: ChattanoogaPermit,
  point: { lat: number | null; lng: number | null },
  keywords: string[],
): LeadInsert {
  const kind = CENSUS_NONRES[(p.DEV_TYPE_C ?? "").trim()] ?? null;
  const desc = (p.P_DESC ?? "").replace(/\s+/g, " ").trim();
  const address = (p.ADDRESS ?? "").trim();
  const city = (p.CITY ?? "").trim() ? titleCase((p.CITY ?? "").trim()) : "Chattanooga";
  const sf = /(\d[\d,]{2,})\s*(?:S\.?\s?F\.?|sq\.?\s?ft|square\s+feet)(?![a-z])/i.exec(desc);
  return {
    source: "chattanooga_permits",
    external_id: p.PERMIT_NUM,
    title: `New non-residential — ${kind ?? "other"}`,
    agency: "Chattanooga-Hamilton County RPA",
    location: [address, city, "TN"].filter(Boolean).join(", "),
    address: address || null,
    city,
    county: "Hamilton",
    state: "TN",
    lat: point.lat,
    lng: point.lng,
    project_type: kind,
    sqft: sf ? Number(sf[1]!.replace(/,/g, "")) : null,
    project_cost: p.VALUATION,
    contact: null,
    issued_on: p.PERMIT_DAT ? easternDay(p.PERMIT_DAT) : null,
    url: null,
    // A new non-residential building is a new roof (as with Louisville and Nashville new
    // builds); a row without a known building code falls back to the keyword match.
    is_roof: kind !== null || isRoofLead(desc, keywords),
    raw: { ...p, description: desc } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ---- Knox County purchasing (Knoxville area) --------------------------------------------- */

export const KNOX_COUNTY_BIDS_URL =
  "https://www.knoxcounty.org/apps/solicitations/solicitations.php";

export interface KnoxBid {
  /** The solicitation number ("3764"). */
  number: string;
  title: string;
  /** "10-06-26" as the page shows it. */
  deadlineText: string;
  /** The deadline day at 2:00 PM Eastern (the page gives no time). */
  bidAt: string | null;
  buyer: string | null;
  phone: string | null;
  email: string | null;
  /** "Click Here for the Solicitation" → the PDF, made absolute. */
  documents: { label: string; url: string }[];
  note: string | null;
  prebidAt: string | null;
}

/**
 * One solicitation per row of five cells (title, number, deadline mm-dd-yy, buyer with a
 * mailto link and phone, attachment links); a "Note:" row under it (pre-bid meeting) belongs
 * to it.
 */
export function parseKnoxCountyBids(html: string): KnoxBid[] {
  const out: KnoxBid[] = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const row of clean.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = row.match(/<td\b[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length === 1 && /Note:/i.test(cells[0]!)) {
      const last = out[out.length - 1];
      if (last && !last.note) {
        last.note = decode(cells[0]!).replace(/^Note:\s*/i, "") || null;
        if (last.note && /pre-?\s?bid/i.test(last.note))
          last.prebidAt = parseWrittenDateTime(last.note, "ET");
      }
      continue;
    }
    if (cells.length < 5) continue;
    const number = decode(cells[1]!);
    const deadlineText = decode(cells[2]!);
    const d = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/.exec(deadlineText);
    if (!number || !d) continue; // the header row
    const year = d[3]!.length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
    const buyerCell = cells[3]!;
    const email = /mailto:([^'"\s>]+)/i.exec(buyerCell)?.[1] ?? null;
    const documents = [
      ...cells[4]!.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi),
    ].map((m) => ({
      label: decode(m[2]!).replace(/^Click Here for (the )?/i, ""),
      url: new URL(decode(m[1]!), "https://www.knoxcounty.org/").href,
    }));
    out.push({
      number,
      title: decode(cells[0]!),
      deadlineText,
      bidAt: zonedIso(year, Number(d[1]) - 1, Number(d[2]), 14, 0, "ET"),
      buyer: decode(/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(buyerCell)?.[1] ?? "") || null,
      phone: PHONE_RE.exec(decode(buyerCell))?.[0] ?? null,
      email: email ? decodeURIComponent(email) : null,
      documents,
      note: null,
      prebidAt: null,
    });
  }
  return out;
}

export function knoxCountyLead(b: KnoxBid, keywords: string[]): LeadInsert {
  const doc = b.documents.find((x) => /solicitation/i.test(x.label)) ?? b.documents[0];
  return {
    source: "knox_county_bids",
    external_id: b.number,
    title: b.title,
    agency: "Knox County",
    location: "Knoxville",
    city: "Knoxville",
    county: "Knox",
    state: "TN",
    bid_at: b.bidAt,
    prebid_at: b.prebidAt,
    url: doc?.url ?? KNOX_COUNTY_BIDS_URL,
    contact: [b.buyer, b.phone, b.email].filter(Boolean).join(" — ") || null,
    is_roof: isRoofLead(b.title, keywords),
    raw: {
      ...b,
      bid_time: "2:00 PM ET assumed (the list shows the deadline day only)",
    } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ---- Tennessee public universities and TBR ----------------------------------------------- */

export interface TnUniversityBid {
  /** The SBC project number when the page gives one, else the title as a slug. */
  id: string;
  title: string;
  /** TBR's list covers many schools: the row's institution ("TSU", "Chattanooga SCC"). */
  institution: string | null;
  city: string | null;
  county: string | null;
  description: string | null;
  /** The designer (A/E firm) running the bid. */
  designer: string | null;
  contact: string | null;
  prebidText: string | null;
  prebidAt: string | null;
  bidText: string | null;
  bidAt: string | null;
  /** The invitation to bid PDF, else the list page. */
  url: string;
}

export interface TnUniversity {
  key: string;
  /** Agency on the lead. */
  label: string;
  /** In the failure line: "ETSU bids". */
  short: string;
  url: string;
  city: string;
  county: string;
  zone: UsZone;
  parse: (html: string, school: TnUniversity) => TnUniversityBid[];
}

const bidBase = (school: TnUniversity, title: string): TnUniversityBid => ({
  id: slug(title),
  title,
  institution: null,
  city: school.city,
  county: school.county,
  description: null,
  designer: null,
  contact: null,
  prebidText: null,
  prebidAt: null,
  bidText: null,
  bidAt: null,
  url: school.url,
});

/**
 * ETSU: under "Available Projects to Bid", each project a small table: "SBC Project:" (number,
 * university, project, town), "Bids Received:" (place, then "until … 2:00 pm local time
 * Wednesday, October 7, 2026"), "Designer:" (firm, address, "Contact:", "Phone:").
 */
export function parseEtsuBids(html: string, school: TnUniversity): TnUniversityBid[] {
  const start = html.search(/Available Projects to Bid/i);
  if (start < 0) return [];
  let body = html.slice(start);
  const end = body.search(/class="bottomRow"|<\/article>|<footer\b/i);
  if (end >= 0) body = body.slice(0, end);
  const lines = htmlLines(body);
  const out: TnUniversityBid[] = [];
  const chunks: string[][] = [];
  for (const l of lines) {
    if (/^SBC Project( No\.?)?:?$/i.test(l)) chunks.push([]);
    chunks[chunks.length - 1]?.push(l);
  }
  for (const chunk of chunks) {
    const b = labeledBlocks(chunk, [
      ["sbc", /^SBC Project( No\.?)?:?/i],
      ["bid", /^Bids? (Received|Opening|Due)[^:]*:?/i],
      ["prebid", /^Pre-?\s?Bid[^:]*:/i],
      ["designer", /^Designer:?/i],
    ]);
    const sbcLines = b["sbc"] ?? [];
    const sbc = sbcNumber(sbcLines.join(" "));
    const title = sbcLines.find(
      (l) =>
        !sbcNumber(l) &&
        !/State University$/i.test(l) &&
        !isPlaceLine(l) &&
        !/,\s*Tennessee/i.test(l),
    );
    if (!title) continue;
    const place = sbcLines.find((l) => /,\s*(Tennessee|TN)\b/i.test(l));
    const bid = whenIn(b["bid"] ?? [], school.zone);
    const prebid = whenIn(b["prebid"] ?? [], school.zone);
    const d = b["designer"] ?? [];
    const firm = d[0] ?? null;
    const who = d.find((l) => /^Contact\s*:/i.test(l))?.replace(/^Contact\s*:\s*/i, "") ?? null;
    const phone = d.map((l) => PHONE_RE.exec(l)?.[0]).find(Boolean) ?? null;
    const email = d.map((l) => EMAIL_RE.exec(l)?.[0]).find(Boolean) ?? null;
    out.push({
      ...bidBase(school, title),
      id: sbc ?? slug(title),
      city: place ? place.split(",")[0]!.trim() : school.city,
      designer: firm,
      contact: [firm, who, phone, email].filter(Boolean).join(" — ") || null,
      prebidText: prebid?.text ?? null,
      prebidAt: prebid?.at ?? null,
      bidText: bid?.text ?? null,
      bidAt: bid?.at ?? null,
    });
  }
  return out;
}

/**
 * Tennessee Tech: "TN Tech Managed Projects", one accordion item per project titled "Name SBC#
 * 364/011-05-2025", with Project Description, Pre-Bid, Bid Opening (date and "at 2:00 PM,
 * local time" on separate lines) and Documents ("Please contact X at Firm, e-mail", phone,
 * the INVITATION TO BID link). The TBR table below it is left to the TBR source.
 */
export function parseTtuBids(html: string, school: TnUniversity): TnUniversityBid[] {
  let body = html;
  const tbr = body.search(/TBR Managed Projects/i);
  if (tbr >= 0) body = body.slice(0, tbr);
  const out: TnUniversityBid[] = [];
  for (const item of body.split(/<li\b[^>]*class="[^"]*accordion-item[^"]*"[^>]*>/i).slice(1)) {
    const head = /class="[^"]*accordion-title[^"]*"[^>]*>([\s\S]*?)(?:<div\b|<\/a>)/i.exec(item);
    if (!head) continue;
    const heading = decode(head[1]!);
    const sbc = sbcNumber(heading);
    const title = heading.replace(/\s*SBC\s*#?\s*:?\s*[\d/-]+[A-Z]*\s*$/i, "").trim();
    if (!title) continue;
    const content = item.slice(head.index + head[0].length);
    const b = labeledBlocks(htmlLines(content), [
      ["description", /^Project Description:?/i],
      ["prebid", /^Pre-?\s?Bid( Conference| Meeting)?:?/i],
      ["bid", /^Bid Opening:?/i],
      ["documents", /^Documents:?/i],
    ]);
    const prebid = whenIn(b["prebid"] ?? [], school.zone);
    const bid = whenIn(b["bid"] ?? [], school.zone);
    const docs = b["documents"] ?? [];
    const ask = docs.find((l) => /contact/i.test(l)) ?? null;
    const email = docs.map((l) => EMAIL_RE.exec(l)?.[0]).find(Boolean) ?? null;
    const phone = docs.map((l) => PHONE_RE.exec(l)?.[0]).find(Boolean) ?? null;
    // "Please contact, Art Carlton, at Bauer Askew Architecture, acarlton@…" → "Art Carlton, Bauer Askew Architecture".
    const who = ask
      ? ask
          .replace(EMAIL_RE, "")
          .replace(/^.*?contact,?\s*/i, "")
          .replace(/,?\s+at\s+/i, ", ")
          .replace(/[,\s]+$/, "")
          .trim() || null
      : null;
    const firm = who && who.includes(", ") ? who.slice(who.indexOf(", ") + 2) : null;
    const itb =
      /<a\b[^>]*href="([^"]+)"[^>]*>\s*INVITATION TO BID/i.exec(content)?.[1] ??
      /<a\b[^>]*href="([^"]+\.pdf)"/i.exec(content)?.[1];
    out.push({
      ...bidBase(school, title),
      id: sbc ?? slug(title),
      description: (b["description"] ?? []).join(" ") || null,
      designer: firm,
      contact: [who, email, phone].filter(Boolean).join(" — ") || null,
      prebidText: prebid?.text ?? null,
      prebidAt: prebid?.at ?? null,
      bidText: bid?.text ?? null,
      bidAt: bid?.at ?? null,
      url: itb ? new URL(decode(itb), school.url).href : school.url,
    });
  }
  return out;
}

/**
 * Austin Peay: "Project Bids", one accordion per project (the toggle is the title) with the
 * Invitation to Bid PDF, "Pre-Bid Conference" and "Bid Opening" ("Due by July 8, 2026, 2:00
 * p.m. CDT"), the designer under "Questions?" and the APSU contact.
 */
export function parseApsuBids(html: string, school: TnUniversity): TnUniversityBid[] {
  const start = html.search(/<h2[^>]*>\s*Project Bids\s*<\/h2>/i);
  if (start < 0) return [];
  let body = html.slice(start);
  const end = body.search(/<\/main>|class="sidebar"/i);
  if (end >= 0) body = body.slice(0, end);
  const out: TnUniversityBid[] = [];
  for (const part of body
    .split(/<button\b[^>]*class="[^"]*accordion__toggle[^"]*"[^>]*>/i)
    .slice(1)) {
    const close = part.search(/<\/button>/i);
    if (close < 0) continue;
    const title = decode(part.slice(0, close).replace(/<span class="hide">[\s\S]*?<\/span>/i, ""));
    if (!title) continue;
    const content = part.slice(close);
    const lines = htmlLines(content);
    const b = labeledBlocks(lines, [
      ["prebid", /^Pre-?\s?Bid( Conference| Meeting)?:?$/i],
      ["bid", /^Bid Opening:?$/i],
      ["questions", /^Questions\??$/i],
      ["apsu", /^APSU Contact:?$/i],
    ]);
    const pdf =
      /<a\b[^>]*href="([^"]+\.pdf)"[^>]*>\s*Invitation to Bid/i.exec(content)?.[1] ??
      /<a\b[^>]*href="([^"]+\.pdf)"/i.exec(content)?.[1];
    const url = pdf ? new URL(decode(pdf), school.url).href : school.url;
    const q = b["questions"] ?? [];
    const lead = q.findIndex((l) => /directed to|contact/i.test(l));
    const firm = lead >= 0 ? (q[lead + 1] ?? null) : (q[0] ?? null);
    const designerName =
      q.find((l) => /^Designer\s*:/i.test(l))?.replace(/^Designer\s*:\s*/i, "") ?? null;
    const phone = q.map((l) => PHONE_RE.exec(l)?.[0]).find(Boolean) ?? null;
    const email = q.map((l) => EMAIL_RE.exec(l)?.[0]).find(Boolean) ?? null;
    const apsu = (b["apsu"] ?? []).join(" ");
    const apsuPhone = PHONE_RE.exec(apsu)?.[0];
    const apsuEmail = EMAIL_RE.exec(apsu)?.[0];
    const prebid = whenIn(b["prebid"] ?? [], school.zone);
    const bid = whenIn(b["bid"] ?? [], school.zone);
    const sbc = sbcNumber(decodeURIComponent(url)) ?? sbcNumber(content);
    out.push({
      ...bidBase(school, title),
      id: sbc ?? slug(title),
      designer: firm,
      contact:
        [firm, designerName, phone, email].filter(Boolean).join(" — ") ||
        [`${school.label} capital planning`, apsuPhone, apsuEmail].filter(Boolean).join(" — "),
      prebidText: prebid?.text ?? null,
      prebidAt: prebid?.at ?? null,
      bidText: bid?.text ?? null,
      bidAt: bid?.at ?? null,
      url,
    });
  }
  return out;
}

/** Towns and TBR regions on Eastern time (the rest of Tennessee keeps Central). */
const TN_EASTERN =
  /^(Chattanooga|Knoxville|Johnson City|Kingsport|Bristol|Blountville|Elizabethton|Morristown|Greeneville|Jacksboro|Harriman|Athens|Cleveland|Oneida|Maryville|Sevierville|Oak Ridge|Rogersville|Tazewell|Dandridge|Newport|Madisonville|Dayton|Erwin|Mountain City|Sneedville|Maynardville|Kingston|Loudon|Lenoir City|Etowah|Benton|Wartburg|Huntsville|Rutledge|Decatur)$/i;

/**
 * TBR's construction bid list (and MTSU's, the same four-column table): Submittal Deadline
 * ("October 14, 2026 02:00 PM local time", region, "Bid"), Project ("in Chattanooga, TN", the
 * SBC number, the institution, the project), Project Description, Solicitor (designer firm,
 * "Contact: X", phone). "Local time" is the job's: Eastern in East Tennessee, else Central.
 */
export function parseTbrBidTable(html: string, school: TnUniversity): TnUniversityBid[] {
  const out: TnUniversityBid[] = [];
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const heads = (t.match(/<th\b[\s\S]*?<\/th>/gi) ?? []).map((h) => decode(h).toLowerCase());
    const col = (re: RegExp) => heads.findIndex((h) => re.test(h));
    const iDue = col(/deadline/);
    const iProject = col(/^project$/);
    if (iDue < 0 || iProject < 0) continue;
    const iDesc = col(/description/);
    const iBy = col(/solicitor/);
    for (const row of t.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = row.match(/<td\b[\s\S]*?<\/td>/gi) ?? [];
      if (cells.length <= Math.max(iDue, iProject)) continue;
      const lines = (i: number) => (i >= 0 && cells[i] ? htmlLines(cells[i]!) : []);
      const project = lines(iProject);
      if (!project.length) continue; // an empty row (MTSU's table today)
      const due = lines(iDue);
      const placeLine = project.find((l) => /^in\s+/i.test(l)) ?? null;
      const city = placeLine
        ? placeLine
            .replace(/^in\s+/i, "")
            .split(",")[0]!
            .trim() || null
        : null;
      const sbcLine = project.find((l) => /^\d{3}-\d{2}-\d{4}\w*$|^\d{3}\/\d{3}-/.test(l)) ?? null;
      const rest = project.filter((l) => l !== placeLine && l !== sbcLine);
      const title = rest[rest.length - 1];
      if (!title) continue;
      const institution = rest.length > 1 ? rest[0]! : null;
      const region = due[1] ?? null;
      const zone: UsZone =
        (region && TN_EASTERN.test(region)) || (city && TN_EASTERN.test(city)) ? "ET" : school.zone;
      const bid = whenIn(due, zone);
      const by = lines(iBy);
      const firm = by[0] ?? null;
      const who = by.find((l) => /^Contact\s*:/i.test(l))?.replace(/^Contact\s*:\s*/i, "") ?? null;
      const phone = by.map((l) => PHONE_RE.exec(l)?.[0]).find(Boolean) ?? null;
      out.push({
        ...bidBase(school, title),
        id: sbcLine ?? slug(`${institution ?? ""} ${title}`),
        institution,
        city: city ?? school.city,
        county: city ? (city === school.city ? school.county : null) : school.county,
        description: lines(iDesc).join(" ") || null,
        designer: firm,
        contact: [firm, who, phone].filter(Boolean).join(" — ") || null,
        bidText: bid?.text ?? null,
        bidAt: bid?.at ?? null,
      });
    }
  }
  return out;
}

/**
 * The locally governed public universities' construction bid lists, and TBR's (community
 * colleges, TCATs and TSU). University of Memphis is left out: its bid list page only links an
 * Oracle supplier portal that needs registration (checked Sep 29).
 */
export const TN_UNIVERSITIES: TnUniversity[] = [
  {
    key: "etsu",
    label: "East Tennessee State University",
    short: "ETSU",
    url: "https://www.etsu.edu/facilities/planning/bid.php",
    city: "Johnson City",
    county: "Washington",
    zone: "ET",
    parse: parseEtsuBids,
  },
  {
    key: "ttu",
    label: "Tennessee Tech",
    short: "Tennessee Tech",
    url: "https://www.tntech.edu/capital-projects/sbc-capital/bid-list.php",
    city: "Cookeville",
    county: "Putnam",
    // Putnam County keeps Central time.
    zone: "CT",
    parse: parseTtuBids,
  },
  {
    key: "apsu",
    label: "Austin Peay State University",
    short: "Austin Peay",
    url: "https://www.apsu.edu/univ-design-and-construction/construction_bid_list.php",
    city: "Clarksville",
    county: "Montgomery",
    zone: "CT",
    parse: parseApsuBids,
  },
  {
    key: "mtsu",
    label: "Middle Tennessee State University",
    short: "MTSU",
    url: "https://www.mtsu.edu/campusplanning/construction/",
    city: "Murfreesboro",
    county: "Rutherford",
    zone: "CT",
    parse: parseTbrBidTable,
  },
  {
    key: "tbr",
    label: "Tennessee Board of Regents",
    short: "TBR",
    url: "https://www.tbr.edu/facilities/construction-bid",
    city: "Nashville",
    county: "Davidson",
    zone: "CT",
    parse: parseTbrBidTable,
  },
];

/** The page is the bid list we expect (a heading or table header it always has), even if empty. */
export function isTnUniversityPage(html: string, school: TnUniversity): boolean {
  switch (school.key) {
    case "etsu":
      return /Available Projects to Bid/i.test(html);
    case "ttu":
      return /Construction Bid List/i.test(html) && /accordion/i.test(html);
    case "apsu":
      return /Project Bids/i.test(html);
    default:
      return /Submittal Deadline/i.test(html);
  }
}

export function tnUniversityLead(
  b: TnUniversityBid,
  school: TnUniversity,
  keywords: string[],
): LeadInsert {
  return {
    source: "tn_university_bids",
    external_id: `${school.key}:${b.id}`,
    title: b.title,
    agency: b.institution ? `${b.institution} (${school.short})` : school.label,
    location: b.city,
    city: b.city,
    county: b.county,
    state: "TN",
    contractor: b.designer,
    contact: b.contact,
    prebid_at: b.prebidAt,
    bid_at: b.bidAt,
    url: b.url,
    is_roof: isRoofLead(`${b.title} ${b.description ?? ""}`, keywords),
    raw: { ...b, school: school.key, page: school.url } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Tennessee round three (Sep 29): Metro Nashville and City of Chattanooga bids, read by the
 * nightly browser job (scripts/browser-bids.ts) and posted to /api/cron/leads-import
 * ---------------------------------------------------------------------------------------------- */

/** "10/15/26" / "10/22/2026" (with a time or not) → { year, month (0-11), day }, else null. */
function portalYmd(
  text: string,
): { y: number; m: number; d: number; match: RegExpExecArray } | null {
  const r = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(
    text,
  );
  if (!r) return null;
  const y = r[3]!.length === 2 ? 2000 + Number(r[3]) : Number(r[3]);
  const m = Number(r[1]) - 1;
  const d = Number(r[2]);
  const check = new Date(Date.UTC(y, m, d));
  if (check.getUTCMonth() !== m || check.getUTCDate() !== d) return null;
  return { y, m, d, match: r };
}

/**
 * An Oracle portal date as shown — "10/15/26 2:00 PM" (Chattanooga), "10/22/2026 2:00 PM"
 * (Nashville), or a date alone ("9/28/26": midnight) — read in the portal's zone → ISO instant.
 */
export function parsePortalDate(text: string, zone: UsZone): string | null {
  const p = portalYmd(text);
  if (!p) return null;
  const r = p.match;
  let hour = r[4] ? Number(r[4]) % 12 : 0;
  if (r[6]?.toUpperCase() === "PM") hour += 12;
  return zonedIso(p.y, p.m, p.d, hour, r[5] ? Number(r[5]) : 0, zone);
}

/** The calendar day a portal date shows ("9/28/26 11:58 AM" → "2026-09-28"). */
export function portalDay(text: string): string | null {
  const p = portalYmd(text);
  if (!p) return null;
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/**
 * One open solicitation → a lead. external_id is the base number (without the ",N" round), so
 * an amendment updates the same lead. The abstract's buyer is the contact (public on the
 * abstract; Knox County's buyer is used the same way). There is no public page per row (the
 * abstract opens in a dialog), so the lead links the portal's list.
 */
export function browserBidLead(
  r: PortalRow,
  source: BrowserSource,
  keywords: string[],
): LeadInsert {
  const p = BROWSER_PORTALS[source];
  const { base, round } = negotiationRound(r.number);
  // Title, synopsis and the attachment names ("Roof Replacement Specs.pdf") feed the keyword
  // match. A Construction Bid is not roof work unless the words say so.
  const text = [r.title, r.description ?? "", ...r.attachments].join(" ");
  return {
    source,
    external_id: base,
    title: r.title,
    agency: p.agency,
    location: p.city,
    city: p.city,
    county: p.county,
    state: "TN",
    project_type: r.type || null,
    bid_at: r.closeDate ? parsePortalDate(r.closeDate, p.zone) : null,
    prebid_at: r.prebid ? parsePortalDate(r.prebid, p.zone) : null,
    issued_on: r.postingDate ? portalDay(r.postingDate) : null,
    url: p.url,
    contact: [r.buyer, r.email].filter(Boolean).join(" — ") || null,
    is_roof: isRoofLead(text, keywords),
    raw: { ...r, round, portal: p.url, portal_time_zone: p.timeZone } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
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

/** A campus planroom row: the institution as agency, the plan issuer as who to bid to. */
export function campusLead(
  j: PlanroomJob,
  portal: { domain: string; label: string },
  keywords: string[],
): LeadInsert {
  // The list prefixes the town with Lynn's job number ("26-538 Lexington, Kentucky").
  const town =
    (j.location ?? "")
      .replace(/^\d{2}-\d{3,5}\s+/, "")
      .replace(/,?\s*(Kentucky|KY)\s*$/i, "")
      .trim() || null;
  const issuer = (j.company ?? "").trim();
  const issuerIsOwner = !issuer || issuer.toLowerCase() === portal.label.toLowerCase();
  return {
    source: "campus_planrooms",
    external_id: `${portal.domain}:${j.jobId}`,
    title: j.name,
    agency: portal.label,
    contractor: issuerIsOwner ? null : issuer,
    contact: issuerIsOwner
      ? `${portal.label} — bid documents and plan holders on the planroom job page`
      : `Plans issued by ${issuer} — bid the roofing to them`,
    location: town,
    city: town,
    project_type: j.projectType,
    prebid_at: j.prebidAt,
    bid_at: j.bidAt,
    url: campusJobUrl(portal.domain, j.jobId),
    is_roof: isRoofLead(`${j.name} ${j.projectType ?? ""}`, keywords),
    raw: {
      ...j,
      portal: portal.domain,
      portal_base: `https://www.${portal.domain}/View`,
    } as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

export interface SamOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string | null;
  fullParentPathName?: string | null;
  postedDate?: string | null;
  type?: string | null;
  typeOfSetAsideDescription?: string | null;
  responseDeadLine?: string | null;
  naicsCode?: string | null;
  placeOfPerformance?: {
    city?: { name?: string | null } | null;
    state?: { code?: string | null; name?: string | null } | null;
    zip?: string | null;
  } | null;
  pointOfContact?:
    | {
        fullName?: string | null;
        email?: string | null;
        phone?: string | null;
        type?: string | null;
      }[]
    | null;
  uiLink?: string | null;
}

const mmddyyyy = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;

/** SAM.gov pulls at least this far apart: 20 h keeps the daily cron on its once-a-day slot. */
const SAM_GAP = 20 * 60 * 60 * 1000;
/** One state's SAM.gov call: roofing NAICS, place of performance `state`, posted in the last `days`. */
export function samQueryUrl(
  apiKey: string,
  days = 60,
  now = new Date(),
  state: string = "KY",
): string {
  const q = new URLSearchParams({
    api_key: apiKey,
    postedFrom: mmddyyyy(new Date(now.getTime() - days * 86400000)),
    postedTo: mmddyyyy(now),
    ncode: SAM_NAICS_ROOFING,
    state,
    ptype: "o,p,k",
    limit: "200",
    offset: "0",
  });
  return `${SAM_SEARCH_URL}?${q.toString()}`;
}

/** `queryState`: the state the opportunity was asked for, when it names no place of performance. */
export function samLead(o: SamOpportunity, keywords: string[], queryState = "KY"): LeadInsert {
  const agency = (o.fullParentPathName ?? "")
    .split(".")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(-2)
    .join(" / ");
  const poc = (o.pointOfContact ?? []).find((c) => c.fullName || c.email) ?? null;
  const contact = poc ? [poc.fullName, poc.email, poc.phone].filter(Boolean).join(" — ") : null;
  const city = o.placeOfPerformance?.city?.name ?? null;
  const code = (o.placeOfPerformance?.state?.code ?? "").trim().toUpperCase();
  const st = /^[A-Z]{2}$/.test(code) ? code : queryState;
  const deadline =
    o.responseDeadLine && !Number.isNaN(Date.parse(o.responseDeadLine))
      ? new Date(o.responseDeadLine).toISOString()
      : null;
  const posted =
    o.postedDate && /^\d{4}-\d{2}-\d{2}/.test(o.postedDate) ? o.postedDate.slice(0, 10) : null;
  return {
    source: "sam_gov",
    external_id: o.noticeId,
    title: o.solicitationNumber ? `${o.solicitationNumber} — ${o.title}` : o.title,
    agency: agency || "Federal",
    location: city ? `${city}, ${st}` : st,
    city,
    state: st,
    project_type: [o.type, o.typeOfSetAsideDescription].filter(Boolean).join(" · ") || null,
    bid_at: deadline,
    issued_on: posted,
    url: o.uiLink ?? `https://sam.gov/opp/${o.noticeId}/view`,
    contact,
    // Pulled under the roofing NAICS code: roof work by definition, keywords or not.
    is_roof: o.naicsCode === SAM_NAICS_ROOFING || isRoofLead(o.title, keywords),
    raw: o as unknown as Json,
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
    // On a new build the roofing is bid to the general contractor on the permit.
    contact: (p.CONTRACTOR ?? "").trim()
      ? `General contractor ${(p.CONTRACTOR ?? "").trim()} — bid the roofing to them`
      : null,
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
    url: permitSiteUrl(p),
    // A whole new commercial building is a roof to bid whatever the permit is called.
    is_roof: /commercial (new|addition)/i.test(type) || isRoofLead(text, keywords),
    raw: p as unknown as Json,
    last_seen_at: new Date().toISOString(),
    gone_at: null,
  };
}

/** "RFB-86-27 FSS – Jackson SOB Roof Replacement" → "rfb-86-27 fss - jackson sob roof replacement". */
const normTitle = (t: string) => t.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
/** The solicitation code a state job starts with ("RFB-86-27", "RFP-27-003"), if any. */
const solicitationCode = (t: string): string | null => {
  const m = /^(?:re-?ad(?:vertisement)?\s+of\s+)?((?:RF[BPQ]|ITB|IFB)-[\w.]+)/i.exec(t.trim());
  return m ? m[1]!.toUpperCase() : null;
};

/**
 * Lynn's feed repeats every state planroom job (Lynn runs that planroom too). Keep the planroom
 * copy — it carries the bid date — and drop the Lynn one when the titles match or both start
 * with the same solicitation code. Returns the Lynn rows to keep and the ids dropped.
 */
export function dropPlanroomDuplicates(
  lynn: LeadInsert[],
  planroom: LeadInsert[],
): { keep: LeadInsert[]; dropped: string[] } {
  const titles = new Set(planroom.map((r) => normTitle(r.title)));
  const codes = new Set(planroom.map((r) => solicitationCode(r.title)).filter(Boolean));
  const keep: LeadInsert[] = [];
  const dropped: string[] = [];
  for (const r of lynn) {
    const code = solicitationCode(r.title);
    if (titles.has(normTitle(r.title)) || (code && codes.has(code))) dropped.push(r.external_id);
    else keep.push(r);
  }
  return { keep, dropped };
}

/* ------------------------------------------------------------------------------------------------
 * The refresh
 * ---------------------------------------------------------------------------------------------- */

export interface RefreshLeadsResult {
  planroom: number;
  louisville: number;
  lynn: number;
  bowling_green: number;
  paducah: number;
  campus: number;
  sam_gov: number;
  tn_stream: number;
  ut: number;
  nashville: number;
  /** 0 when the once-a-day gate skipped BidNet this run. */
  bidnet: number;
  chattanooga: number;
  knox_county: number;
  tn_universities: number;
  new_leads: number;
  new_roof_leads: number;
  gone: number;
  /** Planroom job pages read for contacts this run (0 without a planroom login). */
  enriched: number;
  failed: string[];
  notified: number;
  /** The run's summary as stamped on lead_settings. */
  note: string;
}

/**
 * Sign in to the state planroom and Lynn's, read the job page of every open roof lead that
 * has not been read in the last week (`max` per call, newest first), and store the contact
 * line plus the fields in raw.details. Without PLANROOM_EMAIL / PLANROOM_PASSWORD this is a
 * no-op. Kept apart from the list refresh: the page calls it in small batches after a refresh
 * (a serverless request has a budget of outside calls and seconds), the nightly cron in one.
 */
export async function readPlanroomPages(
  sb: Client,
  max: number,
): Promise<{ read: number; failed: string[] }> {
  const failed: string[] = [];
  const read = await enrichPlanroomLeads(await serverClient(sb), failed, max);
  return { read, failed };
}

async function enrichPlanroomLeads(admin: Client, failed: string[], max: number): Promise<number> {
  const { planroomCredentials, planroomSignIn, planroomSignOut, fetchJobDetails, contactLine } =
    await import("@/lib/planroom.server");
  const { STATE_PLANROOM, LYNN_PLANROOM } = await import("@/lib/planroom.server");
  const creds = planroomCredentials();
  if (!creds || max <= 0) return 0;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: rows, error } = await admin
    .from("leads")
    .select("id, source, external_id, title, raw, bid_at")
    .in("source", ["ky_planroom", "lynn_bids", "campus_planrooms"])
    .eq("is_roof", true)
    .is("gone_at", null)
    .in("status", ["new", "watching"])
    .order("first_seen_at", { ascending: false })
    .limit(120);
  if (error) throw new Error(error.message);
  const due = (rows ?? [])
    .filter((r) => {
      const d = (r.raw as { details_read_at?: string } | null)?.details_read_at;
      return !d || d < since;
    })
    .filter((r) => !r.bid_at || Date.parse(r.bid_at) > Date.now() - 86400000)
    .slice(0, max);
  if (!due.length) return 0;
  let n = 0;
  const sessions: Record<string, Awaited<ReturnType<typeof planroomSignIn>> | null> = {};
  for (const r of due) {
    const portalBase = (r.raw as { portal_base?: string } | null)?.portal_base;
    const site =
      r.source === "ky_planroom"
        ? STATE_PLANROOM
        : r.source === "campus_planrooms" && portalBase
          ? { base: portalBase, label: `${new URL(portalBase).hostname} planroom` }
          : LYNN_PLANROOM;
    if (sessions[site.base] === undefined) {
      try {
        sessions[site.base] = await planroomSignIn(site, creds.email, creds.password);
      } catch (e) {
        sessions[site.base] = null;
        failed.push(e instanceof Error ? e.message : String(e));
      }
    }
    const session = sessions[site.base];
    if (!session) continue;
    // Lynn posts whose "More Details" points at Lynn's planroom carry that job id; a post
    // without one (external_id is the post URL) has no job page to read.
    const jobId = r.external_id.includes(":") ? r.external_id.split(":")[1]! : r.external_id;
    if (!/^\d+$/.test(jobId)) continue;
    try {
      const details = await fetchJobDetails(session, jobId);
      const contact = contactLine(details);
      const raw = { ...((r.raw as Record<string, unknown> | null) ?? {}) };
      raw["details"] = details.fields;
      raw["plan_holders"] = details.planHolders;
      // The page as text, so the parser can be fitted to the real layout from the row.
      raw["page_text"] = details.text.slice(0, 3000);
      raw["details_read_at"] = new Date().toISOString();
      const patch: Database["public"]["Tables"]["leads"]["Update"] = { raw: raw as Json };
      if (contact) patch.contact = contact;
      const { error: uErr } = await admin.from("leads").update(patch).eq("id", r.id);
      if (uErr) throw new Error(uErr.message);
      n++;
    } catch (e) {
      failed.push(`${site.label} job ${jobId}: ${e instanceof Error ? e.message : String(e)}`);
      if (/session expired/.test(String(e))) sessions[site.base] = null;
    }
  }
  // Sign out of every site we signed in to (the planroom terms ask for it).
  for (const session of Object.values(sessions)) if (session) await planroomSignOut(session);
  return n;
}

/** One list's rows as pulled; `count` is what the list held (before duplicates are dropped). */
export interface PulledLeads {
  source: LeadSource;
  rows: LeadInsert[];
  count: number;
}

export interface SavedLeads {
  /** Rows per source as pulled (PulledLeads.count, summed). */
  counts: Record<string, number>;
  /** Rows written (after duplicates and repeats were dropped). */
  saved: number;
  fresh: LeadInsert[];
  newRoof: LeadInsert[];
  gone: number;
  notified: number;
}

/**
 * Save what one pass read — the nightly/in-app refresh (every list at once) or one browser
 * import (a single source) — the same way:
 *   - Lynn's copies of planroom jobs, and BidNet's copies of jobs on the owner's own lists
 *     pulled in the same pass, are dropped (and retired if stored earlier);
 *   - upsert on (source, external_id): the team's status and note are kept;
 *   - a source that answered in full has what dropped off it marked gone (not Lynn's feed,
 *     which is only the latest posts; not a source in `partial`, read only in part);
 *   - Prospecting users are told about new roof leads.
 */
export async function saveLeadRows(
  admin: Client,
  pulled: PulledLeads[],
  opts: { partial?: ReadonlySet<LeadSource> } = {},
): Promise<SavedLeads> {
  const partial = opts.partial ?? new Set<LeadSource>();
  const counts: Record<string, number> = {};
  const rows: LeadInsert[] = [];
  const fetchedSources = new Set<LeadSource>();
  // Lynn's feed repeats the state and campus planroom jobs: keep the planroom copies. BidNet
  // repeats state, UT and some university jobs: keep the copy from the owner's own list (it
  // carries the contact and the exact bid time).
  const duplicates: { source: LeadSource; ids: string[] }[] = [];
  const planroomRows = pulled
    .filter((x) => x.source === "ky_planroom" || x.source === "campus_planrooms")
    .flatMap((x) => x.rows);
  const ownListRows = pulled
    .filter(
      (x) => x.source !== "bidnet" && x.source !== "lynn_bids" && !x.source.endsWith("_permits"),
    )
    .flatMap((x) => x.rows);
  for (const x of pulled) {
    let keepRows = x.rows;
    if (x.source === "lynn_bids" || x.source === "bidnet") {
      const { keep, dropped } = dropPlanroomDuplicates(
        x.rows,
        x.source === "lynn_bids" ? planroomRows : ownListRows,
      );
      if (dropped.length) duplicates.push({ source: x.source, ids: dropped });
      keepRows = keep;
    }
    // Every row names its state: one upsert batch sends the union of the rows' columns, and a
    // row without `state` would send null (not the column default) and fail the not-null check.
    rows.push(...keepRows.map((r) => ({ ...r, state: r.state ?? "KY" })));
    counts[x.source] = (counts[x.source] ?? 0) + x.count;
    fetchedSources.add(x.source);
  }
  // One row per (source, external_id): an upsert that touches a row twice is refused outright.
  const byKey = new Map<string, LeadInsert>();
  for (const r of rows) {
    const k = `${r.source}|${r.external_id}`;
    if (!byKey.has(k)) byKey.set(k, r);
  }
  rows.splice(0, rows.length, ...byKey.values());

  // Which of these are new? Compare against what is stored (for these sources) before the upsert.
  let fresh: LeadInsert[] = [];
  if (rows.length) {
    const { data: existing, error: eErr } = await admin
      .from("leads")
      .select("source, external_id")
      .in("source", [...new Set(rows.map((r) => r.source))]);
    if (eErr) throw new Error(eErr.message);
    const known = new Set((existing ?? []).map((r) => `${r.source}|${r.external_id}`));
    fresh = rows.filter((r) => !known.has(`${r.source}|${r.external_id}`));
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("leads")
      .upsert(rows.slice(i, i + 500), { onConflict: "source,external_id" });
    if (error) throw new Error(error.message);
  }

  // Dropped off a source that answered: mark gone (kept for history; hidden by default).
  let gone = 0;
  for (const d of duplicates) {
    // A Lynn or BidNet copy of a job stored before the other list's row existed: retire it.
    const { data: g, error } = await admin
      .from("leads")
      .update({ gone_at: new Date().toISOString() })
      .eq("source", d.source)
      .is("gone_at", null)
      .in("external_id", d.ids)
      .select("id");
    if (error) throw new Error(error.message);
    gone += g?.length ?? 0;
  }
  for (const source of fetchedSources) {
    // Lynn's feed is the latest 25 posts; scrolling off it is not a withdrawal.
    if (source === "lynn_bids") continue;
    if (partial.has(source)) continue;
    const ids = rows.filter((r) => r.source === source).map((r) => r.external_id);
    let q = admin
      .from("leads")
      .update({ gone_at: new Date().toISOString() })
      .eq("source", source)
      .is("gone_at", null);
    // An empty list (nothing open at the source) retires every open lead of that source.
    if (ids.length)
      q = q.not(
        "external_id",
        "in",
        `(${ids.map((x) => `"${x.replace(/"/g, '\\"')}"`).join(",")})`,
      );
    const { data: g, error } = await q.select("id");
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
  return { counts, saved: rows.length, fresh, newRoof, gone, notified };
}

export async function refreshLeads(
  sb: Client,
  opts: { readPages?: number } = {},
): Promise<RefreshLeadsResult> {
  const admin = await serverClient(sb);
  const { data: settings, error: sErr } = await admin
    .from("lead_settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (sErr) throw new Error(sErr.message);
  const s: SettingsRow = settings;
  const failed: string[] = [];
  const t0 = Date.now();
  const stage = (what: string) =>
    admin
      .rpc("stamp_lead_fetch", { note: `${what} (+${((Date.now() - t0) / 1000).toFixed(1)} s)` })
      .then(
        () => undefined,
        () => undefined,
      );

  // A progress stamp first: if the run dies mid-way (a platform time limit), the settings row
  // shows when it started instead of the last good run.
  await stage(
    `running since ${new Date().toISOString()}: pulling ${CAMPUS_PLANROOMS.length + UT_CAMPUSES.length + TN_UNIVERSITIES.length + 10} lists (plus SAM.gov and BidNet once a day)…`,
  );

  // Every list at once (the slowest site, not the sum, sets the run's length); each source
  // that fails is reported and skipped.
  const samKey = process.env["SAM_GOV_API_KEY"]?.trim();
  // SAM.gov: a personal API key allows only a handful of requests a day, so one pull a day
  // however often the page is refreshed (owner, Sep 29: "I don't want to overdo their site").
  // The attempt is stamped before the call: a failed request spends the budget too.
  // BidNet takes a request per 25 solicitations (about 20 a pull): the same once-a-day gate.
  const stamps = { ...((s.source_fetched_at as Record<string, string> | null) ?? {}) };
  const lastPull = (key: string) => (stamps[key] ? Date.parse(stamps[key]) : 0);
  const samLast = lastPull("sam_gov");
  const samDue = !!samKey && Date.now() - samLast > SAM_GAP;
  const samNext = new Date(samLast + SAM_GAP);
  const bidnetLast = lastPull("bidnet");
  const bidnetDue = Date.now() - bidnetLast > SAM_GAP;
  const bidnetNext = new Date(bidnetLast + SAM_GAP);
  if (samDue || bidnetDue) {
    if (samDue) stamps["sam_gov"] = new Date().toISOString();
    if (bidnetDue) stamps["bidnet"] = new Date().toISOString();
    const { error: stampErr } = await admin
      .from("lead_settings")
      .update({ source_fetched_at: stamps })
      .eq("id", 1);
    if (stampErr) throw new Error(`could not stamp the daily pulls: ${stampErr.message}`);
  }
  type Pulled = PulledLeads;
  let bidnetClosingsRead = 0;
  // A source read from several lists (campus pages, the two STREAM pages, SAM.gov's two
  // states) with one of them failing: its rows from that list are missing, not withdrawn, so
  // nothing of that source is marked gone this run.
  const partial = new Set<LeadSource>();
  // `problem`: the list was read only in part (BidNet pages skipped): the rows are kept, the
  // problem is reported, and nothing of that source is marked gone.
  const attempt = async (
    source: LeadSource,
    label: string,
    run: () => Promise<{ rows: LeadInsert[]; count?: number; problem?: string }>,
  ): Promise<Pulled | null> => {
    try {
      const r = await run();
      if (r.problem) {
        failed.push(`${label} ${r.problem}`);
        partial.add(source);
      }
      return { source, rows: r.rows, count: r.count ?? r.rows.length };
    } catch (e) {
      failed.push(`${label} ${e instanceof Error ? e.message : String(e)}`);
      partial.add(source);
      return null;
    }
  };
  const text = async (url: string, headers?: Record<string, string>) => {
    const res = await fetchTimeout(url, undefined, headers);
    if (!res.ok) throw new Error(`→ ${res.status}`);
    return res.text();
  };
  const pulls: Promise<Pulled | null>[] = [
    attempt("ky_planroom", "State planroom", async () => {
      const jobs = parsePlanroomHtml(await text(PLANROOM_URL));
      if (!jobs.length) throw new Error("no jobs parsed (page layout changed?)");
      return { rows: jobs.map((j) => planroomLead(j, s.roof_keywords)) };
    }),
    attempt("louisville_permits", "Louisville permits", async () => {
      const permits = await fetchLouisville(s);
      return { rows: permits.map((p) => louisvilleLead(p, s.roof_keywords)) };
    }),
    ...CAMPUS_PLANROOMS.map((portal) =>
      attempt("campus_planrooms", `${portal.label} planroom`, async () => {
        // An empty list is normal for the small portals.
        const jobs = parsePlanroomHtml(await text(campusListUrl(portal.domain)));
        return { rows: jobs.map((j) => campusLead(j, portal, s.roof_keywords)) };
      }),
    ),
    attempt("lynn_bids", "Lynn Imaging bids", async () => {
      const posts = parseLynnFeed(await text(LYNN_FEED_URL));
      if (!posts.length) throw new Error("nothing parsed (feed layout changed?)");
      return { rows: posts.map((p) => lynnLead(p, s.roof_keywords)) };
    }),
    attempt("bgky_bids", "Bowling Green bids", async () => {
      const bids = parseBgkyBids(await text(BGKY_BIDS_URL));
      return { rows: bids.map((b) => cityLead(b, "bgky_bids", s.roof_keywords)) };
    }),
    attempt("paducah_bids", "Paducah bids", async () => {
      const bids = parsePaducahBids(await text(PADUCAH_BIDS_URL));
      if (!bids.length) throw new Error("nothing parsed (page layout changed?)");
      return { rows: bids.map((b) => cityLead(b, "paducah_bids", s.roof_keywords)) };
    }),
    // Tennessee.
    attempt("tn_stream", "TN STREAM bid list", async () => {
      const html = await text(STREAM_BID_LIST_URL);
      const projects = parseStreamBidList(html);
      // An empty list is possible; a page with accordion items and nothing read is a layout change.
      if (!projects.length && /accordion-item/.test(html))
        throw new Error("nothing parsed (page layout changed?)");
      return { rows: projects.map((p) => streamLead(p, s.roof_keywords)) };
    }),
    attempt("tn_stream", "TN STREAM RFPs", async () => {
      const rfps = parseStreamRfps(await text(STREAM_RFP_URL));
      return { rows: rfps.map((p) => streamLead(p, s.roof_keywords)) };
    }),
    ...UT_CAMPUSES.map((campus) =>
      attempt("ut_bids", `${campus.label} bids`, async () => {
        const html = await text(utBidsUrl(campus.slug), UT_HEADERS);
        if (!/Invitations? to Bid/i.test(html))
          throw new Error("no Invitations to Bid heading (page layout changed?)");
        // An empty list ("No information available at this time") is normal.
        return {
          rows: parseUtBids(html, campus).map((b) => utLead(b, campus, s.roof_keywords)),
        };
      }),
    ),
    attempt("nashville_permits", "Nashville permits", async () => {
      const permits = await fetchNashville(s);
      return { rows: permits.map((p) => nashvilleLead(p, s.roof_keywords)) };
    }),
    // Tennessee, round two.
    attempt("chattanooga_permits", "Chattanooga permits", async () => {
      const permits = await fetchChattanooga(Number(s.nashville_min_cost));
      return { rows: permits.map((p) => chattanoogaLead(p.permit, p, s.roof_keywords)) };
    }),
    attempt("knox_county_bids", "Knox County bids", async () => {
      const html = await text(KNOX_COUNTY_BIDS_URL);
      const bids = parseKnoxCountyBids(html);
      // An empty list is possible; a list with solicitation links and nothing read is not.
      if (!bids.length && /showfile\.php/i.test(html))
        throw new Error("nothing parsed (page layout changed?)");
      return { rows: bids.map((b) => knoxCountyLead(b, s.roof_keywords)) };
    }),
    ...TN_UNIVERSITIES.map((school) =>
      attempt("tn_university_bids", `${school.short} bids`, async () => {
        const html = await text(school.url, UT_HEADERS);
        if (!isTnUniversityPage(html, school))
          throw new Error("not the bid list page we know (page layout changed?)");
        // An empty list is normal (MTSU had none on Sep 29).
        return {
          rows: school.parse(html, school).map((b) => tnUniversityLead(b, school, s.roof_keywords)),
        };
      }),
    ),
  ];
  if (bidnetDue) {
    // One group after the other, one page at a time: BidNet never sees two requests at once.
    // The pages stop 40 s into the run so the page's refresh still answers inside its minute.
    const deadline = t0 + 40000;
    let abstracts = BIDNET_MAX_ABSTRACTS;
    let chain: Promise<unknown> = Promise.resolve();
    for (const group of BIDNET_GROUPS) {
      const p = chain.then(() =>
        attempt("bidnet", `BidNet ${group.state}`, async () => {
          const list = await fetchBidnetList(group, deadline);
          // Roof rows: the exact closing time from the abstract page, read once per closing day
          // (a stored time for the same day is reused).
          const roof = list.rows.filter((r) => isRoofLead(r.title, s.roof_keywords));
          const closings = new Map<string, { at: string; text: string }>();
          if (roof.length) {
            const { data: stored, error } = await admin
              .from("leads")
              .select("external_id, bid_at, raw")
              .eq("source", "bidnet")
              .in(
                "external_id",
                roof.map((r) => r.id),
              );
            if (error) throw new Error(error.message);
            for (const st of stored ?? []) {
              const raw = (st.raw ?? {}) as { closing_text?: string | null; closingOn?: string };
              const row = roof.find((r) => r.id === st.external_id);
              if (row && st.bid_at && raw.closing_text && raw.closingOn === row.closingOn)
                closings.set(row.id, { at: st.bid_at, text: raw.closing_text });
            }
            for (const row of roof) {
              if (closings.has(row.id) || abstracts <= 0 || Date.now() > deadline) continue;
              abstracts--;
              await pause(BIDNET_PAUSE_MS);
              const c = await fetchBidnetClosing(row.url);
              if (c) {
                closings.set(row.id, c);
                bidnetClosingsRead++;
              }
            }
          }
          return {
            rows: list.rows.map((r) => bidnetLead(r, group, s.roof_keywords, closings.get(r.id))),
            ...(list.problem ? { problem: list.problem } : {}),
          };
        }),
      );
      pulls.push(p);
      chain = p;
    }
  }
  if (samDue)
    for (const st of SAM_STATES)
      pulls.push(
        attempt("sam_gov", `SAM.gov ${st}`, async () => {
          const res = await fetchTimeout(samQueryUrl(samKey, 60, new Date(), st));
          const body = await res.text();
          if (!res.ok)
            throw new Error(`→ ${res.status} ${body.replace(/\s+/g, " ").slice(0, 200)}`.trim());
          const json = JSON.parse(body) as { opportunitiesData?: SamOpportunity[] };
          const ops = json.opportunitiesData ?? [];
          return { rows: ops.map((o) => samLead(o, s.roof_keywords, st)) };
        }),
      );
  const pulled = (await Promise.all(pulls)).filter((x): x is Pulled => x !== null);
  await stage(`lists pulled, ${pulled.length} answered; saving…`);
  const saved = await saveLeadRows(admin, pulled, { partial });
  const counts = saved.counts;
  const planroomCount = counts["ky_planroom"] ?? 0;
  const louisvilleCount = counts["louisville_permits"] ?? 0;
  const { fresh, newRoof, gone, notified } = saved;

  // With a planroom login in Lovable Cloud, read each open roof job's page for its owner
  // contact, A/E and plan holders (planroom.server.ts). Never fails the refresh. The
  // interactive refresh passes 0 and reads pages in follow-up calls instead.
  let enriched = 0;
  try {
    enriched = await enrichPlanroomLeads(admin, failed, opts.readPages ?? 0);
  } catch (e) {
    failed.push(`Planroom details ${e instanceof Error ? e.message : String(e)}`);
  }
  const note = `${planroomCount} planroom, ${louisvilleCount} Louisville, ${counts["lynn_bids"] ?? 0} Lynn, ${counts["bgky_bids"] ?? 0} Bowling Green, ${counts["paducah_bids"] ?? 0} Paducah, ${counts["campus_planrooms"] ?? 0} campus, ${samKey ? (samDue ? `${counts["sam_gov"] ?? 0} SAM.gov (KY+TN)` : `SAM.gov not pulled (once a day; next after ${samNext.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET)`) : "SAM.gov off (no key)"}, ${bidnetDue ? `${counts["bidnet"] ?? 0} BidNet (TN+KY; ${bidnetClosingsRead} closing times read)` : `BidNet not pulled (once a day; next after ${bidnetNext.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET)`}, TN: ${counts["tn_stream"] ?? 0} STREAM, ${counts["ut_bids"] ?? 0} UT, ${counts["nashville_permits"] ?? 0} Nashville, ${counts["chattanooga_permits"] ?? 0} Chattanooga, ${counts["knox_county_bids"] ?? 0} Knox County, ${counts["tn_university_bids"] ?? 0} TN universities, ${fresh.length} new (${newRoof.length} roof), ${gone} gone, ${enriched} job pages read${failed.length ? `; ${failed.join("; ")}` : ""}`;
  await admin.rpc("stamp_lead_fetch", { note });
  return {
    planroom: planroomCount,
    louisville: louisvilleCount,
    lynn: counts["lynn_bids"] ?? 0,
    bowling_green: counts["bgky_bids"] ?? 0,
    paducah: counts["paducah_bids"] ?? 0,
    campus: counts["campus_planrooms"] ?? 0,
    sam_gov: counts["sam_gov"] ?? 0,
    tn_stream: counts["tn_stream"] ?? 0,
    ut: counts["ut_bids"] ?? 0,
    nashville: counts["nashville_permits"] ?? 0,
    bidnet: counts["bidnet"] ?? 0,
    chattanooga: counts["chattanooga_permits"] ?? 0,
    knox_county: counts["knox_county_bids"] ?? 0,
    tn_universities: counts["tn_university_bids"] ?? 0,
    new_leads: fresh.length,
    new_roof_leads: newRoof.length,
    gone,
    enriched,
    failed,
    notified,
    note,
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

export interface BrowserImportResult {
  source: BrowserSource;
  /** Rows the script sent. */
  received: number;
  /** Open solicitations after the round rule (one per base number), saved. */
  open: number;
  roof: number;
  new_leads: number;
  new_roof_leads: number;
  gone: number;
  notified: number;
}

/**
 * The nightly browser job's rows for one portal (already checked against browserImportSchema):
 * keep each solicitation's current round, map to leads, save them exactly as a refresh saves
 * a list (saveLeadRows: upsert, gone-marking for this source, new-roof notifications), and
 * stamp lead_settings.source_fetched_at[source]. An empty list is "nothing open" and retires
 * the source's open leads; a failed browser run posts nothing, so nothing is retired.
 */
export async function importBrowserBids(
  sb: Client,
  payload: BrowserImportPayload,
): Promise<BrowserImportResult> {
  const admin = await serverClient(sb);
  const { data: settings, error: sErr } = await admin
    .from("lead_settings")
    .select("roof_keywords")
    .eq("id", 1)
    .single();
  if (sErr) throw new Error(sErr.message);
  const open = currentRounds(payload.rows);
  const rows = open.map((r) => browserBidLead(r, payload.source, settings.roof_keywords));
  const saved = await saveLeadRows(admin, [{ source: payload.source, rows, count: rows.length }]);
  // Read the stamps again right before writing them, so a refresh that stamped SAM.gov or
  // BidNet a moment ago is not overwritten.
  const { data: st, error: tErr } = await admin
    .from("lead_settings")
    .select("source_fetched_at")
    .eq("id", 1)
    .single();
  if (tErr) throw new Error(tErr.message);
  const stamps = {
    ...((st.source_fetched_at as Record<string, string> | null) ?? {}),
    [payload.source]: new Date().toISOString(),
  };
  const { error: uErr } = await admin
    .from("lead_settings")
    .update({ source_fetched_at: stamps })
    .eq("id", 1);
  if (uErr) throw new Error(`could not stamp ${payload.source}: ${uErr.message}`);
  return {
    source: payload.source,
    received: payload.rows.length,
    open: rows.length,
    roof: rows.filter((r) => r.is_roof).length,
    new_leads: saved.fresh.length,
    new_roof_leads: saved.newRoof.length,
    gone: saved.gone,
    notified: saved.notified,
  };
}
