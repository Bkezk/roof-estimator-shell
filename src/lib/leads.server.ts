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

export type LeadSource =
  | "ky_planroom"
  | "louisville_permits"
  | "lynn_bids"
  | "bgky_bids"
  | "paducah_bids"
  | "campus_planrooms"
  | "sam_gov";
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

const UA = "JBK Portal construction leads";
/** Every outside call gives up after 25 s so one slow site cannot hang the whole run (Lynn's feed has taken 15 s). */
const fetchTimeout = (url: string, ms = 25000) =>
  fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms) });

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

/** The one nightly SAM.gov call: roofing NAICS, Kentucky, posted in the last `days`. */
export function samQueryUrl(apiKey: string, days = 60, now = new Date()): string {
  const q = new URLSearchParams({
    api_key: apiKey,
    postedFrom: mmddyyyy(new Date(now.getTime() - days * 86400000)),
    postedTo: mmddyyyy(now),
    ncode: SAM_NAICS_ROOFING,
    state: "KY",
    ptype: "o,p,k",
    limit: "200",
    offset: "0",
  });
  return `${SAM_SEARCH_URL}?${q.toString()}`;
}

export function samLead(o: SamOpportunity, keywords: string[]): LeadInsert {
  const agency = (o.fullParentPathName ?? "")
    .split(".")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(-2)
    .join(" / ");
  const poc = (o.pointOfContact ?? []).find((c) => c.fullName || c.email) ?? null;
  const contact = poc ? [poc.fullName, poc.email, poc.phone].filter(Boolean).join(" — ") : null;
  const city = o.placeOfPerformance?.city?.name ?? null;
  const st = o.placeOfPerformance?.state?.code ?? "KY";
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
  new_leads: number;
  new_roof_leads: number;
  gone: number;
  /** Planroom job pages read for contacts this run (0 without a planroom login). */
  enriched: number;
  failed: string[];
  notified: number;
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
  const rows: LeadInsert[] = [];
  const fetchedSources = new Set<LeadSource>();
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
    `running since ${new Date().toISOString()}: pulling ${CAMPUS_PLANROOMS.length + 5} lists…`,
  );

  // Every list at once (the slowest site, not the sum, sets the run's length); each source
  // that fails is reported and skipped.
  const counts: Record<string, number> = {};
  const samKey = process.env["SAM_GOV_API_KEY"]?.trim();
  type Pulled = { source: LeadSource; rows: LeadInsert[]; count: number };
  const attempt = async (
    source: LeadSource,
    label: string,
    run: () => Promise<{ rows: LeadInsert[]; count?: number }>,
  ): Promise<Pulled | null> => {
    try {
      const r = await run();
      return { source, rows: r.rows, count: r.count ?? r.rows.length };
    } catch (e) {
      failed.push(`${label} ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const text = async (url: string) => {
    const res = await fetchTimeout(url);
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
  ];
  if (samKey)
    pulls.push(
      attempt("sam_gov", "SAM.gov", async () => {
        const res = await fetchTimeout(samQueryUrl(samKey));
        const body = await res.text();
        if (!res.ok)
          throw new Error(`→ ${res.status} ${body.replace(/\s+/g, " ").slice(0, 200)}`.trim());
        const json = JSON.parse(body) as { opportunitiesData?: SamOpportunity[] };
        const ops = json.opportunitiesData ?? [];
        return { rows: ops.map((o) => samLead(o, s.roof_keywords)) };
      }),
    );
  const pulled = (await Promise.all(pulls)).filter((x): x is Pulled => x !== null);
  await stage(`lists pulled, ${pulled.length} answered; saving…`);
  // Lynn's feed repeats the state and campus planroom jobs: keep the planroom copies.
  let lynnDuplicates: string[] = [];
  const planroomRows = pulled
    .filter((x) => x.source === "ky_planroom" || x.source === "campus_planrooms")
    .flatMap((x) => x.rows);
  for (const x of pulled) {
    if (x.source === "lynn_bids") {
      const { keep, dropped } = dropPlanroomDuplicates(x.rows, planroomRows);
      lynnDuplicates = dropped;
      x.rows = keep;
    }
    rows.push(...x.rows);
    counts[x.source] = (counts[x.source] ?? 0) + x.count;
    fetchedSources.add(x.source);
  }
  const planroomCount = counts["ky_planroom"] ?? 0;
  const louisvilleCount = counts["louisville_permits"] ?? 0;

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
  if (lynnDuplicates.length) {
    // A Lynn copy of a state job stored before the planroom row existed: retire it.
    const { data: g, error } = await admin
      .from("leads")
      .update({ gone_at: new Date().toISOString() })
      .eq("source", "lynn_bids")
      .is("gone_at", null)
      .in("external_id", lynnDuplicates)
      .select("id");
    if (error) throw new Error(error.message);
    gone += g?.length ?? 0;
  }
  for (const source of fetchedSources) {
    // Lynn's feed is the latest 25 posts; scrolling off it is not a withdrawal.
    if (source === "lynn_bids") continue;
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

  // With a planroom login in Lovable Cloud, read each open roof job's page for its owner
  // contact, A/E and plan holders (planroom.server.ts). Never fails the refresh. The
  // interactive refresh passes 0 and reads pages in follow-up calls instead.
  let enriched = 0;
  try {
    enriched = await enrichPlanroomLeads(admin, failed, opts.readPages ?? 0);
  } catch (e) {
    failed.push(`Planroom details ${e instanceof Error ? e.message : String(e)}`);
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
  const note = `${planroomCount} planroom, ${louisvilleCount} Louisville, ${counts["lynn_bids"] ?? 0} Lynn, ${counts["bgky_bids"] ?? 0} Bowling Green, ${counts["paducah_bids"] ?? 0} Paducah, ${counts["campus_planrooms"] ?? 0} campus, ${samKey ? `${counts["sam_gov"] ?? 0} SAM.gov` : "SAM.gov off (no key)"}, ${fresh.length} new (${newRoof.length} roof), ${gone} gone, ${enriched} job pages read${failed.length ? `; ${failed.join("; ")}` : ""}`;
  await admin.rpc("stamp_lead_fetch", { note });
  return {
    planroom: planroomCount,
    louisville: louisvilleCount,
    lynn: counts["lynn_bids"] ?? 0,
    bowling_green: counts["bgky_bids"] ?? 0,
    paducah: counts["paducah_bids"] ?? 0,
    campus: counts["campus_planrooms"] ?? 0,
    sam_gov: counts["sam_gov"] ?? 0,
    new_leads: fresh.length,
    new_roof_leads: newRoof.length,
    gone,
    enriched,
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
