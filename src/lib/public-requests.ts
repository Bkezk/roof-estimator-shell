/**
 * The office's side of the two public pages (Roof Care step 4): what a request is, the words of
 * its notice, the three settings, and the addresses the QR codes hold. Pure: no database, no
 * server. The pages a visitor sees are in public-forms.ts.
 *
 * Nov 23 (owner: "i like option A"): a request becomes an opportunity the moment it is sent
 * (the database's public_request_submit). There is no list of requests any more: the office
 * says whose a request is on its opportunity, where a strip shows what the customer sent.
 */
import { SETUP_QR_PATH } from "@/lib/menu-places";
import {
  PUBLIC_CARE_PATH,
  PUBLIC_REQUEST_PATH,
  publicEmailOk,
  type PublicLimitAlert,
  type PublicPlanKey,
} from "@/lib/public-forms";
import { offerSpread, sizeRangeWords } from "@/lib/public-pages";

/**
 * The two addresses the list of requests had (Nov 21 at /customers/requests, Nov 23 at
 * /opportunities/requests). Notices already sent carry them, so both send people on to
 * Opportunities, where every request now is.
 */
export const PUBLIC_REQUESTS_PATH = "/opportunities/requests";
export const PUBLIC_REQUESTS_OLD_PATH = "/customers/requests";
/** The source written on an opportunity made from a public page (public_request_submit). */
export const QR_LEAD_SOURCE = "QR page";
/** Where a request is answered: its own opportunity, or the list when it has none. */
export const requestOpportunityPath = (opportunityId: string | null | undefined): string =>
  opportunityId ? `/opportunities?id=${opportunityId}` : "/opportunities";
/** The badge on an opportunity nobody has put a customer on yet. */
export const NO_CUSTOMER_YET = "No customer yet";
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
    /** Nov 24: the building is further than the plans are priced for. */
    far?: boolean;
    /** The prices as the page had them. A size range adds each plan's low and high price. */
    plans?: { plan?: string; price?: number; price_low?: number; price_high?: number }[] | null;
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
  /**
   * Nov 26: is the matched property the building the request names (sameBuilding)? Worked out
   * by the server from the property's own street and zip. False until it is: a match that is
   * only alike never starts a plan by itself.
   */
  same_address: boolean;
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
      same_address: false,
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
  if (r.quote?.far) return "the building is outside the usual service area";
  if (r.quote?.custom_quote) return "the roof is over the size the plans are priced for";
  if (r.quote?.found === false) return "the address was not found on the map";
  return "";
}

/** A service request with no box ticked (Nov 24): filed as Other, its words say the rest. */
export const REQUEST_OTHER_ASK = "Other (see what they wrote)";

/**
 * The link behind a phone number a visitor typed (Nov 24): digits only, with a leading + kept.
 * Null when there are too few digits to be a number, and the number then shows as plain text.
 * Whatever else was typed (commas, letters, an "ext") stays out of the link.
 */
export function phoneLink(phone: string): string | null {
  const t = phone.trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${t.startsWith("+") ? "+" : ""}${digits}`;
}

/**
 * The link behind an email address a visitor typed (Nov 24): only for an address that is
 * nothing but an address (public-forms.ts PUBLIC_EMAIL_PATTERN). Anything else shows as text.
 */
export function emailLink(email: string): string | null {
  const t = email.trim();
  return publicEmailOk(t) ? `mailto:${t}` : null;
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
  // Nov 24: a request sent with no box ticked says what is wanted in its own words.
  return r.services.length ? r.services.join(", ") : REQUEST_OTHER_ASK;
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
  > & {
    several_buildings?: boolean;
    shown_price?: number | null;
    opportunity_id?: string | null;
  },
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
    body: `${r.contact_name.trim()}${where ? ` in ${where}` : ""} asked for ${ask}. Reference ${r.reference}. It is in Opportunities with nobody on it: open it to say whose it is.`,
    url: requestOpportunityPath(r.opportunity_id),
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
  /**
   * Only when they typed no size and picked a size range: the range in words, and the low and
   * high price the page showed for their plan (null when it showed one price). The size box of
   * the sign-up then starts blank: the middle of a range is nobody's roof.
   */
  picked_range?: { size: string; low: number | null; high: number | null };
}

/** Did the size come from a picked range alone: no size typed and no roof found on the map? */
export const sizeIsRangeOnly = (r: Pick<PublicRequestRow, "sqft_source">): boolean =>
  r.sqft_source === "range";

/**
 * The low and the high price the page showed for the plan they picked, when only a size range
 * was picked (owner, Nov 23). Null when the page showed one price.
 */
export function shownRange(
  r: Pick<PublicRequestRow, "plan" | "sqft_source" | "quote">,
): { low: number; high: number } | null {
  if (!sizeIsRangeOnly(r) || !r.plan) return null;
  const o = (r.quote?.plans ?? []).find((x) => x?.plan === r.plan);
  if (!o || typeof o.price !== "number") return null;
  return offerSpread({ price: o.price, price_low: o.price_low, price_high: o.price_high });
}

const dollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/**
 * After the plan's name on a request, for the office: the price the page showed and the size it
 * was for. ", shown $1,234 a year, for 21,000 sq ft, typed by them."
 */
export function careShownWords(
  r: Pick<
    PublicRequestRow,
    "plan" | "sqft" | "size_range" | "sqft_source" | "shown_price" | "quote"
  >,
): string {
  if (sizeIsRangeOnly(r)) {
    const range = shownRange(r);
    const size = sizeRangeWords(r.size_range);
    const shown = range
      ? `, shown ${dollars(range.low)} to ${dollars(range.high)} a year`
      : r.shown_price != null
        ? `, shown ${dollars(r.shown_price)} a year`
        : "";
    return `${shown}, for the size range they picked${size ? ` (${size})` : ""}. They typed no roof size.`;
  }
  const shown = r.shown_price != null ? `, shown ${dollars(r.shown_price)} a year` : "";
  const size =
    r.sqft != null
      ? `, for ${Math.round(r.sqft).toLocaleString("en-US")} sq ft, ${
          r.sqft_source === "map" ? "from the map" : "typed by them"
        }`
      : "";
  return `${shown}${size}.`;
}

export function carePrefill(r: PublicRequestRow): CareSignUpPrefill | null {
  // A custom quote is a call to make, not a sign-up to open: nothing was priced or agreed to.
  if (r.kind !== "care" || !r.plan || isCustomQuoteAsk(r)) return null;
  const rangeOnly = sizeIsRangeOnly(r);
  const range = shownRange(r);
  return {
    request_id: r.id,
    reference: r.reference,
    plan: r.plan,
    // A size nobody typed or measured is not put in the box.
    sqft: rangeOnly ? null : r.sqft,
    pay_method: r.pay_method ?? "check",
    agreed_by: (r.agreed_by ?? "").trim() || r.contact_name.trim(),
    referred_by: r.referred_by.trim(),
    customer_email: r.email.trim(),
    shown_price: r.shown_price,
    terms_version: r.terms_version,
    ...(rangeOnly
      ? {
          picked_range: {
            size: sizeRangeWords(r.size_range),
            low: range?.low ?? null,
            high: range?.high ?? null,
          },
        }
      : {}),
  };
}

/**
 * Can the plan be started straight from what the customer sent, with no sign-up window (owner,
 * Nov 24: the window "pops up the sign up window again, it should just ask us to confirm the
 * roof size, then send the payment link")? Yes when they typed a roof size and ticked the terms
 * now in use: everything the sign-up asks is then already answered. `why`: the plain reason
 * when not, said beside the sign-up button.
 */
export function careStartsItself(
  p: CareSignUpPrefill | null,
  termsInUse: string,
): { ok: true } | { ok: false; why: string } {
  if (!p) return { ok: false, why: CARE_START_NOT_A_PLAN };
  if (p.picked_range || !(p.sqft != null && p.sqft > 0))
    return { ok: false, why: CARE_START_NO_SIZE };
  if (p.terms_version !== termsInUse) return { ok: false, why: CARE_START_OLD_TERMS };
  return { ok: true };
}
export const CARE_START_NOT_A_PLAN = "This request did not pick a plan.";
export const CARE_START_NO_SIZE =
  "They typed no roof size, so the price is not known yet. Open the sign-up and type the roof's size.";
export const CARE_START_OLD_TERMS =
  "The terms have changed since they ticked them. Open the sign-up, read them the new terms and tick again.";
/** The button that starts the plan from the request, and the one that opens the window. */
export const CARE_START_BUTTON = "Start the plan";
export const CARE_OPEN_SIGN_UP = "Open the sign-up";
/** Said once the plan is made from the request. */
export const CARE_STARTED_WORDS =
  "The plan is made from what they picked, and their agreement is emailed. Confirm the roof size, then send the payment link.";
/** Said before the office says whose it is, so the press holds no surprise. */
export const CARE_START_AT_MATCH =
  "The plan they picked is started as soon as you say whose this is, and their agreement is emailed to them.";
/** The first inspection of a plan started from a request: the usual choice. */
export const CARE_START_FIRST_VISIT = "window" as const;

// ── One answer to a request, and the same building (Nov 26; the audit of Nov 25) ─────────────

/** Said to the second person who answers a request (the database says the same sentence). */
export const REQUEST_ALREADY_ANSWERED =
  "Someone already said whose this request is. Reload the page to see it.";
/** Said when a plan is asked for a request that already has one waiting or in force. */
export const REQUEST_HAS_PLAN = "This request already has its plan. Reload the page to see it.";
/** Said when the plan is asked at a property the request is not on. */
export const REQUEST_OTHER_PROPERTY =
  "This request is not on this property. Reload the page to see whose it is.";
/** A plan asked before anyone said whose the request is. */
export const REQUEST_SAY_WHO_FIRST =
  "Say whose this request is first. The plan is started after that.";
/** The plan is signed and the page could not read it back: the truth, not "it was not started". */
export const CARE_SIGNED_NOT_READ = "The plan is signed. The page could not read it back: reload.";
/** The button under two addresses that are not the same: one more press, on purpose. */
export const CARE_START_HERE_BUTTON = "Start the plan at this property";
/** The server's refusal when the plan is asked at another address with no such press. */
export const CARE_START_OTHER_ADDRESS = `The property's address is not the one they typed. Check both addresses, then press ${CARE_START_HERE_BUTTON}.`;
/** Under the two addresses, side by side. */
export const CARE_ADDRESS_DIFFERS =
  "These are not the same address. Start the plan here only if this is the building they mean. If it is not, pick the right property on this opportunity and save it.";
/** Beside a possible match whose property is only alike. */
export const CARE_MATCH_ADDRESS_DIFFERS =
  "Not the same address as they typed: the plan is not started until you have checked it.";

/** A building's address, as far as it is compared: the street line, the city and the zip. */
export interface BuildingAddress {
  street: string | null | undefined;
  city?: string | null | undefined;
  zip?: string | null | undefined;
}
export const requestBuilding = (
  r: Pick<PublicRequestRow, "address" | "city" | "zip">,
): BuildingAddress => ({ street: r.address, city: r.city, zip: r.zip });
export const siteBuilding = (s: {
  address1?: string | null;
  city?: string | null;
  zip?: string | null;
}): BuildingAddress => ({ street: s.address1, city: s.city, zip: s.zip });

/** The usual street words, each as its short form. A word not here is kept as typed. */
const STREET_WORDS: Readonly<Record<string, string>> = {
  street: "st",
  str: "st",
  saint: "st",
  road: "rd",
  avenue: "ave",
  av: "ave",
  aven: "ave",
  boulevard: "blvd",
  boul: "blvd",
  blv: "blvd",
  drive: "dr",
  drv: "dr",
  lane: "ln",
  highway: "hwy",
  hiway: "hwy",
  hway: "hwy",
  hgwy: "hwy",
  parkway: "pkwy",
  pkway: "pkwy",
  pky: "pkwy",
  court: "ct",
  crt: "ct",
  place: "pl",
  circle: "cir",
  circ: "cir",
  terrace: "ter",
  terr: "ter",
  trail: "trl",
  tr: "trl",
  wy: "way",
  square: "sq",
  expressway: "expy",
  expwy: "expy",
  freeway: "fwy",
  route: "rt",
  rte: "rt",
  turnpike: "tpke",
  pk: "pike",
  alley: "aly",
  crossing: "xing",
  point: "pt",
  heights: "hts",
  mount: "mt",
  mountain: "mtn",
  fort: "ft",
  center: "ctr",
  centre: "ctr",
  plaza: "plz",
  bypass: "byp",
  cove: "cv",
  hollow: "holw",
  ridge: "rdg",
  creek: "crk",
  branch: "br",
  spring: "spg",
  springs: "spgs",
  valley: "vly",
  view: "vw",
  extension: "ext",
  junction: "jct",
  station: "sta",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
  first: "1",
  second: "2",
  third: "3",
  fourth: "4",
  fifth: "5",
  sixth: "6",
  seventh: "7",
  eighth: "8",
  ninth: "9",
  tenth: "10",
  eleventh: "11",
  twelfth: "12",
};
/** The words a street ends with: one side may leave its own off ("200 S Main"). */
const STREET_ENDS: ReadonlySet<string> = new Set([
  "st",
  "rd",
  "ave",
  "blvd",
  "dr",
  "ln",
  "hwy",
  "pkwy",
  "ct",
  "pl",
  "cir",
  "ter",
  "trl",
  "way",
  "sq",
  "expy",
  "fwy",
  "pike",
  "tpke",
  "aly",
  "xing",
  "loop",
  "run",
  "cv",
  "byp",
]);
/** The words before a unit, a suite or a building: they and what they name are left out. */
const UNIT_WORDS: ReadonlySet<string> = new Set([
  "apt",
  "apartment",
  "unit",
  "suite",
  "ste",
  "bldg",
  "building",
  "rm",
  "room",
  "fl",
  "floor",
  "lot",
  "space",
  "spc",
  "trlr",
  "trailer",
  "dept",
  "office",
  "ofc",
]);
/** What a unit is called: "200", "B", "4C", "A-1". A plain word after "Building" is a street. */
const unitName = (t: string): boolean => /\d/.test(t) || t.length === 1;

/**
 * A street line as it is compared: lower case, no punctuation, single spaces, the usual street
 * and compass words in their short form, "1st" and "First" as 1, and no unit, suite, floor or
 * building. "120 N. Maple Street, Suite 4" and "120 north maple st" both read "120 n maple st".
 * Forgiving on purpose (owner, Nov 26: "just ensure its not too strict to match at all").
 */
export function streetKey(street: string | null | undefined): string {
  const flat = (street ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’`]/g, "")
    .replace(/#/g, " unit ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bu s\b/g, "us")
    .trim();
  if (!flat) return "";
  // The unit and what it names, after the number and one word of the street. A unit word with
  // a plain word after it ("Office Park Dr", "Parking Lot Rd") is part of the street's name.
  const kept: string[] = [];
  const raw = flat.split(" ");
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]!;
    if (i >= 2 && UNIT_WORDS.has(t)) {
      const next = raw[i + 1];
      // "2nd Floor": the number stands before the word.
      const before =
        (t === "floor" || t === "fl") &&
        kept.length > 2 &&
        /^\d+(st|nd|rd|th)$/.test(kept.at(-1) ?? "");
      if (before || next === undefined || unitName(next)) {
        if (before) kept.pop();
        let taken = 0;
        while (taken < 2 && i + 1 < raw.length && unitName(raw[i + 1]!)) {
          i++;
          taken++;
        }
        continue;
      }
    }
    kept.push(t);
  }
  const words: string[] = [];
  for (const t0 of kept) {
    // "5th" is 5; "25e" is 25 and e; "ky80" is ky and 80.
    const t = t0.replace(/^(\d+)(st|nd|rd|th)$/, "$1");
    const split = /^(\d+)([a-z]+)$/.exec(t) ?? /^([a-z]+)(\d+)$/.exec(t);
    for (const part of split ? [split[1]!, split[2]!] : [t]) words.push(STREET_WORDS[part] ?? part);
  }
  // "US Highway 25" is "US 25", and "KY Route 80" is "KY 80": the road's number says it all.
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const numbered = /^\d+$/.test(words[i + 1] ?? "");
    const prev = out.at(-1) ?? "";
    if ((w === "hwy" || w === "rt") && numbered && /^[a-z]{2}$/.test(prev)) continue;
    out.push(w);
  }
  return out.join(" ");
}

const zip5 = (z: string | null | undefined): string => {
  const d = (z ?? "").replace(/\D/g, "");
  return d.length >= 5 ? d.slice(0, 5) : "";
};
const cityKey = (c: string | null | undefined): string =>
  (c ?? "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");

/**
 * Is this the same building (Nov 26; the audit's number 17)? The list of possible matches is
 * as generous as it was: this is only what lets a plan start by itself at a matched property.
 * The street lines read the same (streetKey), where one side may leave the street's last word
 * off ("200 S Main" and "200 S Main St"). The first five digits of the zip are the same when
 * both have one. With a zip missing on either side, the cities are the same when both have
 * one. A missing city or zip never blocks. Two empty streets are never the same building.
 * A street line with no plain letter or digit in it is compared as it was typed, so a property
 * made from the request's own address is always the same building.
 */
export function sameBuilding(a: BuildingAddress, b: BuildingAddress): boolean {
  const asTyped = (s: string | null | undefined) =>
    (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const ka = streetKey(a.street) || asTyped(a.street);
  const kb = streetKey(b.street) || asTyped(b.street);
  if (!ka || !kb) return false;
  if (ka !== kb) {
    const [short, long] = ka.length < kb.length ? [ka, kb] : [kb, ka];
    const rest = long.startsWith(`${short} `) ? long.slice(short.length + 1) : "";
    if (!STREET_ENDS.has(rest) || short.split(" ").length < 2) return false;
  }
  const za = zip5(a.zip);
  const zb = zip5(b.zip);
  if (za && zb) return za === zb;
  const ca = cityKey(a.city);
  const cb = cityKey(b.city);
  return !ca || !cb || ca === cb;
}

/** "120 Main St, London, KY 40741" for a property, as requestAddress says a request's. */
export function siteAddressWords(s: {
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  return requestAddress({
    address: s.address1 ?? "",
    city: s.city ?? "",
    state: s.state ?? "",
    zip: s.zip ?? "",
  });
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
  const pr = p.picked_range;
  const picked = pr ? ` They typed no roof size and picked ${pr.size || "a size range"}` : "";
  const shown =
    pr && pr.low != null && pr.high != null
      ? `${picked}, so the page showed them ${wholeDollars(pr.low)} to ${wholeDollars(pr.high)} a year.`
      : p.shown_price != null && p.shown_price > 0
        ? ` The page showed them ${wholeDollars(p.shown_price)} a year.${picked ? `${picked}.` : ""}`
        : picked
          ? `${picked}.`
          : "";
  const terms =
    p.terms_version === termsInUse
      ? " They ticked these terms there, so the tick is already on."
      : " The terms have changed since they ticked them: read them the new ones and tick again.";
  const who = p.referred_by.trim() ? ` Referred by: ${p.referred_by.trim()}.` : "";
  const next = pr
    ? "The roof size box is blank: type the roof's real size, press Show my price and choose when the first inspection is."
    : "Check the roof size, press Show my price and choose when the first inspection is.";
  return `From the public Roof Care page, request ${p.reference}.${shown}${terms}${who} ${next}`;
}

/** The note kept on the plan, so the request and who referred them are not lost. */
export function carePrefillNote(p: CareSignUpPrefill): string {
  const who = p.referred_by.trim();
  return `From the public Roof Care page, request ${p.reference}.${who ? ` Referred by: ${who}.` : ""}`;
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

// ── The strip on a request's opportunity (Nov 23) ───────────────────────────────────────────

/** What the strip is called, by the kind of request. */
export function requestStripTitle(r: Pick<PublicRequestRow, "kind" | "shown_price">): string {
  if (isCustomQuoteAsk(r)) return "Sent from the Roof Care plans page: a custom quote";
  return r.kind === "care"
    ? "Sent from the Roof Care plans page"
    : "Sent from the Request service page";
}

/**
 * Where a request stands, for the strip: whose it is has not been said ("who"), a Roof Care
 * sign-up is ready to open ("sign_up"), a custom quote is to be called with a price ("quote"),
 * the plan is signed and waits for its payment ("signed"), the plan is paid and has started
 * ("paid"), a Roof Care request whose opportunity has a customer but no property yet
 * ("property"), or nothing more is asked of anyone ("done").
 */
export type RequestStep =
  "who" | "property" | "sign_up" | "quote" | "signed" | "paid" | "ended" | "done";
export function requestStep(
  r: Pick<PublicRequestRow, "kind" | "shown_price" | "plan" | "roof_care_plan_id">,
  opp: { account_id: string | null; site_id: string | null },
  /** The status of the plan the request became, when it became one. */
  planStatus?: string | null,
): RequestStep {
  // Nov 26: a plan that was ended is said so. It read "signed and waits for its payment".
  if (r.roof_care_plan_id)
    return planStatus === "active" ? "paid" : planStatus === "ended" ? "ended" : "signed";
  if (!opp.account_id) return "who";
  if (r.kind !== "care") return "done";
  if (isCustomQuoteAsk(r)) return "quote";
  if (!r.plan) return "done";
  return opp.site_id ? "sign_up" : "property";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 25, 2026" from "2026-11-25"; "" when it is not a day. */
function dayWords(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${Number(m[3])}, ${m[1]}` : "";
}

/** What is known of a plan that was ended: the day, and whether it was ever paid. */
export interface EndedPlanFacts {
  ended_on?: string | null | undefined;
  paid?: boolean | undefined;
}

/** What the strip tells the office to do next. */
export function requestStepWords(
  step: RequestStep,
  r: Pick<PublicRequestRow, "kind">,
  ended?: EndedPlanFacts,
): string {
  switch (step) {
    case "who":
      return "Say whose this is. Nothing else on this opportunity is saved until it has a customer.";
    case "property":
      return "Pick the property on this opportunity and save it. The sign-up opens from there.";
    case "sign_up":
      return "The customer picked a plan and ticked the terms on the page. Start the plan: it is made from what they picked. Then confirm the roof size and send the payment link. It starts when the payment is received.";
    case "quote":
      return "No price was shown on the page, so nothing was signed. Call them with a price.";
    case "signed":
      return "The plan is signed and waits for its payment. Work down the steps below. This opportunity turns Won the day the payment is received.";
    case "paid":
      return "The plan is paid and has started. This opportunity was set to Won.";
    case "ended": {
      // Nov 26: it read "signed and waits for its payment" for ever.
      const on = dayWords(ended?.ended_on);
      return `The plan made from this request was ended${on ? ` on ${on}` : ""}${ended?.paid ? "" : ", before it was paid"}. Nothing waits here.`;
    }
    case "done":
      return r.kind === "care"
        ? "The customer is on this opportunity."
        : "The customer is on this opportunity. Call them, then start a ticket or a bid from here.";
  }
}

// ── The day's limits of the public pages, as the office reads them (Nov 24) ─────────────────

const count = (n: number) => Math.round(n).toLocaleString("en-US");

/** The notice the admins get when a day's limit is nearly reached, or reached. */
export function publicLimitNotice(a: PublicLimitAlert): {
  kind: string;
  title: string;
  body: string;
  url: string;
} {
  const what = a.kind === "quote" ? "price questions" : "requests";
  const page = a.kind === "quote" ? "The Roof Care page" : "The public pages";
  const where = "The count is in Setup, QR pages.";
  return a.level === "near"
    ? {
        kind: "public_limit",
        title: `${page}: ${count(a.used)} of today's ${count(a.cap)} ${what} are used`,
        body: `If it reaches ${count(a.cap)}, visitors are asked to call the office until midnight. ${where}`,
        url: PUBLIC_SETUP_PATH,
      }
    : {
        kind: "public_limit",
        title: `${page} ${a.kind === "quote" ? "has" : "have"} reached today's limit of ${count(a.cap)} ${what}`,
        body: `Visitors are now asked to call the office until midnight. ${where}`,
        url: PUBLIC_SETUP_PATH,
      };
}

/** What the office sees of the public pages' counts and the day's emails (public_form_usage). */
export interface PublicUsage {
  quote: { used: number; cap: number };
  request: { used: number; cap: number };
  /** The last thirty days, newest first. */
  days: { day: string; quote: number; request: number; dropped: number }[];
  email: { used: number; held: number; cap: number; hold: number };
}

const whole = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** public_form_usage()'s answer, read strictly. Null when it is not one. */
export function readUsage(x: unknown): PublicUsage | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const pair = (v: unknown) => {
    const p = (v ?? {}) as Record<string, unknown>;
    return { used: whole(p["used"]), cap: whole(p["cap"]) };
  };
  const e = (o["email"] ?? {}) as Record<string, unknown>;
  const days = Array.isArray(o["days"]) ? o["days"] : [];
  return {
    quote: pair(o["quote"]),
    request: pair(o["request"]),
    days: days
      .map((d) => (d ?? {}) as Record<string, unknown>)
      .filter((d) => typeof d["day"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d["day"] as string))
      .map((d) => ({
        day: d["day"] as string,
        quote: whole(d["quote"]),
        request: whole(d["request"]),
        dropped: whole(d["dropped"]),
      }))
      .slice(0, 31),
    email: {
      used: whole(e["used"]),
      held: whole(e["held"]),
      cap: whole(e["cap"]),
      hold: whole(e["hold"]),
    },
  };
}

/** "37 of 2,000", and how full that is: "ok", "near" from four fifths, "full" at the limit. */
export function usageLine(
  used: number,
  cap: number,
): { words: string; level: "ok" | "near" | "full" } {
  const level =
    cap > 0 && used >= cap ? "full" : cap > 0 && used >= Math.ceil(cap * 0.8) ? "near" : "ok";
  return { words: `${count(used)} of ${count(cap)}`, level };
}

/** The line under the email count on Setup, QR pages. */
export function emailUsageWords(e: PublicUsage["email"]): string {
  if (e.cap <= 0)
    return `${count(e.used)} sent in the last 24 hours. No daily limit is set, so nothing waits.`;
  const held =
    e.held > 0
      ? ` ${count(e.held)} staff notice email${e.held === 1 ? "" : "s"} waited: each notice is in the bell.`
      : "";
  return `${count(e.used)} of ${count(e.cap)} sent in the last 24 hours. From ${count(e.hold)}, emails to staff about notices wait, so the rest is kept for customers.${held}`;
}

/** Above today's counts on Setup, QR pages. */
export const USAGE_NOTE =
  "How much of today's limits the two public pages have used. The limits stop one visitor, or a flood, from tying up the pages. An admin gets a notice at four fifths of a limit and again when it is reached. A day runs midnight to midnight.";
/** Above the email limit on Setup, QR pages. */
export const EMAIL_CAP_NOTE =
  "How many emails the email plan allows in 24 hours: 100 on the free plan. Type 0 if the plan has no daily limit. From four fifths of it, emails to staff about notices wait so customers' agreements, receipts and invoices still go, and an admin gets a notice.";
