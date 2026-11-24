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
  /**
   * True when the building is further than the plans are priced for (Nov 24): a custom quote
   * too, said in its own words, so the visitor can still send their details.
   */
  far?: boolean;
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
/** Said when what arrived is not a form the server can read (a box of the wrong kind). */
export const PUBLIC_CHECK_FORM = "Check the form: one of the boxes is not filled in right.";
/** The terms on the page are not the set in use any more. */
export const PUBLIC_TERMS_MOVED =
  "The plan's terms were updated. Reload the page, read them again, then send.";

// ── Nov 24 (owner: "Go on 4s suggestions"): the limits, in the visitor's words ───────────────

/** One connection has reached its limit for the day. */
export const PUBLIC_TOO_MANY_TODAY =
  "Too many requests from this connection today. Please call us at 606-523-9000.";
/** Everyone together has reached the day's limit: nothing the visitor did. */
export const PUBLIC_BUSY =
  "We are getting a lot of requests right now, so this page is resting until tomorrow. Please call us at 606-523-9000.";
/** The three sentences about a limit that a page shows as they are. */
export const PUBLIC_LIMIT_LINES: readonly string[] = [
  PUBLIC_TOO_MANY,
  PUBLIC_TOO_MANY_TODAY,
  PUBLIC_BUSY,
];
/** The limit sentence inside a failure's words, or null when it is some other failure. */
export const publicLimitLine = (words: string): string | null =>
  PUBLIC_LIMIT_LINES.find((l) => words.includes(l)) ?? null;

// ── Nov 24 (owner: "yes on 5"): the server's own reason, shown to the visitor ───────────────
//
// When the server turns a form down it has an exact reason: "Type the state as two letters,
// like KY.", "The price changed after it was shown...". The pages used to show one general
// line for all of them. They now show the reason itself, but only a sentence on this list:
// the plain sentences the database's two public functions raise for a visitor (public_care_quote
// and public_request_submit; a test reads them out of the migration and fails when one is
// missing here), and the server's own three. Anything else (a fault of ours, a database's
// technical words) still gets the general line.

/** The button on the Roof Care page the price sentences send the visitor back to. */
export const PUBLIC_PRICE_BUTTON = "Show my price";

/** The sentences a visitor is shown as they are. */
export const PUBLIC_REFUSAL_LINES: readonly string[] = [
  // The building and its roof (the price question and both forms).
  "Type the building's street address, city, state and zip.",
  "Type the state as two letters, like KY.",
  "Type the building's five digit zip code.",
  "The roof size did not come through. Please try again.",
  "Type the roof's size in square feet: a number above 0.",
  "The plan prices are not set up yet. Please call us.",
  // Who is asking.
  "The form did not come through. Please try again.",
  "Type your name.",
  "One of the boxes holds more than it can take. Shorten it and send again.",
  "Type a phone number with its area code, or an email address, so we can reach you.",
  "The email address does not look right. Check it, or leave it blank and give a phone number.",
  // The Roof Care sign-up.
  "The prices on the page are no longer current. Press Show my prices again, then send.",
  "The address changed after the prices were shown. Press Show my prices again, then send.",
  "The price changed after it was shown. Press Show my prices again, then send.",
  "Pick one of the three plans.",
  "Say how you would like to pay: by check or by card.",
  "Tick the box to agree to the plan's terms.",
  "The plan's terms did not come through. Reload the page and try again.",
  "Type your full name where it asks who agrees to the terms.",
  // The Request service form.
  "One of the services ticked is not on our list any more. Reload the page and try again.",
  "Tick a service, or tell us what is going on.",
  // The server's own.
  PUBLIC_TERMS_MOVED,
  PUBLIC_NOT_READY,
  PUBLIC_CHECK_FORM,
];

/**
 * The server's reason inside a failure's words, or null when it is not one a visitor is shown.
 * The longest sentence that fits wins. The database says "Show my prices"; the button reads
 * "Show my price", so the sentence is shown with the button's own name.
 */
export function publicRefusalLine(words: string): string | null {
  const hit = PUBLIC_REFUSAL_LINES.filter((l) => words.includes(l)).sort(
    (a, b) => b.length - a.length,
  )[0];
  return hit
    ? hit.replace("Press Show my prices again", `Press ${PUBLIC_PRICE_BUTTON} again`)
    : null;
}

/** What a page says after a failure when the server gave a reason: a limit, or the reason. */
export const publicSayLine = (words: string): string | null =>
  publicLimitLine(words) ?? publicRefusalLine(words);

/** The day's limits for everyone together (public_form_take2 in the database). */
export const PUBLIC_DAY_LIMITS = { quote: 2000, request: 300 } as const;

/** What the count answered when a limit was passed or met: told to the office once. */
export interface PublicLimitAlert {
  kind: "quote" | "request";
  level: "near" | "reached";
  used: number;
  cap: number;
}

// ── Nov 24 (the public pages audit; owner: "Go") ─────────────────────────────────────────────

/** The service request needs one of the two: a box ticked, or a few words. */
export const PUBLIC_NEED_WHAT = "Tick a service, or tell us what is going on.";
/** How a request with no box ticked is filed for the office. */
export const PUBLIC_OTHER_SERVICE = "Other";

/**
 * An email address a link can be made from: letters, digits and . _ % + ' - before the @, a
 * host name after it. Nothing that could add to the link (no ?, &, =, / or space).
 */
export const PUBLIC_EMAIL_PATTERN = /^[A-Za-z0-9._%+'-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;
export const publicEmailOk = (s: string): boolean => PUBLIC_EMAIL_PATTERN.test(s.trim());

/** A character nobody sees: a control character, or one of the two Unicode line separators. */
const unseen = (code: number): boolean =>
  code < 32 || code === 127 || code === 0x2028 || code === 0x2029;
const without = (s: string, keep: (code: number) => boolean): string => {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += unseen(code) && !keep(code) ? " " : ch;
  }
  return out;
};

/**
 * A one-line box as it is kept: no line break, tab or other unseen character, single spaces.
 * A name with a line break in it would otherwise land in a title and in an email's subject.
 */
export const oneLine = (s: string): string =>
  without(s, () => false)
    .replace(/ {2,}/g, " ")
    .trim();
/** A box of several lines as it is kept: its line breaks stay, other unseen characters go. */
export const manyLines = (s: string): string =>
  without(s, (code) => code === 10 || code === 13 || code === 9).trim();

/** Five digits, or nine with the dash: what the price and the request are tied to. */
export const publicZipOk = (s: string): boolean => /^\d{5}(-\d{4})?$/.test(s.trim());
/** Two letters, as on an envelope. */
export const publicStateOk = (s: string): boolean => /^[A-Za-z]{2}$/.test(s.trim());

/**
 * True on the local test server only, where the site has no server key: the public functions
 * then answer with made-up sample numbers and keep nothing, so the pages can be tried. Never
 * true on the published site.
 */
export interface PublicSampleMark {
  sample?: boolean;
}
