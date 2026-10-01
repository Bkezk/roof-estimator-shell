/**
 * JBK county codes (owner, Sep 30 item 4, answered Oct 1): a custom code per site, picked from
 * a list that filters as you type. The codes live in public.county_codes (admins and Estimate
 * Pricing edit them under Settings › General › County codes); a site points at one
 * (crm_sites.county_code_id).
 *
 * COUNTY_CODE_SEED is the owner's list exactly as given (code, county, state), spelling kept
 * ("PUTMAN", "PENLETON", "ELLIOT"); Putman, TN was listed as 0106 and corrected by the owner to
 * 0108 (Oct 1; the spelling Putman is his). The migration 20261001010000_county_codes.sql seeds countyCodeSeedRows() — the
 * same list with the county in Title Case — and a test checks the file holds every row. A code
 * is not unique across states (0108 is Kenton, KY and Putman, TN).
 */

export type CountyState = "KY" | "TN";
export const COUNTY_STATES: readonly CountyState[] = ["KY", "TN"];

export interface CountyCodeRow {
  id: string;
  code: string;
  county: string;
  state: string;
}

/** [code, county, state] as the owner gave them. */
export const COUNTY_CODE_SEED: readonly (readonly [string, string, CountyState])[] = [
  ["0022", "ANDERSON", "TN"],
  ["0043", "BLEDSOE", "TN"],
  ["0023", "BLOUNT", "TN"],
  ["0044", "BRADLEY", "TN"],
  ["0024", "CAMPBELL", "TN"],
  ["0034", "CARTER", "TN"],
  ["0025", "CLAIBORNE", "TN"],
  ["0035", "COCKE", "TN"],
  ["0106", "CUMBERLAND", "TN"],
  ["0121", "DAVIDSON", "TN"],
  ["0102", "FENTRESS", "TN"],
  ["0026", "GRAINGER", "TN"],
  ["0036", "GREENE", "TN"],
  ["0037", "HAMBLEN", "TN"],
  ["0045", "HAMILTON", "TN"],
  ["0038", "HANCOCK", "TN"],
  ["0039", "HAWKINS", "TN"],
  ["0027", "JEFFERSON", "TN"],
  ["0040", "JOHNSON", "TN"],
  ["0016", "KNOX", "TN"],
  ["0028", "LOUDON", "TN"],
  ["0047", "MARION", "TN"],
  ["0117", "MAURY", "TN"],
  ["0046", "McMINN", "TN"],
  ["0048", "MEIGS", "TN"],
  ["0029", "MONROE", "TN"],
  ["0109", "MONTGOMERY", "TN"],
  ["0030", "MORGAN", "TN"],
  ["0049", "POLK", "TN"],
  ["0108", "PUTMAN", "TN"],
  ["0050", "RHEA", "TN"],
  ["0011", "ROANE", "TN"],
  ["0124", "ROBERTSON", "TN"],
  ["0132", "Rutherford", "TN"],
  ["0031", "SCOTT", "TN"],
  ["0051", "SEQUATCHIE", "TN"],
  ["0032", "SEVIER", "TN"],
  ["0118", "SHELBY", "TN"],
  ["0012", "SULLIVAN", "TN"],
  ["0041", "UNICOI", "TN"],
  ["0033", "UNION", "TN"],
  ["0116", "WARREN", "TN"],
  ["0042", "WASHINGTON", "TN"],
  ["0060", "ADAIR", "KY"],
  ["0056", "ANDERSON", "KY"],
  ["0115", "BARREN", "KY"],
  ["0073", "BATH", "KY"],
  ["0015", "BELL", "KY"],
  ["0099", "BOONE", "KY"],
  ["0071", "BOURBON", "KY"],
  ["0111", "BOYD", "KY"],
  ["0063", "BOYLE", "KY"],
  ["0087", "BREATHITT", "KY"],
  ["0101", "BULLITT", "KY"],
  ["0098", "CAMPBELL", "KY"],
  ["0126", "CARROLL", "KY"],
  ["0091", "CARTER", "KY"],
  ["0062", "CASEY", "KY"],
  ["0070", "CLARK", "KY"],
  ["0020", "CLAY", "KY"],
  ["0061", "CLINTON", "KY"],
  ["0018", "CUMBERLAND", "KY"],
  ["0125", "DAVIESS", "KY"],
  ["0112", "EDMONSON", "KY"],
  ["0090", "ELLIOT", "KY"],
  ["0076", "ESTILL", "KY"],
  ["0004", "FAYETTE", "KY"],
  ["0082", "FLEMING", "KY"],
  ["0089", "FLOYD", "KY"],
  ["0053", "FRANKLIN", "KY"],
  ["0130", "GALLATIN", "KY"],
  ["0067", "GARRARD", "KY"],
  ["0131", "GRAYSON", "KY"],
  ["0097", "GREEN", "KY"],
  ["0092", "GREENUP", "KY"],
  ["0100", "HARDIN", "KY"],
  ["0005", "HARLAN", "KY"],
  ["0055", "HARRISON", "KY"],
  ["0107", "HART", "KY"],
  ["0103", "HICKMAN", "KY"],
  ["0021", "JACKSON", "KY"],
  ["0095", "JEFFERSON", "KY"],
  ["0066", "JESSAMINE", "KY"],
  ["0110", "JOHNSON", "KY"],
  ["0108", "KENTON", "KY"],
  ["0088", "KNOTT", "KY"],
  ["0002", "KNOX", "KY"],
  ["0133", "Larue", "KY"],
  ["0001", "LAUREL", "KY"],
  ["0104", "LAWRENCE", "KY"],
  ["0079", "LEE", "KY"],
  ["0077", "LESLIE", "KY"],
  ["0014", "LETCHER", "KY"],
  ["0084", "LEWIS", "KY"],
  ["0068", "LINCOLN", "KY"],
  ["0006", "MADISON", "KY"],
  ["0086", "MAGOFFIN", "KY"],
  ["0058", "MARION", "KY"],
  ["0105", "MARTIN", "KY"],
  ["0083", "MASON", "KY"],
  ["0069", "McCREARY", "KY"],
  ["0081", "MENIFEE", "KY"],
  ["0064", "MERCER", "KY"],
  ["0119", "METCALFE", "KY"],
  ["0113", "MONROE", "KY"],
  ["0074", "MONTGOMERY", "KY"],
  ["0013", "MORGAN", "KY"],
  ["0007", "NELSON", "KY"],
  ["0072", "NICHOLAS", "KY"],
  ["0120", "OHIO", "KY"],
  ["0123", "OLDHAM", "KY"],
  ["0078", "OWSLEY", "KY"],
  ["0127", "PENLETON", "KY"],
  ["0008", "PERRY", "KY"],
  ["0009", "PIKE", "KY"],
  ["0075", "POWELL", "KY"],
  ["0010", "PULASKI", "KY"],
  ["0096", "PUTNAM", "KY"],
  ["0094", "ROBERTSON", "KY"],
  ["0017", "ROCKCASTLE", "KY"],
  ["0085", "ROWAN", "KY"],
  ["0019", "RUSSELL", "KY"],
  ["0054", "SCOTT", "KY"],
  ["0052", "SHELBY", "KY"],
  ["0134", "Simpson", "KY"],
  ["0059", "TAYLOR", "KY"],
  ["0114", "TODD", "KY"],
  ["0122", "WARREN", "KY"],
  ["0057", "WASHINGTON", "KY"],
  ["0093", "WAYNE", "KY"],
  ["0003", "WHITLEY", "KY"],
  ["0080", "WOLFE", "KY"],
  ["0065", "WOODFORD", "KY"],
];

/** "McMINN" → "McMinn", "ROCKCASTLE" → "Rockcastle", "Larue" → "Larue" (spelling kept). */
export function titleCaseCounty(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/(^|[\s-])Mc([a-z])/g, (_m, sep: string, c: string) => `${sep}Mc${c.toUpperCase()}`);
}

/** The seed as stored: code trimmed, the county trimmed and in Title Case. */
export function countyCodeSeedRows(): { code: string; county: string; state: CountyState }[] {
  return COUNTY_CODE_SEED.map(([code, county, state]) => ({
    code: code.trim(),
    county: titleCaseCounty(county),
    state,
  }));
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** One VALUES tuple of the migration's seed, e.g. ('0022', 'Anderson', 'TN'). */
export const countyCodeSeedTuple = (r: { code: string; county: string; state: string }) =>
  `(${sqlText(r.code)}, ${sqlText(r.county)}, ${sqlText(r.state)})`;

/** "0022 · Anderson, TN" */
export function countyCodeLabel(row: Pick<CountyCodeRow, "code" | "county" | "state">): string {
  return `${row.code} · ${row.county}, ${row.state}`;
}

/** State, then county, then code (KY before TN). */
export function compareCountyCodes(
  a: Pick<CountyCodeRow, "code" | "county" | "state">,
  b: Pick<CountyCodeRow, "code" | "county" | "state">,
): number {
  return (
    a.state.localeCompare(b.state) ||
    a.county.localeCompare(b.county, "en", { sensitivity: "base" }) ||
    a.code.localeCompare(b.code)
  );
}

/**
 * The picker's list for what is typed. Each word typed must match the row one of three ways: a
 * prefix of the code ("00", "0022"), a prefix of a word of the county ("and" → Anderson), or the
 * state ("tn"). Empty = every row. Always sorted state, then county, then code.
 */
export function filterCountyCodes<T extends Pick<CountyCodeRow, "code" | "county" | "state">>(
  list: readonly T[],
  query: string,
): T[] {
  const tokens = query
    .toLowerCase()
    .split(/[\s,·]+/)
    .filter(Boolean);
  const hit = (r: T) => {
    const code = r.code.toLowerCase();
    const state = r.state.toLowerCase();
    const words = r.county.toLowerCase().split(/[\s-]+/);
    return tokens.every(
      (t) => code.startsWith(t) || state === t || words.some((w) => w.startsWith(t)),
    );
  };
  return (tokens.length ? list.filter(hit) : [...list]).sort(compareCountyCodes);
}
