/**
 * The two public pages' own rules (Roof Care step 4, Nov 21): what each form still needs before
 * it can be sent, in the visitor's words, and what is sent. The pages are components/public/*;
 * the shape agreed with the server is lib/public-forms.ts. Nothing here knows a price.
 */
import type {
  PublicAddress,
  PublicCareRequest,
  PublicContact,
  PublicPlanKey,
  PublicQuote,
  PublicQuoteAsk,
  PublicServiceRequest,
  PublicSizeRange,
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
  "These prices are an estimate until we measure your roof. If the roof's size is different, the price is corrected once, before you pay.";
export const NOBODY_CHARGED =
  "Nobody is charged on this page. Our office sends the invoice for the year and gets in touch about payment.";
export const SEVERAL_BUILDINGS_LINE = `Several buildings get multi-building pricing. Send this for one of them and we will call you about the rest, or call us at ${PUBLIC_COMPANY.phone}.`;
export const CUSTOM_QUOTE_LINE = `A roof this size gets a custom quote. Send us your details below and we will call you with a price, or call us at ${PUBLIC_COMPANY.phone}.`;
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
export const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
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
    notes: [priced ? "" : "Custom quote asked for: no price was shown.", a.notes.trim()]
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
