/**
 * The two public pages' own rules (Roof Care step 4, Nov 21): what each form still needs before
 * it can be sent, in the visitor's words, and what is sent. The pages are components/public/*;
 * the shape agreed with the server is lib/public-forms.ts. Nothing here knows a price.
 */
import {
  PUBLIC_SIZE_RANGE_ENDS,
  PUBLIC_SIZE_RANGES,
  publicEmailOk,
  type PublicAddress,
  type PublicCareRequest,
  type PublicContact,
  type PublicPlanKey,
  type PublicPlanOffer,
  type PublicQuote,
  type PublicQuoteAsk,
  type PublicServiceRequest,
  type PublicSizeRange,
} from "@/lib/public-forms";

/** How to reach the company: printed on the flyer and on its website, so public already. */
export const PUBLIC_COMPANY = {
  name: "JBK Commercial Roofing",
  phone: "606-523-9000",
  phoneHref: "tel:+16065239000",
  email: "Sales@flatroofonline.com",
  web: "flatroofonline.com",
} as const;

export const CARE_PAGE_TITLE = "Roof Care Plans";
export const REQUEST_PAGE_TITLE = "Request Service";
export const REQUEST_PAGE_LEAD =
  "Tell us about the building and what is going on. We will call you back to set up a visit.";
/** Under the prices: they are worked from the map until someone has measured the roof. */
export const PRICE_IS_ESTIMATE =
  "These prices are an estimate until we measure your roof. If the roof's size is different, the price is corrected before you pay.";
export const NOBODY_CHARGED =
  "Nobody is charged on this page. Our office sends the invoice for the year and gets in touch about payment.";
export const SEVERAL_BUILDINGS_LINE = `Several buildings get multi-building pricing. Send this for one of them and we will call you about the rest, or call us at ${PUBLIC_COMPANY.phone}.`;
export const CUSTOM_QUOTE_LINE = `A roof this size gets a custom quote. Send us your details below and we will call you with a price, or call us at ${PUBLIC_COMPANY.phone}.`;
/** Nov 24: a building further than the plans are priced for. Its details can still be sent. */
export const FAR_QUOTE_LINE = `This building is outside our usual service area, so we cannot show a price here. Send us your details below and we will call you, or call us at ${PUBLIC_COMPANY.phone}.`;
export const NOT_FOUND_LINE = `We could not find that address on the map, so we cannot show a price here. Check the street, city, state and zip, or call us at ${PUBLIC_COMPANY.phone}.`;
export const SEND_FAILED_LINE = `That did not go through. Nothing you typed is lost: try again, or call us at ${PUBLIC_COMPANY.phone}.`;
export const WHAT_HAPPENS_NEXT: readonly string[] = [
  "We confirm the size of your roof.",
  "We send you one invoice for the year.",
  "Your plan starts the day your payment is received, and we schedule your first inspection.",
];

const has = (s: string | null | undefined) => (s ?? "").trim().length > 0;
/** Ten digits make a phone number, however they are typed. */
export const phoneDigits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
export const phoneOk = (s: string) => phoneDigits(s).length === 10;
// Nov 24: the same rule the server keeps (public-forms.ts), so the page says so first.
export const emailOk = (s: string) => publicEmailOk(s);
export const zipOk = (s: string) => /^\d{5}(-\d{4})?$/.test(s.trim());
/** Two letters, as it is written on an envelope. */
export const stateOk = (s: string) => /^[A-Za-z]{2}$/.test(s.trim());

/** Square feet as typed ("20,000" / "20000"): a whole number above 0, else null. */
export function sqftTyped(s: string): number | null {
  const t = s.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One thing a field still needs, under that field. */
export type Problems<K extends string> = Partial<Record<K, string>>;

export type AddressKey = "address" | "city" | "state" | "zip";
/** What the building's address still needs. */
export function addressProblems(a: PublicAddress): Problems<AddressKey> {
  const p: Problems<AddressKey> = {};
  if (!has(a.address) || a.address.trim().length < 3) p.address = "Type the street address.";
  if (!has(a.city)) p.city = "Type the city.";
  if (!stateOk(a.state)) p.state = "Two letters, like KY.";
  if (!zipOk(a.zip)) p.zip = "Five digits.";
  return p;
}

export interface CareBuilding extends PublicAddress {
  building_name: string;
  /** The size box as typed; blank when they picked a range or do not know. */
  sqft: string;
  size_range: PublicSizeRange | null;
  several_buildings: boolean;
}

export type BuildingKey = AddressKey | "size";
/** Step 1 of the Roof Care page: the address, and a size or a size range. */
export function buildingProblems(b: CareBuilding): Problems<BuildingKey> {
  const p: Problems<BuildingKey> = addressProblems(b);
  if (has(b.sqft) && sqftTyped(b.sqft) == null)
    p.size = "Type the roof's size as a number, like 20,000, or pick a size below.";
  else if (!has(b.sqft) && !b.size_range)
    p.size = "Type the roof's size, or pick the closest size below.";
  return p;
}

/** What is asked of the server for the prices. A typed size wins over a picked range. */
export function quoteAsk(b: CareBuilding): PublicQuoteAsk {
  const typed = sqftTyped(b.sqft);
  return {
    address: b.address.trim(),
    city: b.city.trim(),
    state: b.state.trim().toUpperCase(),
    zip: b.zip.trim(),
    sqft: typed,
    size_range: typed == null ? b.size_range : null,
  };
}

export type ContactKey = "contact_name" | "phone" | "email";
export function contactProblems(c: PublicContact): Problems<ContactKey> {
  const p: Problems<ContactKey> = {};
  if (!has(c.contact_name)) p.contact_name = "Type your name.";
  if (!phoneOk(c.phone)) p.phone = "Type a phone number with its area code.";
  if (!emailOk(c.email)) p.email = "Type an email address, like name@company.com.";
  return p;
}

/** May a plan be picked from this answer? Not for a custom quote or an address not found. */
export const quoteHasPrices = (q: PublicQuote | null): boolean =>
  !!q && q.found && !q.custom_quote && q.plans.length > 0;

export interface CareAnswers {
  building: CareBuilding;
  /** The prices as last answered for this building; null before, or after the building changed. */
  quote: PublicQuote | null;
  plan: PublicPlanKey | null;
  contact: PublicContact;
  pay_method: "check" | "card" | null;
  referred_by: string;
  notes: string;
  agreed: boolean;
  agreed_by: string;
}

/**
 * What the Roof Care page still needs before it can be sent, in the order of the page and in the
 * visitor's words. A roof that gets a custom quote can still be sent: it needs no plan, no way
 * of paying and no agreement, only who to call.
 */
export function careMissing(a: CareAnswers): string[] {
  const out: string[] = [];
  if (Object.keys(buildingProblems(a.building)).length > 0)
    out.push("your building's address and size");
  if (!a.quote) {
    out.push("your price (press Show my price)");
    return out;
  }
  if (!a.quote.found) {
    out.push("an address we can find on the map");
    return out;
  }
  const priced = quoteHasPrices(a.quote);
  if (priced && !a.plan) out.push("the plan you want");
  const c = contactProblems(a.contact);
  if (c.contact_name) out.push("your name");
  if (c.phone) out.push("your phone number");
  if (c.email) out.push("your email");
  if (priced) {
    if (!a.pay_method) out.push("how you would like to pay");
    if (!has(a.agreed_by)) out.push("your name as your signature");
    if (!a.agreed) out.push("the tick that you agree to the terms");
  }
  return out;
}

/** "Still needed: a; b; c." */
export const missingLine = (missing: readonly string[]): string =>
  missing.length ? `Still needed: ${missing.join("; ")}.` : "";

/** What is sent for the Roof Care page. Null while something is missing. */
export function careRequest(
  a: CareAnswers,
  extra: { terms_version: string; website: string; open_ms: number },
): PublicCareRequest | null {
  if (careMissing(a).length > 0 || !a.quote) return null;
  const priced = quoteHasPrices(a.quote);
  const offer = priced ? a.quote.plans.find((o) => o.plan === a.plan) : undefined;
  if (priced && !offer) return null;
  const ask = quoteAsk(a.building);
  return {
    contact_name: a.contact.contact_name.trim(),
    company: a.contact.company.trim(),
    phone: phoneDigits(a.contact.phone),
    email: a.contact.email.trim(),
    address: ask.address,
    city: ask.city,
    state: ask.state,
    zip: ask.zip,
    building_name: a.building.building_name.trim(),
    // A custom quote has no plan picked: the recommended one stands in, and the notes say so.
    plan: offer ? offer.plan : (a.plan ?? "care"),
    sqft: a.quote.sqft ?? ask.sqft ?? null,
    size_range: ask.size_range ?? null,
    shown_price: offer ? offer.price : 0,
    quote_token: a.quote.quote_token,
    pay_method: a.pay_method ?? "check",
    agreed: true,
    terms_version: extra.terms_version,
    agreed_by: (priced ? a.agreed_by : a.contact.contact_name).trim(),
    referred_by: a.referred_by.trim(),
    several_buildings: a.building.several_buildings,
    notes: [
      priced
        ? ""
        : a.quote.far
          ? "Outside the usual service area: no price was shown."
          : "Custom quote asked for: no price was shown.",
      a.notes.trim(),
    ]
      .filter(Boolean)
      .join(" "),
    website: extra.website,
    open_ms: extra.open_ms,
  };
}

export interface ServiceAnswers extends PublicAddress {
  building_name: string;
  services: string[];
  details: string;
  contact: PublicContact;
  referred_by: string;
}

/** What the service request still needs, in the order of the page. */
export function serviceMissing(a: ServiceAnswers, choices: readonly string[]): string[] {
  const out: string[] = [];
  // With no list to tick from (it could not be read), the text box says what is wanted.
  if (choices.length > 0 && a.services.length === 0 && !has(a.details))
    out.push("what you need (tick a service or tell us what is going on)");
  if (choices.length === 0 && !has(a.details)) out.push("what is going on");
  if (Object.keys(addressProblems(a)).length > 0) out.push("the building's address");
  const c = contactProblems(a.contact);
  if (c.contact_name) out.push("your name");
  if (c.phone) out.push("your phone number");
  if (c.email) out.push("your email");
  return out;
}

export function serviceRequest(
  a: ServiceAnswers,
  choices: readonly string[],
  extra: { website: string; open_ms: number },
): PublicServiceRequest | null {
  if (serviceMissing(a, choices).length > 0) return null;
  return {
    contact_name: a.contact.contact_name.trim(),
    company: a.contact.company.trim(),
    phone: phoneDigits(a.contact.phone),
    email: a.contact.email.trim(),
    address: a.address.trim(),
    city: a.city.trim(),
    state: a.state.trim().toUpperCase(),
    zip: a.zip.trim(),
    building_name: a.building_name.trim(),
    // Only what is on the office's list, in the list's order, each once.
    services: choices.filter((s) => a.services.includes(s)),
    details: a.details.trim(),
    referred_by: a.referred_by.trim(),
    website: extra.website,
    open_ms: extra.open_ms,
  };
}

/** Has the building changed since the prices were asked for? Then they are asked for again. */
export const sameAsk = (a: PublicQuoteAsk, b: PublicQuoteAsk): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** "$1,234": whole dollars, as the flyer prints a price. */
export const wholeDollars = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

// ── A size range shows a range of prices (owner, Nov 23: "go with B and C") ─────────────────

type Priced = Pick<PublicPlanOffer, "price"> & {
  price_low?: number | null | undefined;
  price_high?: number | null | undefined;
};

/**
 * The low and the high price of a plan, when a size range was picked with no size typed and
 * the two are not the same dollar. Null for one price: a typed size, a roof found on the map,
 * or a range whose two ends cost the same.
 */
export function offerSpread(o: Priced): { low: number; high: number } | null {
  const { price_low: low, price_high: high } = o;
  if (low == null || high == null || !(low > 0) || !(low <= o.price) || !(high >= o.price))
    return null;
  return Math.round(low) === Math.round(high) ? null : { low, high };
}

/** What a plan's card shows as its price: "$1,234", or "$1,234 to $2,345" for a size range. */
export function offerPriceWords(o: Priced): string {
  const s = offerSpread(o);
  return s ? `${wholeDollars(s.low)} to ${wholeDollars(s.high)}` : wholeDollars(o.price);
}

const sqftWords = (n: number) => Math.round(n).toLocaleString("en-US");

/** "25,000 to 50,000 sq ft", or "under 10,000 sq ft" for the smallest range. Empty if none. */
export function sizeRangeWords(range: string | null | undefined): string {
  const ends = range ? (PUBLIC_SIZE_RANGE_ENDS[range as PublicSizeRange] ?? null) : null;
  if (!ends) return "";
  return ends.low <= 1
    ? `under ${sqftWords(ends.high)} sq ft`
    : `${sqftWords(ends.low)} to ${sqftWords(ends.high)} sq ft`;
}

/**
 * Under the prices: which roof size they are for, and, when only a range was picked, how to get
 * one price. Empty when no price is shown.
 */
export function priceSizeLine(q: PublicQuote | null, ask: PublicQuoteAsk | null): string {
  if (!q || !quoteHasPrices(q) || q.sqft == null) return "";
  if (q.sqft_source === "map")
    return `These prices are for a roof of about ${sqftWords(q.sqft)} sq ft, the size we measured from the map at your address.`;
  if (q.sqft_source === "typed")
    return `These prices are for a roof of ${sqftWords(q.sqft)} sq ft, the size you typed.`;
  const size = sizeRangeWords(ask?.size_range);
  if (!size) return "";
  return q.plans.some((o) => offerSpread(o))
    ? `You picked ${size}, so each plan shows its lowest and its highest price for a roof that size. For one price, type your roof's size in step 1 and press Show my price again.`
    : `These prices are for a roof ${size.startsWith("under") ? size : `of ${size}`}, the size you picked.`;
}

// ── What is in the boxes, read from the page itself (Nov 24, the public pages audit) ─────────
//
// On a slow phone the form is on the screen seconds before the page's script is ready. What a
// visitor typed in that time stayed in the boxes, but the page did not know it and answered
// "Type the street address." The pages now read the boxes themselves: once when the script is
// ready, and again at every press of a button. The same covers a browser that fills a form in
// by itself without telling the page.

/** One box as the browser holds it. */
export interface BoxLike {
  id: string;
  type?: string | null;
  value: string;
  checked?: boolean;
}
/** Every box of a form by its id: what is typed in it, or whether it is ticked. */
export type TypedBoxes = Readonly<Record<string, string | boolean>>;

export function typedBoxes(
  form: { querySelectorAll(selector: string): ArrayLike<BoxLike> } | null | undefined,
): TypedBoxes {
  const out: Record<string, string | boolean> = {};
  if (!form) return out;
  for (const el of Array.from(form.querySelectorAll("input, textarea"))) {
    if (!el.id) continue;
    out[el.id] = el.type === "checkbox" || el.type === "radio" ? el.checked === true : el.value;
  }
  return out;
}

const typedIn = (b: TypedBoxes, id: string, now: string): string => {
  const v = b[id];
  return typeof v === "string" ? v : now;
};
const tickedIn = (b: TypedBoxes, id: string, now: boolean): boolean => {
  const v = b[id];
  return typeof v === "boolean" ? v : now;
};
const sameFields = <T extends object>(a: T, b: T): boolean =>
  (Object.keys(b) as (keyof T)[]).every((k) => a[k] === b[k]);

/** The address boxes as the page holds them; the same object when nothing differs. */
function adoptAddress<T extends PublicAddress & { building_name: string }>(now: T, b: TypedBoxes) {
  return {
    address: typedIn(b, "address", now.address),
    city: typedIn(b, "city", now.city),
    state: typedIn(b, "state", now.state),
    zip: typedIn(b, "zip", now.zip),
    building_name: typedIn(b, "building_name", now.building_name),
  };
}

/** Step 1 of the Roof Care page with what is really in its boxes. */
export function adoptBuilding(now: CareBuilding, b: TypedBoxes): CareBuilding {
  let range = now.size_range;
  for (const r of PUBLIC_SIZE_RANGES) if (b[`size-${r.key}`] === true) range = r.key;
  const next: CareBuilding = {
    ...adoptAddress(now, b),
    sqft: typedIn(b, "sqft", now.sqft),
    size_range: range,
    several_buildings: tickedIn(b, "several_buildings", now.several_buildings),
  };
  return sameFields(now, next) ? now : next;
}

/** "About you" with what is really in its boxes. */
export function adoptContact(now: PublicContact, b: TypedBoxes): PublicContact {
  const next: PublicContact = {
    contact_name: typedIn(b, "contact_name", now.contact_name),
    company: typedIn(b, "company", now.company),
    phone: typedIn(b, "phone", now.phone),
    email: typedIn(b, "email", now.email),
  };
  return sameFields(now, next) ? now : next;
}

/** The rest of the Roof Care page: how to pay, the notes, the agreement. */
export interface CareRest {
  pay_method: "check" | "card" | null;
  referred_by: string;
  notes: string;
  agreed: boolean;
  agreed_by: string;
}
export function adoptCareRest(now: CareRest, b: TypedBoxes): CareRest {
  const next: CareRest = {
    pay_method:
      b["pay-check"] === true ? "check" : b["pay-card"] === true ? "card" : now.pay_method,
    referred_by: typedIn(b, "referred_by", now.referred_by),
    notes: typedIn(b, "notes", now.notes),
    agreed: tickedIn(b, "agreed", now.agreed),
    agreed_by: typedIn(b, "agreed_by", now.agreed_by),
  };
  return sameFields(now, next) ? now : next;
}

/** The Request service page with what is really in its boxes. */
export function adoptService(
  now: ServiceAnswers,
  b: TypedBoxes,
  choices: readonly string[],
): ServiceAnswers {
  const contact = adoptContact(now.contact, b);
  const ticked = choices.filter((s, i) => tickedIn(b, `service-${i}`, now.services.includes(s)));
  // What is ticked and not on the list now (the list could not be read again) is kept as it is.
  const services = [...ticked, ...now.services.filter((s) => !choices.includes(s))];
  const sameServices =
    services.length === now.services.length && services.every((s) => now.services.includes(s));
  const next: ServiceAnswers = {
    ...adoptAddress(now, b),
    services: sameServices ? now.services : services,
    details: typedIn(b, "details", now.details),
    contact,
    referred_by: typedIn(b, "referred_by", now.referred_by),
  };
  return sameFields(now, next) ? now : next;
}

/** The id of the box no person fills in (components/public/fields.tsx RobotTrap). */
export const ROBOT_TRAP_ID = "jbk-leave-blank";
export const adoptTrap = (now: string, b: TypedBoxes): string => typedIn(b, ROBOT_TRAP_ID, now);
