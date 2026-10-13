/**
 * CenterPoint Connect → portal customer import (owner, Oct 13). CenterPoint's Book of Business
 * exports three CSVs — Companies, Properties, Contacts — and this module turns them into a plan
 * of rows for crm_accounts, crm_sites and crm_contacts plus a report the office reads before
 * anything is written. Pure: no I/O, no clock, no database. The server functions
 * (centerpoint-import.functions.ts) load the live lookups, call `planCenterpointImport`, and
 * either return the report (dry run) or write the plan.
 *
 * The owner's decisions, implemented here as written:
 *  1. account managers map to users by full name (ci, trimmed); "CP SUPPORT" and any other
 *     unmatched name → null, reported once per distinct name with its count;
 *  2. a company with no phone or email anywhere is imported anyway (source 'import' is exempt
 *     from crm_accounts_contact_required since 20261013120000_centerpoint_import.sql);
 *  3. twins: two companies with the same name and the same normalised address fold into one
 *     (most recent "Recent Activity" wins; tie: the one with an External Identifier, then the
 *     lower ID) and the loser's ID is kept in centerpoint_alias_ids; the same for properties
 *     within one company; contacts named N/A are skipped and same-name contacts with the same
 *     email or phone fold (lower ID kept); same name but a different address is imported twice
 *     and flagged;
 *  4. the CenterPoint columns nobody uses are ignored (Count, Close Rate, Related, …);
 *  5. CP_SERVICE_TYPE_MAP maps CenterPoint's service types for the later ticket import.
 *
 * Re-running is safe: a company already carrying the CenterPoint ID (or holding it as an alias)
 * is skipped, one with the same name is linked (only the CenterPoint ID, and a blank customer
 * number, are set), and the same goes for properties and contacts.
 */
import { CRM_MAX } from "@/lib/crm-account";

// ---- CSV ------------------------------------------------------------------------------------

/** RFC 4180: quoted fields, "" escapes, embedded newlines, CRLF or LF, an optional UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const n = s.length;
  const endRow = () => {
    row.push(cell);
    cell = "";
    // A blank line (one empty cell) is not a row.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = s[i] as string;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          quoted = false;
          i++;
        }
      } else {
        cell += c;
        i++;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
    } else if (c === "\r") {
      i++;
      if (s[i] === "\n") i++;
      endRow();
    } else if (c === "\n") {
      i++;
      endRow();
    } else {
      cell += c;
      i++;
    }
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/** CenterPoint writes "&amp;" and friends into names; the office never typed them. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

export const COMPANY_HEADERS = [
  "ID",
  "Company",
  "External Identifier",
  "Count",
  "Address",
  "City",
  "County",
  "State",
  "Zip",
  "Manager",
  "Recent Activity",
  "Close Rate",
  "Related",
  "Tax Exempt",
  "Credit Hold",
  "Integration",
] as const;

export const PROPERTY_HEADERS = [
  "ID",
  "Property",
  "Building Number",
  "Address",
  "City",
  "Zip Code",
  "County",
  "State",
  "Company",
  "Contractor",
  "Account Manager",
  "Client Approved",
  "Close Rate",
  "Tax Exempt",
  "Credit Hold",
  "Integration",
  "SQS",
  "Inspected By",
  "Inspected Date",
  "Recent Activity",
] as const;

export const CONTACT_HEADERS = [
  "ID",
  "Name",
  "Contact ID",
  "Company",
  "Address",
  "Address2",
  "City",
  "State",
  "Zip",
  "County",
  "Position",
  "Properties",
  "Office",
  "Ext",
  "Mobile",
  "Email",
  "Recent Activity",
  "Last Login",
  "Created At",
  "Manager",
] as const;

export interface CompanyRow {
  id: string;
  name: string;
  externalId: string;
  address: string;
  city: string;
  county: string;
  state: string;
  zip: string;
  manager: string;
  recentActivity: string;
}

export interface PropertyRow {
  id: string;
  name: string;
  address: string;
  city: string;
  zip: string;
  county: string;
  state: string;
  company: string;
  manager: string;
  recentActivity: string;
}

export interface ContactRow {
  id: string;
  name: string;
  company: string;
  position: string;
  office: string;
  ext: string;
  mobile: string;
  email: string;
  createdAt: string;
}

/** Column index by header; throws naming the first missing header. */
function columns(rows: string[][], file: string, headers: readonly string[]) {
  const head = rows[0];
  if (!head) throw new Error(`${file} CSV is empty`);
  const idx = new Map<string, number>();
  head.forEach((h, i) => {
    const k = h.trim();
    if (!idx.has(k)) idx.set(k, i);
  });
  for (const h of headers)
    if (!idx.has(h)) throw new Error(`${file} CSV is missing the "${h}" column`);
  return (row: string[], h: string) => decodeEntities((row[idx.get(h) as number] ?? "").trim());
}

const dataRows = (rows: string[][]) => rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));

export function readCompanies(rows: string[][]): CompanyRow[] {
  const col = columns(rows, "Companies", COMPANY_HEADERS);
  return dataRows(rows).map((r) => ({
    id: col(r, "ID"),
    name: col(r, "Company"),
    externalId: col(r, "External Identifier"),
    address: col(r, "Address"),
    city: col(r, "City"),
    county: col(r, "County"),
    state: col(r, "State"),
    zip: col(r, "Zip"),
    manager: col(r, "Manager"),
    recentActivity: col(r, "Recent Activity"),
  }));
}

export function readProperties(rows: string[][]): PropertyRow[] {
  const col = columns(rows, "Properties", PROPERTY_HEADERS);
  return dataRows(rows).map((r) => ({
    id: col(r, "ID"),
    name: col(r, "Property"),
    address: col(r, "Address"),
    city: col(r, "City"),
    zip: col(r, "Zip Code"),
    county: col(r, "County"),
    state: col(r, "State"),
    company: col(r, "Company"),
    manager: col(r, "Account Manager"),
    recentActivity: col(r, "Recent Activity"),
  }));
}

export function readContacts(rows: string[][]): ContactRow[] {
  const col = columns(rows, "Contacts", CONTACT_HEADERS);
  return dataRows(rows).map((r) => ({
    id: col(r, "ID"),
    name: col(r, "Name"),
    company: col(r, "Company"),
    position: col(r, "Position"),
    office: col(r, "Office"),
    ext: col(r, "Ext"),
    mobile: col(r, "Mobile"),
    email: col(r, "Email"),
    createdAt: col(r, "Created At"),
  }));
}

// ---- Normalisers ----------------------------------------------------------------------------

const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(US_STATES));

/**
 * "Kentucky" / "Ky" / "KE" → "KY"; a real two-letter code is kept upper-cased; anything else
 * is null with `bad` set to the text as typed (blank → null, nothing flagged).
 */
export function normalizeState(raw: string): { state: string | null; bad: string | null } {
  const t = raw.trim();
  if (!t) return { state: null, bad: null };
  const lower = t.toLowerCase().replace(/\.$/, "");
  const named = US_STATES[lower];
  if (named) return { state: named, bad: null };
  const up = t.toUpperCase();
  // CenterPoint's "KE" is Kentucky (owner, Oct 13: every KE row is a Kentucky city or county).
  if (up === "KE") return { state: "KY", bad: null };
  if (up.length === 2 && STATE_CODES.has(up)) return { state: up, bad: null };
  return { state: null, bad: t };
}

/** "Laurel County" → "Laurel"; "Fayette -0004" → "Fayette". */
export function normalizeCountyName(raw: string): string {
  return raw
    .trim()
    .replace(/\s*-\s*\d+$/, "")
    .replace(/\s+county$/i, "")
    .trim();
}

export type CountyMatch =
  { id: string; status: "matched" } | { id: null; status: "blank" | "outside" | "unknown" };

/**
 * The county_codes row for (county, state) — only KY and TN have codes; a county outside those
 * two states is "outside" (counted, not flagged), a KY / TN name with no code is "unknown"
 * (flagged once per distinct value).
 */
export function matchCounty(
  rawCounty: string,
  state: string | null,
  codes: readonly { id: string; county: string; state: string }[],
): CountyMatch {
  const name = normalizeCountyName(rawCounty);
  if (!name) return { id: null, status: "blank" };
  if (state !== "KY" && state !== "TN") return { id: null, status: "outside" };
  const key = name.toLowerCase();
  const hit = codes.find(
    (c) => c.state.toUpperCase() === state && c.county.trim().toLowerCase() === key,
  );
  return hit ? { id: hit.id, status: "matched" } : { id: null, status: "unknown" };
}

/**
 * Digits only; a leading 1 on eleven digits is dropped; ten digits become "(606) 526-6992";
 * fewer (or blank) is null, with `odd` carrying the text as typed when it was not blank.
 */
export function normalizePhone(raw: string): { phone: string | null; odd: string | null } {
  const t = raw.trim();
  if (!t) return { phone: null, odd: null };
  let d = t.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return { phone: null, odd: t };
  return { phone: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, odd: null };
}

/** "x<ext>" appended to an office phone when CenterPoint had an extension. */
export function withExtension(phone: string | null, ext: string): string | null {
  const e = ext.trim().replace(/^(x|ext\.?)\s*/i, "");
  if (!phone || !e) return phone;
  return `${phone} x${e}`;
}

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** Trimmed and lower-cased; never dropped — `looksWrong` lists it for the office. */
export function normalizeEmail(raw: string): { email: string | null; looksWrong: boolean } {
  const t = raw.trim();
  if (!t) return { email: null, looksWrong: false };
  const email = t.toLowerCase();
  return { email, looksWrong: !EMAIL_RE.test(email) };
}

/** Two addresses that are the same street written twice compare equal. */
export function addressKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
}
const STREET_WORDS: Record<string, string> = {
  avenue: "ave",
  street: "st",
  road: "rd",
  drive: "dr",
  lane: "ln",
  boulevard: "blvd",
  parkway: "pkwy",
  highway: "hwy",
  court: "ct",
  circle: "cir",
  place: "pl",
  suite: "ste",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
};

export const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** A six-digit customer number as the office types it; anything else is reported. */
export const isSixDigit = (s: string) => /^\d{6}$/.test(s.trim());

const SKIPPED_CONTACT_NAMES = new Set(["n/a", "na", "none", "-", ""]);
/** A contact row that is really "no contact" (CenterPoint required a name). */
export const isPlaceholderName = (name: string) => SKIPPED_CONTACT_NAMES.has(nameKey(name));

// ---- Dates (CenterPoint exports Eastern wall-clock time) ------------------------------------

const NY = "America/New_York";
const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: NY,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
function nyOffsetMs(t: number): number {
  const p: Record<string, number> = {};
  for (const x of nyParts.formatToParts(new Date(t)))
    if (x.type !== "literal") p[x.type] = +x.value;
  const wall = Date.UTC(
    p["year"] ?? 1970,
    (p["month"] ?? 1) - 1,
    p["day"] ?? 1,
    (p["hour"] ?? 0) % 24,
    p["minute"] ?? 0,
    p["second"] ?? 0,
  );
  return wall - t;
}

/**
 * "10/07/2026 07:23:00 PM" (Eastern) or an ISO 8601 stamp → ISO in UTC; null when it is blank
 * or not a date.
 */
export function parseCpDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const us =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(t);
  if (us) {
    const mo = +(us[1] as string);
    const d = +(us[2] as string);
    const y = +(us[3] as string);
    let h = us[4] ? +us[4] : 0;
    const mi = us[5] ? +us[5] : 0;
    const s = us[6] ? +us[6] : 0;
    const ap = us[7]?.toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
    let utc = asUtc - nyOffsetMs(asUtc);
    const off2 = nyOffsetMs(utc);
    if (asUtc - off2 !== utc) utc = asUtc - off2;
    return new Date(utc).toISOString();
  }
  const ms = Date.parse(t);
  return Number.isFinite(ms) && /\d{4}-\d{2}-\d{2}/.test(t) ? new Date(ms).toISOString() : null;
}

// ---- Service types (for the later ticket import) --------------------------------------------

/** CenterPoint's service type → the portal's service_tickets.service_type (ci; else "other"). */
export const CP_SERVICE_TYPE_MAP: Record<string, string> = {
  leak: "leak",
  scope: "scope",
  warranty: "warranty",
  inspection: "inspection",
};
export function cpServiceType(raw: string): string {
  return CP_SERVICE_TYPE_MAP[raw.trim().toLowerCase()] ?? "other";
}

// ---- Lookups (the live portal) --------------------------------------------------------------

export interface ImportLookups {
  profiles: readonly { id: string; full_name: string | null; email?: string; role?: string }[];
  county_codes: readonly { id: string; code?: string; county: string; state: string }[];
  accounts: readonly {
    id: string;
    name: string;
    centerpoint_company_id: string | null;
    centerpoint_alias_ids?: readonly string[] | null;
    deleted_at: string | null;
    phone?: string | null;
    email?: string | null;
    mobile?: string | null;
    external_id?: string | null;
  }[];
  sites: readonly {
    id: string;
    account_id: string;
    name: string;
    centerpoint_property_id: string | null;
    centerpoint_alias_ids?: readonly string[] | null;
    deleted_at?: string | null;
  }[];
  contacts: readonly {
    id: string;
    account_id: string;
    name: string;
    centerpoint_contact_id: string | null;
    email?: string | null;
    mobile?: string | null;
    office_phone?: string | null;
    deleted_at?: string | null;
  }[];
}

// ---- The plan -------------------------------------------------------------------------------

export interface AccountInsert {
  centerpoint_company_id: string;
  centerpoint_alias_ids: string[];
  name: string;
  kind: "company";
  source: "import";
  external_id: string | null;
  address1: string | null;
  address2: null;
  city: string | null;
  state: string | null;
  zip: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  mobile: string | null;
  account_manager_id: string | null;
  mailing_same: true;
}

export interface AccountLink {
  /** The portal account. */
  id: string;
  name: string;
  centerpoint_company_id: string;
  set: { centerpoint_company_id: string; centerpoint_alias_ids?: string[]; external_id?: string };
}

export interface SiteInsert {
  /** The CenterPoint company (kept twin) the site belongs to; the apply step resolves the id. */
  companyCpId: string;
  row: {
    centerpoint_property_id: string;
    centerpoint_alias_ids: string[];
    name: string;
    address1: string | null;
    address2: null;
    city: string | null;
    state: string | null;
    zip: string | null;
    county_code_id: string | null;
  };
}

export interface SiteLink {
  id: string;
  name: string;
  set: { centerpoint_property_id: string; centerpoint_alias_ids?: string[] };
}

export interface ContactInsert {
  companyCpId: string;
  row: {
    centerpoint_contact_id: string;
    name: string;
    position: string | null;
    email: string | null;
    mobile: string | null;
    office_phone: string | null;
    created_at?: string;
  };
}

export interface ContactLink {
  id: string;
  name: string;
  set: { centerpoint_contact_id: string };
}

export interface FlagRow {
  /** CenterPoint ID of the row. */
  id: string;
  name: string;
  issue: string;
}
export interface NamedCount {
  name: string;
  count: number;
}

export interface ImportReport {
  counts: {
    companies: {
      rows: number;
      new: number;
      linked: number;
      already: number;
      folded: number;
      sameNameDifferentAddress: number;
      noContactInfo: number;
      outsideKyTn: number;
      managerFromProperties: number;
      contactInfoFromPlaceholder: number;
    };
    properties: {
      rows: number;
      new: number;
      linked: number;
      already: number;
      folded: number;
      sameNameDifferentAddress: number;
      ambiguousCompany: number;
      noCompany: number;
      outsideKyTn: number;
    };
    contacts: {
      rows: number;
      new: number;
      linked: number;
      already: number;
      skippedNames: number;
      folded: number;
      noCompany: number;
    };
    clamps: number;
  };
  /** Named lists: the rows behind a count (CenterPoint ID, name, what is wrong). */
  flags: Record<string, FlagRow[]>;
  unmatchedManagers: NamedCount[];
  unmatchedCounties: NamedCount[];
  badEmails: FlagRow[];
  oddPhones: FlagRow[];
  nonSixDigitExternalIds: FlagRow[];
}

export interface ImportPlan {
  accountsToInsert: AccountInsert[];
  accountsToLink: AccountLink[];
  sitesToInsert: SiteInsert[];
  sitesToLink: SiteLink[];
  contactsToInsert: ContactInsert[];
  contactsToLink: ContactLink[];
  /** CenterPoint company ID → the portal account it already is or links to. */
  existingAccountIds: Record<string, string>;
  report: ImportReport;
}

export interface ImportFiles {
  companies: string;
  properties: string;
  contacts: string;
}

const byId = <T extends { id: string }>(a: T, b: T) => cmpId(a.id, b.id);
/** CenterPoint IDs are integers; compare as such so "99" sorts before "100". */
export function cmpId(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}
const laterFirst = (a: string | null, b: string | null) => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
};
/** Earliest first; rows without a date last. */
const earlierFirst = (a: string | null, b: string | null) => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

/** Companies, properties and contacts → rows for the three CRM tables plus the report. */
export function planCenterpointImport(files: ImportFiles, lookups: ImportLookups): ImportPlan {
  const companies = readCompanies(parseCsv(files.companies));
  const properties = readProperties(parseCsv(files.properties));
  const contacts = readContacts(parseCsv(files.contacts));

  const flags: Record<string, FlagRow[]> = {};
  const flag = (list: string, id: string, name: string, issue: string) =>
    (flags[list] ??= []).push({ id, name, issue });
  const counter = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const unmatchedManagers = new Map<string, number>();
  const unmatchedCounties = new Map<string, number>();
  const badEmails: FlagRow[] = [];
  const oddPhones: FlagRow[] = [];
  const nonSixDigit: FlagRow[] = [];
  let clamps = 0;
  const clamp = (s: string | null, max: number): string | null => {
    if (s === null) return null;
    if (s.length <= max) return s;
    clamps++;
    return s.slice(0, max);
  };
  const text = (s: string, max: number) => clamp(s.trim() || null, max);

  const managerId = (() => {
    const m = new Map<string, string>();
    for (const p of [...lookups.profiles].sort(byId)) {
      const k = nameKey(p.full_name ?? "");
      if (k && !m.has(k)) m.set(k, p.id);
    }
    return (name: string): string | null => {
      const k = nameKey(name);
      if (!k) return null;
      const id = m.get(k);
      if (id) return id;
      counter(unmatchedManagers, name.trim());
      return null;
    };
  })();

  const county = (raw: string, state: string | null, id: string, name: string, kind: string) => {
    const m = matchCounty(raw, state, lookups.county_codes);
    if (m.status === "unknown") {
      counter(unmatchedCounties, raw.trim());
      flag(`${kind} with a county that is not in county_codes`, id, name, `county "${raw.trim()}"`);
    }
    return m;
  };
  const state = (raw: string, id: string, name: string, kind: string) => {
    const s = normalizeState(raw);
    if (s.bad) flag(`${kind} with a state that is not a US state`, id, name, `state "${s.bad}"`);
    return s.state;
  };

  // ---- Companies: twins, same-name groups ----------------------------------------------------
  const counts: ImportReport["counts"] = {
    companies: {
      rows: companies.length,
      new: 0,
      linked: 0,
      already: 0,
      folded: 0,
      sameNameDifferentAddress: 0,
      noContactInfo: 0,
      outsideKyTn: 0,
      managerFromProperties: 0,
      contactInfoFromPlaceholder: 0,
    },
    properties: {
      rows: properties.length,
      new: 0,
      linked: 0,
      already: 0,
      folded: 0,
      sameNameDifferentAddress: 0,
      ambiguousCompany: 0,
      noCompany: 0,
      outsideKyTn: 0,
    },
    contacts: {
      rows: contacts.length,
      new: 0,
      linked: 0,
      already: 0,
      skippedNames: 0,
      folded: 0,
      noCompany: 0,
    },
    clamps: 0,
  };

  type Kept<T> = { row: T; aliases: string[]; activity: string | null };
  const foldTwins = <T extends { id: string; recentActivity: string }>(
    rows: readonly T[],
    key: (r: T) => string,
    prefer: (a: T, b: T) => number,
    onFold: (loser: T, winner: T) => void,
  ): Kept<T>[] => {
    const groups = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      const g = groups.get(k);
      if (g) g.push(r);
      else groups.set(k, [r]);
    }
    const out: Kept<T>[] = [];
    for (const g of groups.values()) {
      const sorted = [...g].sort(
        (a, b) =>
          laterFirst(parseCpDate(a.recentActivity), parseCpDate(b.recentActivity)) ||
          prefer(a, b) ||
          cmpId(a.id, b.id),
      );
      const winner = sorted[0] as T;
      const losers = sorted.slice(1);
      for (const l of losers) onFold(l, winner);
      out.push({
        row: winner,
        aliases: losers.map((l) => l.id).sort(cmpId),
        activity: parseCpDate(winner.recentActivity),
      });
    }
    return out.sort((a, b) => cmpId(a.row.id, b.row.id));
  };

  const keptCompanies = foldTwins(
    companies,
    (c) => `${nameKey(c.name)}|${addressKey(c.address)}`,
    (a, b) => Number(!!b.externalId.trim()) - Number(!!a.externalId.trim()),
    (loser, winner) => {
      counts.companies.folded++;
      flag(
        "companies folded into a twin (same name and address)",
        loser.id,
        loser.name,
        `folded into ${winner.id}; its ID is kept as an alias`,
      );
    },
  );
  // Same name, different address: imported twice, flagged.
  const companiesByName = new Map<string, Kept<CompanyRow>[]>();
  for (const k of keptCompanies) {
    const key = nameKey(k.row.name);
    const g = companiesByName.get(key);
    if (g) g.push(k);
    else companiesByName.set(key, [k]);
  }
  for (const g of companiesByName.values())
    if (g.length > 1)
      for (const k of g) {
        counts.companies.sameNameDifferentAddress++;
        flag(
          "companies with the same name but a different address (both imported)",
          k.row.id,
          k.row.name,
          `${g.length} companies named this; address "${k.row.address}", ${k.row.city}`,
        );
      }

  /** The kept company a property / contact belongs to, by company name (ci). */
  const companyFor = (
    companyName: string,
    city: string | null,
  ): { kept: Kept<CompanyRow> | null; ambiguous: boolean } => {
    const g = companiesByName.get(nameKey(companyName));
    if (!g || g.length === 0) return { kept: null, ambiguous: false };
    if (g.length === 1) return { kept: g[0] as Kept<CompanyRow>, ambiguous: false };
    if (city) {
      const sameCity = g.filter((k) => nameKey(k.row.city) === nameKey(city));
      if (sameCity.length === 1) return { kept: sameCity[0] as Kept<CompanyRow>, ambiguous: false };
    }
    const first = [...g].sort(
      (a, b) => laterFirst(a.activity, b.activity) || cmpId(a.row.id, b.row.id),
    )[0] as Kept<CompanyRow>;
    return { kept: first, ambiguous: true };
  };

  // ---- Properties: per company, twins -------------------------------------------------------
  const propsByCompany = new Map<string, PropertyRow[]>();
  for (const p of properties) {
    const { kept, ambiguous } = companyFor(p.company, p.city);
    if (!kept) {
      counts.properties.noCompany++;
      flag(
        "properties whose company is not in the Companies file (not imported)",
        p.id,
        p.name,
        `company "${p.company}"`,
      );
      continue;
    }
    if (ambiguous) {
      counts.properties.ambiguousCompany++;
      flag(
        "properties attached to the first of several same-name companies (check)",
        p.id,
        p.name,
        `company "${p.company}" → ${kept.row.id} (${kept.row.city})`,
      );
    }
    const g = propsByCompany.get(kept.row.id);
    if (g) g.push(p);
    else propsByCompany.set(kept.row.id, [p]);
  }
  const keptProperties: { companyCpId: string; kept: Kept<PropertyRow> }[] = [];
  for (const [companyCpId, rows] of [...propsByCompany.entries()].sort((a, b) =>
    cmpId(a[0], b[0]),
  )) {
    const kept = foldTwins(
      rows,
      (p) => `${nameKey(p.name)}|${addressKey(p.address)}`,
      () => 0,
      (loser, winner) => {
        counts.properties.folded++;
        flag(
          "properties folded into a twin (same company, name and address)",
          loser.id,
          loser.name,
          `folded into ${winner.id}; its ID is kept as an alias`,
        );
      },
    );
    const byName = new Map<string, Kept<PropertyRow>[]>();
    for (const k of kept) {
      const key = nameKey(k.row.name);
      const g = byName.get(key);
      if (g) g.push(k);
      else byName.set(key, [k]);
    }
    for (const g of byName.values())
      if (g.length > 1)
        for (const k of g) {
          counts.properties.sameNameDifferentAddress++;
          flag(
            "properties with the same name but a different address under one company (both imported)",
            k.row.id,
            k.row.name,
            `${g.length} properties named this; address "${k.row.address}", ${k.row.city}`,
          );
        }
    for (const k of kept) keptProperties.push({ companyCpId, kept: k });
  }

  // ---- Contacts: placeholders, folds --------------------------------------------------------
  interface PreparedContact {
    row: ContactRow;
    companyCpId: string;
    name: string;
    position: string | null;
    email: string | null;
    office: string | null;
    mobile: string | null;
    createdAt: string | null;
  }
  const prepared: PreparedContact[] = [];
  /**
   * Contacts named N/A are not contacts (decision 3c) but CenterPoint often put the company's
   * own phone or email on them: they are kept aside and speak for a company that has no named
   * contact with an email or a phone (contact_name stays blank).
   */
  const placeholders = new Map<string, PreparedContact[]>();
  for (const c of [...contacts].sort(byId)) {
    const placeholder = isPlaceholderName(c.name);
    if (placeholder) counts.contacts.skippedNames++;
    const { kept } = companyFor(c.company, null);
    if (!kept) {
      counts.contacts.noCompany++;
      flag(
        "contacts whose company is not in the Companies file (not imported)",
        c.id,
        c.name,
        `company "${c.company}"`,
      );
      continue;
    }
    const em = normalizeEmail(c.email);
    if (em.looksWrong) badEmails.push({ id: c.id, name: c.name, issue: `email "${c.email}"` });
    const off = normalizePhone(c.office);
    if (off.odd) oddPhones.push({ id: c.id, name: c.name, issue: `office phone "${off.odd}"` });
    const mob = normalizePhone(c.mobile);
    if (mob.odd) oddPhones.push({ id: c.id, name: c.name, issue: `mobile "${mob.odd}"` });
    let target = prepared;
    if (placeholder) {
      target = placeholders.get(kept.row.id) ?? [];
      placeholders.set(kept.row.id, target);
    }
    target.push({
      row: c,
      companyCpId: kept.row.id,
      name: c.name.trim(),
      position: text(c.position, CRM_MAX.position),
      email: clamp(em.email, CRM_MAX.email),
      office: clamp(withExtension(off.phone, c.ext), CRM_MAX.office_phone),
      mobile: clamp(mob.phone, CRM_MAX.mobile),
      createdAt: parseCpDate(c.createdAt),
    });
  }
  // Same company, same name, and the same email or phone → one contact (lower ID kept).
  const contactsByCompany = new Map<string, PreparedContact[]>();
  {
    const seen = new Map<string, PreparedContact[]>();
    for (const p of prepared) {
      const key = `${p.companyCpId}|${nameKey(p.name)}`;
      const g = seen.get(key) ?? [];
      const phones = (x: PreparedContact) => [x.office, x.mobile].filter(Boolean) as string[];
      const twin = g.find(
        (x) => (p.email && x.email === p.email) || phones(p).some((ph) => phones(x).includes(ph)),
      );
      if (twin) {
        counts.contacts.folded++;
        flag(
          "contacts folded into a twin (same company, name and email or phone)",
          p.row.id,
          p.name,
          `same as ${twin.row.id}; not imported`,
        );
        continue;
      }
      g.push(p);
      seen.set(key, g);
      const list = contactsByCompany.get(p.companyCpId);
      if (list) list.push(p);
      else contactsByCompany.set(p.companyCpId, [p]);
    }
  }

  // ---- Matching against the live portal -----------------------------------------------------
  const liveAccounts = lookups.accounts.filter((a) => !a.deleted_at);
  const accountByCp = new Map<string, string>();
  const accountByName = new Map<string, string>();
  for (const a of [...liveAccounts].sort(byId)) {
    if (a.centerpoint_company_id && !accountByCp.has(a.centerpoint_company_id))
      accountByCp.set(a.centerpoint_company_id, a.id);
    for (const alias of a.centerpoint_alias_ids ?? [])
      if (!accountByCp.has(alias)) accountByCp.set(alias, a.id);
    const k = nameKey(a.name);
    if (k && !accountByName.has(k)) accountByName.set(k, a.id);
  }
  const accountById = new Map(liveAccounts.map((a) => [a.id, a] as const));
  const liveSites = lookups.sites.filter((s) => !s.deleted_at);
  const siteByCp = new Map<string, string>();
  const siteByName = new Map<string, string>();
  for (const s of [...liveSites].sort(byId)) {
    if (s.centerpoint_property_id && !siteByCp.has(s.centerpoint_property_id))
      siteByCp.set(s.centerpoint_property_id, s.id);
    for (const alias of s.centerpoint_alias_ids ?? [])
      if (!siteByCp.has(alias)) siteByCp.set(alias, s.id);
    const k = `${s.account_id}|${nameKey(s.name)}`;
    if (!siteByName.has(k)) siteByName.set(k, s.id);
  }
  const liveContacts = lookups.contacts.filter((c) => !c.deleted_at);
  const contactByCp = new Map<string, string>();
  for (const c of [...liveContacts].sort(byId))
    if (c.centerpoint_contact_id && !contactByCp.has(c.centerpoint_contact_id))
      contactByCp.set(c.centerpoint_contact_id, c.id);
  const liveContactsByAccount = new Map<string, typeof liveContacts>();
  for (const c of liveContacts) {
    const g = liveContactsByAccount.get(c.account_id);
    if (g) g.push(c);
    else liveContactsByAccount.set(c.account_id, [c]);
  }

  const accountsToInsert: AccountInsert[] = [];
  const accountsToLink: AccountLink[] = [];
  const existingAccountIds: Record<string, string> = {};
  const linkedAccountIds = new Set<string>();
  /** The account id per kept company when it already exists in the portal. */
  const portalAccountOf = new Map<string, string>();

  for (const k of keptCompanies) {
    const c = k.row;
    const ids = [c.id, ...k.aliases];
    const already = ids.map((id) => accountByCp.get(id)).find(Boolean);
    if (already) {
      counts.companies.already++;
      existingAccountIds[c.id] = already;
      portalAccountOf.set(c.id, already);
      continue;
    }
    const ext = text(c.externalId, CRM_MAX.external_id);
    if (c.externalId.trim() && !isSixDigit(c.externalId))
      nonSixDigit.push({
        id: c.id,
        name: c.name,
        issue:
          c.externalId.trim() === "NOTonExport"
            ? `customer number "${c.externalId.trim()}" (CenterPoint's placeholder)`
            : `customer number "${c.externalId.trim()}"`,
      });
    const byName = accountByName.get(nameKey(c.name));
    if (byName && !linkedAccountIds.has(byName)) {
      linkedAccountIds.add(byName);
      counts.companies.linked++;
      existingAccountIds[c.id] = byName;
      portalAccountOf.set(c.id, byName);
      const live = accountById.get(byName);
      const set: AccountLink["set"] = { centerpoint_company_id: c.id };
      if (k.aliases.length) set.centerpoint_alias_ids = k.aliases;
      if (ext && !(live?.external_id ?? "").trim()) set.external_id = ext;
      accountsToLink.push({ id: byName, name: c.name, centerpoint_company_id: c.id, set });
      flag(
        "companies linked to a portal customer with the same name (nothing overwritten)",
        c.id,
        c.name,
        `portal customer ${byName}${set.external_id ? `; customer number ${set.external_id} filled in` : ""}`,
      );
      continue;
    }
    counts.companies.new++;
    const st = state(c.state, c.id, c.name, "companies");
    if (st && st !== "KY" && st !== "TN") counts.companies.outsideKyTn++;
    // The company's own manager, else the one named most on its properties.
    let managerName = c.manager.trim();
    if (!managerName) {
      const votes = new Map<string, number>();
      for (const p of propsByCompany.get(c.id) ?? [])
        if (p.manager.trim()) counter(votes, p.manager.trim());
      const top = [...votes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      if (top) {
        managerName = top[0];
        counts.companies.managerFromProperties++;
        flag(
          "companies whose account manager came from their properties (the company had none)",
          c.id,
          c.name,
          `${top[0]} (named on ${plural(top[1], "property", "properties")})`,
        );
      }
    }
    // The first contact (by Created At) with an email or a phone speaks for the company.
    const reachable = (list: readonly PreparedContact[]) =>
      [...list]
        .sort((a, b) => earlierFirst(a.createdAt, b.createdAt) || cmpId(a.row.id, b.row.id))
        .find((x) => x.email || x.office || x.mobile);
    const named = reachable(contactsByCompany.get(c.id) ?? []);
    const reach = named ?? reachable(placeholders.get(c.id) ?? []);
    if (!reach) {
      counts.companies.noContactInfo++;
      flag(
        "companies imported with no email or phone (badge on the Customers page)",
        c.id,
        c.name,
        "no contact has an email or a phone",
      );
    } else if (!named) {
      counts.companies.contactInfoFromPlaceholder++;
      flag(
        "companies whose phone / email came from an N/A contact (no contact name)",
        c.id,
        c.name,
        `from contact ${reach.row.id}`,
      );
    }
    accountsToInsert.push({
      centerpoint_company_id: c.id,
      centerpoint_alias_ids: k.aliases,
      name: text(c.name, CRM_MAX.name) ?? c.id,
      kind: "company",
      source: "import",
      external_id: ext,
      address1: text(c.address, CRM_MAX.address1),
      address2: null,
      city: text(c.city, CRM_MAX.city),
      state: st,
      zip: text(c.zip, CRM_MAX.zip),
      contact_name: named ? text(named.name, CRM_MAX.contact_name) : null,
      phone: reach ? clamp(reach.office, CRM_MAX.phone) : null,
      email: reach?.email ?? null,
      mobile: reach?.mobile ?? null,
      account_manager_id: managerId(managerName),
      mailing_same: true,
    });
  }

  // Sites.
  const sitesToInsert: SiteInsert[] = [];
  const sitesToLink: SiteLink[] = [];
  for (const { companyCpId, kept } of keptProperties) {
    const p = kept.row;
    const ids = [p.id, ...kept.aliases];
    if (ids.some((id) => siteByCp.has(id))) {
      counts.properties.already++;
      continue;
    }
    const accountId = portalAccountOf.get(companyCpId);
    if (accountId) {
      const liveId = siteByName.get(`${accountId}|${nameKey(p.name)}`);
      if (liveId && !sitesToLink.some((s) => s.id === liveId)) {
        counts.properties.linked++;
        const set: SiteLink["set"] = { centerpoint_property_id: p.id };
        if (kept.aliases.length) set.centerpoint_alias_ids = kept.aliases;
        sitesToLink.push({ id: liveId, name: p.name, set });
        flag(
          "properties linked to a portal property with the same name (nothing overwritten)",
          p.id,
          p.name,
          `portal property ${liveId}`,
        );
        continue;
      }
    }
    counts.properties.new++;
    const st = state(p.state, p.id, p.name, "properties");
    const cm = county(p.county, st, p.id, p.name, "properties");
    if (cm.status === "outside") counts.properties.outsideKyTn++;
    sitesToInsert.push({
      companyCpId,
      row: {
        centerpoint_property_id: p.id,
        centerpoint_alias_ids: kept.aliases,
        name: text(p.name, CRM_MAX.name) ?? p.id,
        address1: text(p.address, CRM_MAX.address1),
        address2: null,
        city: text(p.city, CRM_MAX.city),
        state: st,
        zip: text(p.zip, CRM_MAX.zip),
        county_code_id: cm.id,
      },
    });
  }

  // Contacts.
  const contactsToInsert: ContactInsert[] = [];
  const contactsToLink: ContactLink[] = [];
  for (const [companyCpId, list] of [...contactsByCompany.entries()].sort((a, b) =>
    cmpId(a[0], b[0]),
  )) {
    const accountId = portalAccountOf.get(companyCpId);
    for (const c of list) {
      if (contactByCp.has(c.row.id)) {
        counts.contacts.already++;
        continue;
      }
      if (accountId) {
        const phones = [c.office, c.mobile].filter(Boolean) as string[];
        const live = (liveContactsByAccount.get(accountId) ?? []).find(
          (x) =>
            nameKey(x.name) === nameKey(c.name) &&
            !contactsToLink.some((l) => l.id === x.id) &&
            ((c.email && (x.email ?? "").trim().toLowerCase() === c.email) ||
              [x.mobile, x.office_phone].some(
                (ph) => ph && phones.includes(normalizePhone(ph).phone ?? ph),
              )),
        );
        if (live) {
          counts.contacts.linked++;
          contactsToLink.push({
            id: live.id,
            name: c.name,
            set: { centerpoint_contact_id: c.row.id },
          });
          continue;
        }
      }
      counts.contacts.new++;
      const row: ContactInsert["row"] = {
        centerpoint_contact_id: c.row.id,
        name: text(c.name, CRM_MAX.name) ?? c.row.id,
        position: c.position,
        email: c.email,
        mobile: c.mobile,
        office_phone: c.office,
      };
      if (c.createdAt) row.created_at = c.createdAt;
      contactsToInsert.push({ companyCpId, row });
    }
  }

  counts.clamps = clamps;
  const sortFlags = (rows: FlagRow[]) => [...rows].sort(byId);
  const sortedFlags: Record<string, FlagRow[]> = {};
  for (const k of Object.keys(flags).sort()) sortedFlags[k] = sortFlags(flags[k] as FlagRow[]);
  const named = (m: Map<string, number>): NamedCount[] =>
    [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    accountsToInsert: accountsToInsert.sort((a, b) =>
      cmpId(a.centerpoint_company_id, b.centerpoint_company_id),
    ),
    accountsToLink: accountsToLink.sort((a, b) =>
      cmpId(a.centerpoint_company_id, b.centerpoint_company_id),
    ),
    sitesToInsert: sitesToInsert.sort((a, b) =>
      cmpId(a.row.centerpoint_property_id, b.row.centerpoint_property_id),
    ),
    sitesToLink: sitesToLink.sort((a, b) =>
      cmpId(a.set.centerpoint_property_id, b.set.centerpoint_property_id),
    ),
    contactsToInsert: contactsToInsert.sort((a, b) =>
      cmpId(a.row.centerpoint_contact_id, b.row.centerpoint_contact_id),
    ),
    contactsToLink: contactsToLink.sort((a, b) =>
      cmpId(a.set.centerpoint_contact_id, b.set.centerpoint_contact_id),
    ),
    existingAccountIds: Object.fromEntries(
      Object.entries(existingAccountIds).sort((a, b) => cmpId(a[0], b[0])),
    ),
    report: {
      counts,
      flags: sortedFlags,
      unmatchedManagers: named(unmatchedManagers),
      unmatchedCounties: named(unmatchedCounties),
      badEmails: sortFlags(badEmails),
      oddPhones: sortFlags(oddPhones),
      nonSixDigitExternalIds: sortFlags(nonSixDigit),
    },
  };
}

// ---- The report -----------------------------------------------------------------------------

/** The counts the confirm dialog restates: what the apply step will write. */
export function planSummary(plan: ImportPlan) {
  return {
    accounts: plan.accountsToInsert.length,
    accountLinks: plan.accountsToLink.length,
    sites: plan.sitesToInsert.length,
    siteLinks: plan.sitesToLink.length,
    contacts: plan.contactsToInsert.length,
    contactLinks: plan.contactsToLink.length,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The confirm dialog's sentence: what Import will write (Admin › Import from CenterPoint). */
export function confirmText(s: ReturnType<typeof planSummary>): string {
  const part = (count: number, one: string, many = `${one}s`) =>
    `${count.toLocaleString()} ${count === 1 ? one : many}`;
  return `This writes ${part(s.accounts, "customer")}, ${part(s.sites, "property", "properties")}, ${part(s.contacts, "contact")}. Nothing is deleted or overwritten.`;
}

/**
 * A cheap fingerprint of the three CSV texts: the page's Import button is tied to the files the
 * dry run read, so a changed file needs a new dry run.
 */
export function textsKey(t: ImportFiles): string {
  let h = 5381;
  for (const k of ["companies", "properties", "contacts"] as const) {
    const s = t[k];
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    h = ((h << 5) + h + s.length) | 0;
  }
  return `${h}:${t.companies.length}:${t.properties.length}:${t.contacts.length}`;
}

export function formatImportReport(plan: ImportPlan): string {
  const r = plan.report;
  const c = r.counts;
  const out: string[] = [];
  const h = (s: string) => out.push("", s, "-".repeat(s.length));
  const rows = (list: readonly FlagRow[]) => {
    for (const f of list) out.push(`  ${f.id}  ${f.name}  — ${f.issue}`);
    if (list.length === 0) out.push("  (none)");
  };
  out.push("CenterPoint import — dry run report");
  out.push("Nothing is deleted or overwritten; a re-run skips what is already imported.");
  h("Companies → customers");
  out.push(`  ${c.companies.rows} rows in the file`);
  out.push(`  ${c.companies.new} new customers to create`);
  out.push(`  ${c.companies.linked} linked to a portal customer with the same name`);
  out.push(`  ${c.companies.already} already imported (skipped)`);
  out.push(`  ${c.companies.folded} folded into a twin (same name and address)`);
  out.push(`  ${c.companies.sameNameDifferentAddress} with the same name but a different address`);
  out.push(`  ${c.companies.noContactInfo} with no email or phone anywhere (imported; badge)`);
  out.push(
    `  ${c.companies.contactInfoFromPlaceholder} whose phone / email came from an N/A contact`,
  );
  out.push(`  ${c.companies.outsideKyTn} outside KY / TN`);
  out.push(
    `  ${c.companies.managerFromProperties} account managers taken from the company's properties`,
  );
  h("Properties → properties");
  out.push(`  ${c.properties.rows} rows in the file`);
  out.push(`  ${c.properties.new} new properties to create`);
  out.push(`  ${c.properties.linked} linked to a portal property with the same name`);
  out.push(`  ${c.properties.already} already imported (skipped)`);
  out.push(`  ${c.properties.folded} folded into a twin (same company, name and address)`);
  out.push(`  ${c.properties.sameNameDifferentAddress} with the same name but a different address`);
  out.push(
    `  ${c.properties.ambiguousCompany} attached to the first of several same-name companies`,
  );
  out.push(`  ${c.properties.noCompany} whose company is not in the Companies file (not imported)`);
  out.push(`  ${c.properties.outsideKyTn} outside KY / TN (no county code)`);
  h("Contacts → contacts");
  out.push(`  ${c.contacts.rows} rows in the file`);
  out.push(`  ${c.contacts.new} new contacts to create`);
  out.push(
    `  ${c.contacts.linked} linked to a portal contact with the same name and email / phone`,
  );
  out.push(`  ${c.contacts.already} already imported (skipped)`);
  out.push(`  ${c.contacts.skippedNames} named N/A (skipped)`);
  out.push(`  ${c.contacts.folded} folded into a twin (same company, name and email or phone)`);
  out.push(`  ${c.contacts.noCompany} whose company is not in the Companies file (not imported)`);
  out.push("", `${plural(c.clamps, "text value")} shortened to the portal's limits.`);
  h("Account managers not found (set to none)");
  for (const m of r.unmatchedManagers)
    out.push(`  ${m.name}: ${plural(m.count, "company", "companies")}`);
  if (r.unmatchedManagers.length === 0) out.push("  (none)");
  h("Counties not in county_codes (left blank)");
  for (const m of r.unmatchedCounties)
    out.push(`  ${m.name}: ${plural(m.count, "property", "properties")}`);
  if (r.unmatchedCounties.length === 0) out.push("  (none)");
  h("Customer numbers that are not 6 digits (kept as typed)");
  rows(r.nonSixDigitExternalIds);
  h("Emails that look wrong (kept as typed)");
  rows(r.badEmails);
  h("Phones that could not be read (left blank)");
  rows(r.oddPhones);
  for (const [name, list] of Object.entries(r.flags)) {
    h(`${name[0]?.toUpperCase()}${name.slice(1)} (${list.length})`);
    rows(list);
  }
  return out.join("\n") + "\n";
}
