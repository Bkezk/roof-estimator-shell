/**
 * The office's side of the two public pages (Roof Care step 4): the list "Requests from the
 * public pages", the words of its notice, the three settings, and the addresses the QR codes
 * hold. Pure: no database, no server. The pages a visitor sees are in public-forms.ts.
 */
import { SETUP_QR_PATH } from "@/lib/menu-places";
import { PUBLIC_CARE_PATH, PUBLIC_REQUEST_PATH, type PublicPlanKey } from "@/lib/public-forms";

export const PUBLIC_REQUESTS_TITLE = "Requests from the public pages";
/**
 * Where the list lives (Nov 23; owner: "we need to find somewhere else for the public
 * requests"): with Opportunities, since a request is a lead. It was a menu row of its own under
 * Customers; the old address is kept and sends people on.
 */
export const PUBLIC_REQUESTS_PATH = "/opportunities/requests";
/** The list's first address (Nov 21 to Nov 23): notices already sent carry it. */
export const PUBLIC_REQUESTS_OLD_PATH = "/customers/requests";
/** The button on the Opportunities page: "Public requests", with the number waiting. */
export function publicRequestsButtonWords(waiting: number | null | undefined): string {
  const n = Math.max(0, Math.floor(waiting ?? 0));
  return n > 0 ? `Public requests (${n})` : "Public requests";
}
/** The QR codes and the settings behind the public pages: Setup's "QR pages" tab. */
export const PUBLIC_SETUP_PATH = SETUP_QR_PATH;

export type PublicRequestStatus = "new" | "matched" | "dismissed";
export type PublicRequestKind = "care" | "service";

/** A request as the office reads it (public_requests). */
export interface PublicRequestRow {
  id: string;
  reference: string;
  kind: PublicRequestKind;
  created_at: string;
  status: PublicRequestStatus;
  contact_name: string;
  company: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  building_name: string;
  referred_by: string;
  plan: PublicPlanKey | null;
  sqft: number | null;
  size_range: string | null;
  sqft_source: string | null;
  shown_price: number | null;
  quote: {
    found?: boolean;
    rough?: boolean;
    place?: string | null;
    custom_quote?: boolean;
  } | null;
  pay_method: "check" | "card" | null;
  terms_version: string | null;
  agreed_by: string | null;
  several_buildings: boolean;
  notes: string;
  services: string[];
  details: string;
  handled_at: string | null;
  handled_by_name: string | null;
  dismiss_reason: string | null;
  account_id: string | null;
  site_id: string | null;
  opportunity_id: string | null;
  roof_care_plan_id: string | null;
}

/** A customer who may be the one who sent a request (public_request_matches). */
export interface PublicMatch {
  account_id: string;
  account_name: string;
  /** What is shared: "phone", "email", "name", "address". */
  why: string[];
  site_id: string | null;
  site_name: string | null;
  site_address: string | null;
  phone: string | null;
  email: string | null;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** public_request_matches()'s answer, read strictly: anything odd is left out. */
export function readMatches(x: unknown): PublicMatch[] {
  if (!Array.isArray(x)) return [];
  const out: PublicMatch[] = [];
  for (const raw of x) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = text(r["account_id"]);
    if (!id) continue;
    out.push({
      account_id: id,
      account_name: text(r["account_name"]) || "Customer",
      why: Array.isArray(r["why"])
        ? r["why"].filter((w): w is string => typeof w === "string")
        : [],
      site_id: text(r["site_id"]) || null,
      site_name: text(r["site_name"]) || null,
      site_address: text(r["site_address"]) || null,
      phone: text(r["phone"]) || null,
      email: text(r["email"]) || null,
    });
  }
  return out;
}

const WHY_WORDS: Readonly<Record<string, string>> = {
  phone: "same phone number",
  email: "same email",
  name: "a name alike",
  address: "same street address",
};

/** "same phone number, same street address" */
export const matchWhyWords = (why: readonly string[]): string =>
  why.map((w) => WHY_WORDS[w] ?? w).join(", ");

const PLAN_NAMES: Readonly<Record<PublicPlanKey, string>> = {
  watch: "Roof Watch",
  care: "Roof Care",
  guard: "Roof Guard",
};
export const publicPlanName = (p: PublicPlanKey | null | undefined): string =>
  p ? PLAN_NAMES[p] : "a Roof Care plan";

/** Who a request is from, as a title: the company when one was typed, else the person. */
export const requestFrom = (r: Pick<PublicRequestRow, "company" | "contact_name">): string =>
  r.company.trim() || r.contact_name.trim() || "Someone";

/** "120 Main St, London, KY 40741" */
export function requestAddress(
  r: Pick<PublicRequestRow, "address" | "city" | "state" | "zip">,
): string {
  const tail = [r.city.trim(), [r.state.trim(), r.zip.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [r.address.trim(), tail].filter(Boolean).join(", ");
}

/**
 * A Roof Care request with no price on it: the page showed none (a roof over the size the plans
 * are priced for, several buildings, or an address the map could not place), so the visitor
 * asked to be called with a custom quote. It is not a sign-up: no plan was bought, nothing was
 * agreed to, and the office never opens the sign-up from it at a price of nothing.
 */
export const isCustomQuoteAsk = (r: Pick<PublicRequestRow, "kind" | "shown_price">): boolean =>
  r.kind === "care" && r.shown_price == null;

/** Why no price was shown, in a few words; "" when the request does not say. */
export function customQuoteWhy(r: Pick<PublicRequestRow, "several_buildings" | "quote">): string {
  if (r.several_buildings) return "they have several buildings";
  if (r.quote?.custom_quote) return "the roof is over the size the plans are priced for";
  if (r.quote?.found === false) return "the address was not found on the map";
  return "";
}

/** What the request asks for, in a line: reads after "asked for". */
export function requestAsk(
  r: Pick<PublicRequestRow, "kind" | "plan" | "services" | "several_buildings" | "shown_price">,
): string {
  if (r.kind === "care") {
    const several = r.several_buildings ? ", several buildings" : "";
    if (isCustomQuoteAsk(r))
      return `a custom quote for ${r.plan ? PLAN_NAMES[r.plan] : "a Roof Care plan"}${several}`;
    return `${publicPlanName(r.plan)}${several}`;
  }
  return r.services.length ? r.services.join(", ") : "Service";
}

/** The same line starting a sentence or standing alone: "A custom quote for a Roof Care plan". */
export const requestAskLine = (r: Parameters<typeof requestAsk>[0]): string => {
  const s = requestAsk(r);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The notice the admins and managers get, once, when a request comes in. */
export function publicRequestNotice(
  r: Pick<
    PublicRequestRow,
    "reference" | "kind" | "contact_name" | "company" | "city" | "state" | "plan" | "services"
  > & { several_buildings?: boolean; shown_price?: number | null },
): { kind: string; title: string; body: string; url: string } {
  const where = [r.city.trim(), r.state.trim()].filter(Boolean).join(", ");
  // A notice read without the price (an older caller) is worded as the plan, as before.
  const ask = requestAsk({
    ...r,
    several_buildings: r.several_buildings ?? false,
    shown_price: r.shown_price === undefined ? 0 : r.shown_price,
  });
  return {
    kind: "public_request",
    title:
      r.kind === "care"
        ? `Roof Care request from the public page: ${requestFrom(r)}`
        : `Service request from the public page: ${requestFrom(r)}`,
    body: `${r.contact_name.trim()}${where ? ` in ${where}` : ""} asked for ${ask}. Reference ${r.reference}. Open Requests from the public pages to match it to a customer.`,
    url: PUBLIC_REQUESTS_PATH,
  };
}

/** What a Roof Care request hands to the normal sign-up, so nothing is typed twice. */
export interface CareSignUpPrefill {
  request_id: string;
  reference: string;
  plan: PublicPlanKey;
  sqft: number | null;
  pay_method: "check" | "card";
  /** The customer's own typed name: the one who agreed to the terms on the public page. */
  agreed_by: string;
  referred_by: string;
  customer_email: string;
  /** The yearly price the public page showed, for the office to compare. */
  shown_price: number | null;
  terms_version: string | null;
}

export function carePrefill(r: PublicRequestRow): CareSignUpPrefill | null {
  // A custom quote is a call to make, not a sign-up to open: nothing was priced or agreed to.
  if (r.kind !== "care" || !r.plan || isCustomQuoteAsk(r)) return null;
  return {
    request_id: r.id,
    reference: r.reference,
    plan: r.plan,
    sqft: r.sqft,
    pay_method: r.pay_method ?? "check",
    agreed_by: (r.agreed_by ?? "").trim() || r.contact_name.trim(),
    referred_by: r.referred_by.trim(),
    customer_email: r.email.trim(),
    shown_price: r.shown_price,
    terms_version: r.terms_version,
  };
}

/** The search word the property page reads to open the sign-up prefilled from a request. */
export const CARE_REQUEST_SEARCH = "care_request";

/** The property page's search: a request's id under `care_request`, or nothing at all. */
export function careRequestFromSearch(search: Record<string, unknown>): { care_request?: string } {
  const v = search[CARE_REQUEST_SEARCH];
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? { care_request: v.toLowerCase() }
    : {};
}

const wholeDollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/**
 * What the sign-up says at its top when it was opened from a public request, for the office:
 * where it came from, the price the customer was shown, and whether their tick still stands.
 */
export function carePrefillWords(p: CareSignUpPrefill, termsInUse: string): string {
  const shown =
    p.shown_price != null && p.shown_price > 0
      ? ` The page showed them ${wholeDollars(p.shown_price)} a year.`
      : "";
  const terms =
    p.terms_version === termsInUse
      ? " They ticked these terms there, so the tick is already on."
      : " The terms have changed since they ticked them: read them the new ones and tick again.";
  const who = p.referred_by.trim() ? ` Referred by: ${p.referred_by.trim()}.` : "";
  return `From the public Roof Care page, request ${p.reference}.${shown}${terms}${who} Check the roof size, press Show my price and choose when the first inspection is.`;
}

/** The note kept on the plan, so the request and who referred them are not lost. */
export function carePrefillNote(p: CareSignUpPrefill): string {
  const who = p.referred_by.trim();
  return `From the public Roof Care page, request ${p.reference}.${who ? ` Referred by: ${who}.` : ""}`;
}

/** What a service request becomes: the opportunity's title and description. */
export function opportunityFromRequest(r: PublicRequestRow): {
  title: string;
  description: string;
  referred_by: string;
} {
  const lines = [
    `From the public Request service page (${r.reference}).`,
    `Services asked for: ${r.services.join(", ") || "none ticked"}.`,
    r.details.trim() ? `What they wrote: ${r.details.trim()}` : "",
    `Contact: ${[r.contact_name.trim(), r.phone.trim(), r.email.trim()].filter(Boolean).join(", ")}.`,
    `Building: ${[r.building_name.trim(), requestAddress(r)].filter(Boolean).join(", ")}.`,
  ].filter(Boolean);
  return {
    title: `${requestFrom(r)}: ${r.services[0] ?? "service request"}`.slice(0, 160),
    description: lines.join("\n"),
    referred_by: r.referred_by.trim(),
  };
}

// ── The three settings (Setup › QR pages) ────────────────────────────────────────────────────

export interface PublicFormSettings {
  services: string[];
  /** Null: the site's own address. */
  qr_base_url: string | null;
  google_daily_cap: number;
  updated_at: string | null;
  updated_by_name: string | null;
}

export const SERVICES_STARTER_NOTE =
  "This is a starter list. The printed leave-behind's list is not right, so replace it with the services you want customers to pick from.";
export const QR_ADDRESS_WARNING =
  "Printed codes are permanent. Use an address on a domain the company owns, so the codes keep working if the site ever moves. Change this before anything is printed, not after.";
export const QR_ADDRESS_OWN_SITE =
  "The codes below hold this site's own address. That works today, but a printed sheet stops working if the site's address ever changes.";
export const GOOGLE_CAP_NOTE =
  "The most drive lookups the whole site asks Google for in a day. After that the free router answers, as it does when Google is down. The first 10,000 lookups a month are free at Google.";

export const SERVICE_NAME_MAX = 80;
export const SERVICES_MAX = 40;

/** The services list as it will be saved, or the words for what is wrong with it. */
export function cleanServices(
  list: readonly string[],
): { ok: true; services: string[] } | { ok: false; problem: string } {
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.replace(/\s+/g, " ").trim();
    if (!s) continue;
    if (s.length > SERVICE_NAME_MAX)
      return {
        ok: false,
        problem: `"${s.slice(0, 30)}…" is too long. Keep a service under ${SERVICE_NAME_MAX} letters.`,
      };
    if (out.some((x) => x.toLowerCase() === s.toLowerCase()))
      return { ok: false, problem: `"${s}" is on the list twice. Keep one.` };
    out.push(s);
  }
  if (!out.length) return { ok: false, problem: "Keep at least one service on the list." };
  if (out.length > SERVICES_MAX)
    return { ok: false, problem: `Keep the list to ${SERVICES_MAX} services or fewer.` };
  return { ok: true, services: out };
}

/**
 * The address typed for the QR codes as it will be saved: "https://" and the host, nothing
 * after it. Blank means the site's own address. Null `url` with a problem when it is not one.
 */
export function cleanQrAddress(
  typed: string,
): { ok: true; url: string | null } | { ok: false; problem: string } {
  const t = typed.trim().toLowerCase();
  if (!t) return { ok: true, url: null };
  const withScheme = /^[a-z]+:\/\//.test(t) ? t : `https://${t}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, problem: "That is not a web address. Type it like portal.example.com." };
  }
  if (u.protocol !== "https:")
    return {
      ok: false,
      problem: "The address has to start with https://. Phones warn about any other kind.",
    };
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash || u.username || u.password)
    return {
      ok: false,
      problem:
        "Type only the site's address, like portal.example.com. The page is added to it for each code.",
    };
  if (!/^[a-z0-9.-]+$/.test(u.hostname) || !u.hostname.includes("."))
    return { ok: false, problem: "That is not a web address. Type it like portal.example.com." };
  return { ok: true, url: `https://${u.host}` };
}

export interface QrSheet {
  key: "care" | "request";
  title: string;
  line: string;
  /** The exact address inside the code. */
  url: string;
  /** The file name of the downloaded picture. */
  file: string;
}

/**
 * The two sheets: what each code holds and the words printed with it. No price is ever printed
 * (owner, Nov 18). `base` is the saved address, or the site's own when none is saved.
 */
export function qrSheets(base: string): QrSheet[] {
  const root = base.replace(/\/+$/, "");
  return [
    {
      key: "care",
      title: "Roof Care plans",
      line: "Scan to see the plans and the price for your building.",
      url: `${root}${PUBLIC_CARE_PATH}`,
      file: "jbk-roof-care-plans-qr.png",
    },
    {
      key: "request",
      title: "Request service",
      line: "Scan to tell us what your roof needs. We will call you.",
      url: `${root}${PUBLIC_REQUEST_PATH}`,
      file: "jbk-request-service-qr.png",
    },
  ];
}

/** True when the codes hold a lovable.app address, which the company does not own. */
export const qrAddressIsBorrowed = (base: string): boolean =>
  /(^|\.)lovable\.app$/i.test(base.replace(/^https?:\/\//, "").replace(/[:/].*$/, ""));

/** The day an opportunity made from a request is due: tomorrow, so someone calls back soon. */
export function callBackDay(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
