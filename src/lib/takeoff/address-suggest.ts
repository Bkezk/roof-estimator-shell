/**
 * Suggestions under the New takeoff address box (owner, Nov 3: "theres no easy way to search an
 * address from the new takeoff prompt"): while the address is typed, the customer properties on
 * file whose name, street or town contain what was typed are listed, so a building we already
 * know is one tap — the tap fills the line, files the takeoff under that customer and runs the
 * search at once. Pure here: when what is typed is worth asking about, and the rows the server
 * hands back shaped into suggestions. The server half is suggestTakeoffAddresses
 * (src/lib/takeoff-aerial.functions.ts).
 */
import { parseAddressQuery } from "@/lib/address-query";

/** Fewer typed characters than this ask nothing (every street has a "1"). */
export const SUGGEST_MIN_CHARS = 3;
/** The most suggestions shown. */
export const SUGGEST_LIMIT = 8;

export interface AddressSuggestion {
  site_id: string;
  account_id: string;
  account_name: string;
  site_name: string;
  /** The property's address on one line, as the Address box will carry it. */
  address: string;
  /** The property's point when we have one (its aerial cover found it): searched directly. */
  lat: number | null;
  lng: number | null;
}

/**
 * The text to ask suggestions for, or null when nothing should be asked: too short, blank, or a
 * line that is not an address at all (coordinates, a map link).
 */
export function suggestQuery(typed: string): string | null {
  const t = typed.replace(/\s+/g, " ").trim();
  if (t.length < SUGGEST_MIN_CHARS) return null;
  const q = parseAddressQuery(t);
  if (q.kind === "point" || q.kind === "link-without-point" || q.kind === "empty") return null;
  return t;
}

export interface SuggestSiteRow {
  id: string;
  account_id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
}

/** One line of a property's address: "412 Main St, Suite 2, Murray, KY 42071" (crm.functions' siteAddressLine). */
export function suggestionAddressLine(
  s: Pick<SuggestSiteRow, "address1" | "address2" | "city" | "state" | "zip">,
): string {
  const clean = (x: string | null) => (x ?? "").trim();
  const street = [clean(s.address1), clean(s.address2)].filter(Boolean).join(", ");
  const cityLine = [clean(s.city), [clean(s.state), clean(s.zip)].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [street, cityLine].filter(Boolean).join(", ");
}

/**
 * The suggestions: properties with a street line whose customer is live, named by customer then
 * property, at most SUGGEST_LIMIT. A property with no street cannot be searched for, so it is
 * left out however well its name matches.
 */
export function shapeSuggestions(
  sites: readonly SuggestSiteRow[],
  accounts: ReadonlyMap<string, string>,
  limit = SUGGEST_LIMIT,
): AddressSuggestion[] {
  const out: AddressSuggestion[] = [];
  for (const s of sites) {
    const accountName = accounts.get(s.account_id);
    if (!accountName) continue;
    if (!(s.address1 ?? "").trim()) continue;
    out.push({
      site_id: s.id,
      account_id: s.account_id,
      account_name: accountName,
      site_name: s.name,
      address: suggestionAddressLine(s),
      lat: typeof s.lat === "number" && Number.isFinite(s.lat) ? s.lat : null,
      lng: typeof s.lng === "number" && Number.isFinite(s.lng) ? s.lng : null,
    });
  }
  out.sort(
    (a, b) =>
      a.account_name.localeCompare(b.account_name) || a.site_name.localeCompare(b.site_name),
  );
  return out.slice(0, limit);
}

/**
 * The customer label a takeoff is named after: "Acme Foods — Plant 2", or just the customer when
 * the property has no name of its own or is named after the customer (the New customer dialog
 * names the first property so; Customers audit Nov 6, finding 9: "ZZ Co — ZZ Co · Nov 6").
 */
export const customerLabel = (
  accountName: string,
  siteName: string | null | undefined,
  /** Between the two: the takeoff's " — ", the estimator's " · ". */
  sep = " — ",
): string => {
  const a = accountName.trim();
  const s = (siteName ?? "").trim();
  return s && s.toLowerCase() !== a.toLowerCase() ? `${a}${sep}${s}` : a;
};

/** The takeoff's customer label from a suggestion: "Acme Foods — Plant 2". */
export const suggestionLabel = (s: AddressSuggestion): string =>
  customerLabel(s.account_name, s.site_name);
