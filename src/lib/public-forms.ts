/**
 * The two public pages opened by the QR codes on printed sheets, with no sign-in (Roof Care
 * step 4; owner, Nov 18 and Nov 20): "Roof Care plans" at /care and "Request service" at
 * /request. This file is the agreed shape between the pages and the server functions in
 * `public-forms.functions.ts`: what a visitor sends and what comes back.
 *
 * Nothing here, and nothing a public function answers, ever says whether the visitor is already
 * a customer. A possible match is for the office alone.
 */

/** Where the public pages live. Short on purpose: they are printed inside QR codes. */
export const PUBLIC_CARE_PATH = "/care";
export const PUBLIC_REQUEST_PATH = "/request";

/** The only pages a visitor with no sign-in may open besides the sign-in screens. */
export const PUBLIC_FORM_PATHS: readonly string[] = [PUBLIC_CARE_PATH, PUBLIC_REQUEST_PATH];
/** Is this one of the two public pages? The path alone, exactly; a slash at the end is allowed. */
export function isPublicFormPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_FORM_PATHS.includes(p);
}

export interface PublicAddress {
  address: string;
  city: string;
  state: string;
  zip: string;
}

/** A size the visitor picks when they do not know the roof's square feet. */
export type PublicSizeRange = "under_10k" | "10k_25k" | "25k_50k" | "50k_75k" | "over_75k";
export const PUBLIC_SIZE_RANGES: readonly { key: PublicSizeRange; label: string }[] = [
  { key: "under_10k", label: "Under 10,000 sq ft" },
  { key: "10k_25k", label: "10,000 to 25,000 sq ft" },
  { key: "25k_50k", label: "25,000 to 50,000 sq ft" },
  { key: "50k_75k", label: "50,000 to 75,000 sq ft" },
  { key: "over_75k", label: "Over 75,000 sq ft" },
];

export type PublicPlanKey = "watch" | "care" | "guard";

/** What one plan includes, the same shape the sign-up pop-up reads (roof_care_benefits()). */
export interface PublicPlanBenefits {
  allowance: number;
  leak_calls: number;
  storm: number;
}

export interface PublicPlanOffer {
  plan: PublicPlanKey;
  /** "Roof Watch" / "Roof Care" / "Roof Guard". */
  name: string;
  /** The yearly price for this building. Never a cost or a profit. */
  price: number;
  /**
   * Only when a size range was picked and no size typed: the plan's price at the small end of
   * that range and at the large end. `price` is then the middle, which the page does not show.
   */
  price_low?: number;
  price_high?: number;
  benefits: PublicPlanBenefits;
}

/** What the price question answers. */
export interface PublicQuote {
  /** False when neither the address nor its town is on the map: no price is given. */
  found: boolean;
  /** True when the drive is to the town or zip, not the building. */
  rough: boolean;
  /** What the drive is to when it is not the building: "London, KY 40741". */
  place: string | null;
  /** The roof size the prices are for; null when none could be worked out. */
  sqft: number | null;
  /** Where the size came from: the map's outline, what the visitor typed, or the range picked. */
  sqft_source: "map" | "typed" | "range" | null;
  /** True for a roof over the custom quote size, or several buildings: "call us", no prices. */
  custom_quote: boolean;
  /** The three plans with their prices; empty when not found or a custom quote. */
  plans: PublicPlanOffer[];
  /** Opaque. Sent back with the request so the price shown is the price the office sees. */
  quote_token: string;
  /** True on the local test server only: made-up sample numbers, nothing kept. */
  sample?: boolean;
}

export interface PublicQuoteAsk extends PublicAddress {
  /** Square feet when the visitor knows them. */
  sqft?: number | null;
  size_range?: PublicSizeRange | null;
}

/** Who is asking: on both forms. */
export interface PublicContact {
  contact_name: string;
  company: string;
  phone: string;
  email: string;
}

/** The Roof Care request: everything the office needs to make the customer and the plan. */
export interface PublicCareRequest extends PublicContact, PublicAddress {
  building_name: string;
  plan: PublicPlanKey;
  sqft: number | null;
  size_range: PublicSizeRange | null;
  /** The price the page showed for the picked plan. */
  shown_price: number;
  quote_token: string;
  /** How they would like to pay: the office follows up. No card is taken on the page. */
  pay_method: "check" | "card";
  /** The terms were shown and ticked; the name typed as the signature. */
  agreed: true;
  terms_version: string;
  agreed_by: string;
  /** "Who referred you?" Usually a technician, not always. */
  referred_by: string;
  several_buildings: boolean;
  notes: string;
  /** A box no person fills in. Anything in it and the request is dropped quietly. */
  website: string;
  /** Milliseconds the form was open: a robot answers at once. */
  open_ms: number;
}

/** The service request: everything needed to make an opportunity. */
export interface PublicServiceRequest extends PublicContact, PublicAddress {
  building_name: string;
  /** The services ticked, from the office's list. More than one allowed. */
  services: string[];
  details: string;
  referred_by: string;
  website: string;
  open_ms: number;
}

/** What a visitor is told after sending either form. */
export interface PublicSent {
  /** A short reference to quote on the phone: "R-4821". */
  reference: string;
  /** True on the local test server only: nothing was kept. */
  sample?: boolean;
}

/** Said on the local test server only, where nothing is kept. */
export const PUBLIC_SAMPLE_LINE = "Test server: these are sample numbers, and nothing was sent.";

/** Plain words when too many requests come from one place. */
export const PUBLIC_TOO_MANY =
  "Too many requests from this connection. Please wait a few minutes, or call us.";

// ── Added by the data layer (Nov 21) ─────────────────────────────────────────────────────────

/** The middle of each size range, which is what the prices are worked on when one is picked. */
export const PUBLIC_SIZE_RANGE_SQFT: Readonly<Record<PublicSizeRange, number | null>> = {
  under_10k: 7_500,
  "10k_25k": 17_500,
  "25k_50k": 37_500,
  "50k_75k": 62_500,
  // Over the size plans are priced for: a custom quote, never a number.
  over_75k: null,
};

/**
 * The two ends of each size range. A visitor who picks a range and types no size is shown each
 * plan from its price at the small end to its price at the large end (owner, Nov 23: one price
 * on the middle "may give them much smaller idea of what they will pay").
 */
export const PUBLIC_SIZE_RANGE_ENDS: Readonly<
  Record<PublicSizeRange, { low: number; high: number } | null>
> = {
  under_10k: { low: 1, high: 10_000 },
  "10k_25k": { low: 10_000, high: 25_000 },
  "25k_50k": { low: 25_000, high: 50_000 },
  "50k_75k": { low: 50_000, high: 75_000 },
  over_75k: null,
};

/** A form sent sooner than this after it opened was not filled in by a person. */
export const PUBLIC_MIN_OPEN_MS = 3_000;

/** Said when the public pages cannot reach the office's records just now. */
export const PUBLIC_NOT_READY = "This page is not available just now. Please call us.";
/** Said for anything that went wrong on our side: never a database's own words. */
export const PUBLIC_TRY_AGAIN =
  "That did not go through. Please try again in a minute, or call us.";
/** The terms on the page are not the set in use any more. */
export const PUBLIC_TERMS_MOVED =
  "The plan's terms were updated. Reload the page, read them again, then send.";

/**
 * True on the local test server only, where the site has no server key: the public functions
 * then answer with made-up sample numbers and keep nothing, so the pages can be tried. Never
 * true on the published site.
 */
export interface PublicSampleMark {
  sample?: boolean;
}
