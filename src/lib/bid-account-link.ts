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

/** Labels of the client fields where the bid no longer matches the profile (empty = same). */
export function profileDifferences(customer: CustomerInfo, account: AccountLike): string[] {
  return CLIENT_FIELDS.filter((f) => read(customer, f.key) !== t(account[f.column])).map(
    (f) => f.label,
  );
}

/**
 * The saveAccount input that pushes the bid's client fields back to the profile. saveAccount
 * replaces every column it is given (a missing optional field becomes null), so the profile's
 * other fields are passed through unchanged.
 */
export function accountFromBid(
  customer: CustomerInfo,
  account: AccountLike &
    Pick<AccountRow, "id" | "kind" | "billing_instructions" | "external_id" | "notes">,
): AccountInput {
  return {
    id: account.id,
    name: t(customer.name),
    kind: account.kind === "individual" ? "individual" : "company",
    contact_name: t(customer.contact),
    phone: t(customer.phone),
    email: t(customer.email),
    address1: t(customer.clientAddress),
    address2: t(customer.clientAddress2),
    city: t(customer.clientCity),
    state: t(customer.clientState),
    zip: t(customer.clientZip),
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
