/**
 * Linking a bid to a customer profile (docs/service-module-design.md §11, "Linking a bid"):
 * what picking a profile fills on the bid, which of those fields would overwrite the
 * estimator's own text, and whether the bid's client fields still match the profile.
 *
 * Pure and cheap, so Setup can recompute it on every render. The bid's own fields stay the
 * source of truth for the proposal; nothing here reads or changes pricing.
 */
import type { AccountInput, AccountRow, SiteRow } from "@/lib/crm.functions";
import { cityStZip, type CustomerInfo } from "@/lib/proposal-bid";

const t = (v: string | null | undefined) => (v ?? "").trim();

/** The bid's client fields and the profile column each one mirrors. */
export const CLIENT_FIELDS = [
  { key: "name", column: "name", label: "name" },
  { key: "contact", column: "contact_name", label: "contact" },
  { key: "phone", column: "phone", label: "phone" },
  { key: "email", column: "email", label: "email" },
  { key: "clientAddress", column: "address1", label: "address 1" },
  { key: "clientAddress2", column: "address2", label: "address 2" },
  { key: "clientCity", column: "city", label: "city" },
  { key: "clientState", column: "state", label: "state" },
  { key: "clientZip", column: "zip", label: "zip" },
] as const;

/** The bid's job-site fields and the site column each one mirrors. */
const SITE_FIELDS = [
  { key: "projectAddress", column: "address1" },
  { key: "projectAddress2", column: "address2" },
  { key: "jobCity", column: "city" },
  { key: "jobState", column: "state" },
  { key: "jobZip", column: "zip" },
] as const;

export type FillKey =
  (typeof CLIENT_FIELDS)[number]["key"] | (typeof SITE_FIELDS)[number]["key"] | "jobCityStZip";

/** What a picked profile writes onto the bid. */
export type ProfileFill = Partial<Record<FillKey, string>>;

type AccountLike = Pick<
  AccountRow,
  "name" | "contact_name" | "phone" | "email" | "address1" | "address2" | "city" | "state" | "zip"
>;
type SiteLike = Pick<SiteRow, "address1" | "address2" | "city" | "state" | "zip">;

/**
 * The bid fields the profile provides: the client fields from the account and, when a site was
 * picked, the job-site fields from the site (plus the combined "City, ST Zip" line the proposal
 * prints). Blank profile values are left out, so a pick never wipes text the bid already has.
 */
export function profileFill(account: AccountLike, site?: SiteLike | null): ProfileFill {
  const fill: ProfileFill = {};
  for (const f of CLIENT_FIELDS) {
    const v = t(account[f.column]);
    if (v) fill[f.key] = v;
  }
  if (site) {
    for (const f of SITE_FIELDS) {
      const v = t(site[f.column]);
      if (v) fill[f.key] = v;
    }
    const line = cityStZip(t(site.city), t(site.state), t(site.zip));
    if (line) fill.jobCityStZip = line;
  }
  return fill;
}

/**
 * The name typed into the Customer Name typeahead is the search text, not a hand-entered name:
 * blank or part of the picked profile's name counts as nothing to keep.
 */
const nameIsSearchText = (current: string, profileName: string) =>
  !current || profileName.toLowerCase().includes(current.toLowerCase());

const read = (c: CustomerInfo, k: FillKey) => t(c[k] as string | undefined);

/** The fields where the bid already holds different text than the profile would write. */
export function fillConflicts(customer: CustomerInfo, fill: ProfileFill): FillKey[] {
  const out: FillKey[] = [];
  for (const [k, v] of Object.entries(fill) as [FillKey, string][]) {
    const cur = read(customer, k);
    if (!cur || cur === v) continue;
    if (k === "name" && nameIsSearchText(cur, v)) continue;
    out.push(k);
  }
  return out;
}

/**
 * The bid's customer with the profile applied. `replace` overwrites every filled field ("Yes");
 * otherwise only blank fields are filled ("Keep mine") — the typed search text in the name
 * always gives way to the picked name. The combined job-site line follows its parts unless it
 * was hand-edited and the estimator keeps their own text.
 */
export function applyProfileFill(
  customer: CustomerInfo,
  fill: ProfileFill,
  replace: boolean,
): CustomerInfo {
  const next: CustomerInfo = { ...customer };
  const conflicts = new Set(fillConflicts(customer, fill));
  for (const [k, v] of Object.entries(fill) as [FillKey, string][]) {
    if (k === "jobCityStZip") continue;
    if (replace || !conflicts.has(k)) (next as unknown as Record<string, string>)[k] = v;
  }
  if (fill.jobCityStZip !== undefined) {
    const inSync =
      !read(customer, "jobCityStZip") ||
      read(customer, "jobCityStZip") ===
        cityStZip(customer.jobCity, customer.jobState, customer.jobZip);
    if (replace || inSync) next.jobCityStZip = cityStZip(next.jobCity, next.jobState, next.jobZip);
  }
  return next;
}

/**
 * The part of `fill` that lands only on the bid's blank fields — for a bid that arrives already
 * linked (from the Customers page): it fills what is missing, never replaces typed text, and so
 * asks nothing. The combined job-site line is kept out when the bid already has one.
 */
export function blankFieldsOnly(customer: CustomerInfo, fill: ProfileFill): ProfileFill {
  const out: ProfileFill = {};
  for (const [k, v] of Object.entries(fill) as [FillKey, string][]) {
    if (!read(customer, k)) out[k] = v;
  }
  return out;
}

/** Labels of the client fields where the bid no longer matches the profile (empty = same). */
export function profileDifferences(customer: CustomerInfo, account: AccountLike): string[] {
  // A blank bid field is "not entered", not a different value (owner, Sep 27): the bid may
  // simply not carry that detail, and Update profile never wipes the profile with a blank.
  return CLIENT_FIELDS.filter((f) => {
    const cur = read(customer, f.key);
    return cur !== "" && cur !== t(account[f.column]);
  }).map((f) => f.label);
}

/**
 * The saveAccount input that pushes the bid's client fields back to the profile. saveAccount
 * replaces every column it is given (a missing optional field becomes null), so the profile's
 * other fields are passed through unchanged.
 */
export function accountFromBid(
  customer: CustomerInfo,
  account: AccountLike &
    Pick<AccountRow, "id" | "kind" | "billing_instructions" | "external_id" | "notes"> &
    Partial<Pick<AccountRow, "mobile">>,
): AccountInput {
  // A blank bid field keeps the profile's value (see profileDifferences).
  const keep = (bid: string | undefined, profile: string | null) => t(bid) || t(profile);
  return {
    id: account.id,
    name: keep(customer.name, account.name),
    kind: account.kind === "individual" ? "individual" : "company",
    contact_name: keep(customer.contact, account.contact_name),
    phone: keep(customer.phone, account.phone),
    email: keep(customer.email, account.email),
    // The bid has no cell phone field: the profile's is passed through (it may be the only way
    // to reach the customer, which saveAccount requires).
    mobile: account.mobile,
    address1: keep(customer.clientAddress, account.address1),
    address2: keep(customer.clientAddress2, account.address2),
    city: keep(customer.clientCity, account.city),
    state: keep(customer.clientState, account.state),
    zip: keep(customer.clientZip, account.zip),
    billing_instructions: account.billing_instructions,
    external_id: account.external_id,
    notes: account.notes,
  };
}

/** How each filled field is named in the "replace?" question. */
export const FILL_LABELS: Record<FillKey, string> = {
  name: "Customer name",
  contact: "Contact",
  phone: "Phone",
  email: "Email",
  clientAddress: "Client address 1",
  clientAddress2: "Client address 2",
  clientCity: "Client city",
  clientState: "Client state",
  clientZip: "Client zip",
  projectAddress: "Job-site address 1",
  projectAddress2: "Job-site address 2",
  jobCity: "Job-site city",
  jobState: "Job-site state",
  jobZip: "Job-site zip",
  jobCityStZip: "Job-site city, state zip",
};

/** A trailing "City, ST 12345" split off an address. `rest` is what precedes it (may be ""). */
export interface AddressTail {
  rest: string;
  city: string;
  state: string;
  zip: string;
}

// [rest (comma | newline)] city (comma | spaces) ST[.] (comma | spaces) 12345[-6789]
const TAIL_RE =
  /^(?:([\s\S]*?)\s*[,\n]\s*)?([^,\n]*[^,\s])\s*(?:,\s*|\s+)([A-Za-z]{2})\.?(?:\s*,\s*|\s+)(\d{5}(?:-\d{4})?)$/;

/**
 * Split a trailing "City, ST 12345" (state = two letters, zip 5 or 5+4) off a one-box address
 * such as "123 Main St, Corbin, KY 40701" or "123 Main St\nCorbin KY 40701". Null when the text
 * does not end that way. Several lines before the city are joined with ", ".
 */
export function parseAddressTail(text: string | null | undefined): AddressTail | null {
  const m = TAIL_RE.exec(t(text));
  if (!m) return null;
  const rest = (m[1] ?? "")
    .split(/\s*\n\s*/)
    .map((x) => x.trim().replace(/,+$/, "").trim())
    .filter(Boolean)
    .join(", ");
  return { rest, city: m[2]!.trim(), state: m[3]!.toUpperCase(), zip: m[4]! };
}

type AddressKey =
  "projectAddress" | "projectAddress2" | "jobCity" | "jobState" | "jobZip" | "jobCityStZip";

/**
 * Job Site › "Copy Client Address" (legacy llbCopyClient): the client's Address 1/2, City, State
 * and Zip onto the job site. Older and imported bids often hold the whole billing address in
 * Address 1 (or the city line in Address 2) with City / State / Zip blank; then the trailing
 * "City, ST 12345" is split out so the job site gets its parts and Address 1 only the street.
 */
export function clientAddressForJobSite(c: CustomerInfo): Pick<CustomerInfo, AddressKey> {
  const a1 = t(c.clientAddress);
  const a2 = t(c.clientAddress2);
  const partsBlank = !t(c.clientCity) && !t(c.clientState) && !t(c.clientZip);
  const put = (street: string, street2: string, city: string, state: string, zip: string) => ({
    projectAddress: street,
    projectAddress2: street2,
    jobCity: city,
    jobState: state,
    jobZip: zip,
    jobCityStZip: cityStZip(city, state, zip),
  });
  if (partsBlank) {
    // Address 1 must keep a street in front of the city line; Address 2 may be the city line.
    const p1 = parseAddressTail(a1);
    if (p1 && p1.rest) return put(p1.rest, c.clientAddress2 ?? "", p1.city, p1.state, p1.zip);
    const p2 = parseAddressTail(a2);
    if (p2) return put(c.clientAddress ?? "", p2.rest, p2.city, p2.state, p2.zip);
  }
  return put(
    c.clientAddress ?? "",
    c.clientAddress2 ?? "",
    c.clientCity ?? "",
    c.clientState ?? "",
    c.clientZip ?? "",
  );
}
