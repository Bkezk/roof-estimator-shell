/**
 * The two public pages' server functions (Roof Care step 4; owner, Nov 18 and Nov 20): what a
 * visitor with NO sign-in can ask of the site. Four things, and nothing else:
 *
 *   publicRoofCareQuote    the three yearly prices for one building
 *   submitRoofCareRequest  "sign me up for this plan": held for the office
 *   publicServiceChoices   the services on the request form
 *   submitServiceRequest   "my roof needs this": held for the office
 *
 * How it is kept safe:
 *  - The database is reached with the site's own key only, as the two share links do. Nothing
 *    is granted to the anonymous role, so a stranger holding the page's public key can call no
 *    database function and read no table.
 *  - Every answer is prices and plain words. Never a cost, a margin, a drive, an id of ours, or
 *    anything about who is already a customer.
 *  - Each connection, and everyone together, is limited (public_form_take in the database).
 *  - Everything typed is checked here and again in the database, and kept as plain text.
 *  - A robot (the hidden box filled, or a form sent at once) is answered as if it worked and
 *    nothing is kept.
 *
 * On the local test server there is no server key: the functions then answer with made-up
 * sample numbers marked `sample`, and keep nothing, so the pages can be tried.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import type { Client } from "@/lib/notify.server";
import {
  manyLines,
  oneLine,
  publicEmailOk,
  publicStateOk,
  publicZipOk,
  PUBLIC_BUSY,
  PUBLIC_MIN_OPEN_MS,
  PUBLIC_NEED_WHAT,
  PUBLIC_CHECK_FORM,
  PUBLIC_NOT_READY,
  PUBLIC_SIZE_RANGE_ENDS,
  PUBLIC_SIZE_RANGE_SQFT,
  PUBLIC_TERMS_MOVED,
  PUBLIC_TOO_MANY,
  PUBLIC_TOO_MANY_TODAY,
  PUBLIC_TRY_AGAIN,
  type PublicCareRequest,
  type PublicLimitAlert,
  type PublicPlanOffer,
  type PublicQuote,
  type PublicQuoteAsk,
  type PublicSent,
  type PublicServiceRequest,
} from "@/lib/public-forms";
import { placedRoughly } from "@/lib/roof-care-locate";
import { mapRoofSize, ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";
import type { RoofCareDrive } from "@/lib/roof-care.functions";

// Nov 24 (the public pages audit): every one-line box is kept as one line, with no line break,
// tab or other unseen character in it (public-forms.ts oneLine).
const short = (max: number) => z.string().trim().max(max).transform(oneLine);
const long = (max: number) => z.string().trim().max(max).transform(manyLines);

export const PUBLIC_NEED_STATE = "Type the state as two letters, like KY.";
export const PUBLIC_NEED_ZIP = "Type the building's five digit zip code.";
export const PUBLIC_EMAIL_WRONG =
  "The email address does not look right. Check it, or leave it blank and give a phone number.";

// Nov 24: the city, the state and the zip are asked for here too, not only on the page. A
// price belongs to one building: its street, its city, its state and its zip.
const addressShape = {
  address: z
    .string()
    .trim()
    .min(3, "Type the building's street address.")
    .max(200)
    .transform(oneLine),
  city: z.string().trim().min(1, "Type the building's city.").max(120).transform(oneLine),
  state: z
    .string()
    .trim()
    .max(40)
    .refine(publicStateOk, PUBLIC_NEED_STATE)
    .transform((s) => s.toUpperCase()),
  zip: z.string().trim().max(12).refine(publicZipOk, PUBLIC_NEED_ZIP),
};
const sizeRange = z.enum(["under_10k", "10k_25k", "25k_50k", "50k_75k", "over_75k"]);
const sqft = z.number().finite().positive().max(100_000_000);

export const quoteAskSchema = z.object({
  ...addressShape,
  sqft: sqft.nullable().optional(),
  size_range: sizeRange.nullable().optional(),
});

const contactShape = {
  contact_name: z.string().trim().min(2, "Type your name.").max(120).transform(oneLine),
  company: short(160).default(""),
  phone: short(40).default(""),
  email: short(200).default(""),
  building_name: short(160).default(""),
  referred_by: short(160).default(""),
  // The hidden box and the time the form was open: read, never trusted.
  website: z.string().max(400).default(""),
  open_ms: z.number().finite().default(0),
};

export const careRequestSchema = z.object({
  ...addressShape,
  ...contactShape,
  plan: z.enum(["watch", "care", "guard"]),
  sqft: sqft.nullable().optional(),
  size_range: sizeRange.nullable().optional(),
  shown_price: z.number().finite().min(0).max(100_000_000),
  quote_token: z.string().trim().min(1).max(80),
  pay_method: z.enum(["check", "card"]),
  agreed: z.boolean().refine((v) => v === true, "Tick the box to agree to the plan's terms."),
  terms_version: short(40),
  agreed_by: z
    .string()
    .trim()
    .min(2, "Type your full name to agree to the terms.")
    .max(120)
    .transform(oneLine),
  several_buildings: z.boolean().default(false),
  notes: long(2000).default(""),
});

export const serviceRequestSchema = z.object({
  ...addressShape,
  ...contactShape,
  // Nov 24: no box ticked is fine when a few words say what is going on. The page always let
  // that through, and the server refused it, so the visitor was told "try again" for ever.
  services: z.array(short(80)).max(40).default([]),
  details: long(2000).default(""),
});

/** The first problem as one plain sentence; never a list of what a program expected. */
function parsePlain<T>(schema: z.ZodType<T>, d: unknown): T {
  const r = schema.safeParse(d);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const custom = first && !/^(Invalid|Expected|Required|Too|String|Number)/i.test(first.message);
  throw new Error(custom && first ? first.message : PUBLIC_CHECK_FORM);
}

/** A phone number with its area code, or an email address. */
export function reachable(phone: string, email: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return (digits.length >= 10 && digits.length <= 15) || publicEmailOk(email);
}
export const PUBLIC_NEED_CONTACT =
  "Type a phone number with its area code, or an email address, so we can reach you.";

/** A form no person filled in: the hidden box holds something, or it was sent at once. */
export const looksLikeRobot = (d: { website: string; open_ms: number }): boolean =>
  d.website.trim() !== "" || !(d.open_ms >= PUBLIC_MIN_OPEN_MS);

/**
 * What a robot is told: a reference that looks real. Nothing was kept. Three digits, which a
 * real reference never has (they start at R-4001), so one quoted on the phone cannot be taken
 * for another person's request.
 */
const pretendSent = (): PublicSent => ({
  reference: `R-${100 + Math.floor(Math.random() * 900)}`,
});

/** What the functions are given: the site's own client, and who is asking. */
export interface PublicDeps {
  /** Null on the local test server. */
  admin: Client | null;
  /** The connection's key (public-forms.server.ts connectionKey). */
  key: string;
  /** True on the local test server only. */
  sample: boolean;
  /** The round trip from the office to an address; null when it cannot be placed. */
  drive: (admin: Client, a: PublicQuoteAsk) => Promise<RoofCareDrive | null>;
  /** The roof size our map shows at an address; null when it shows none. */
  mapSize: (admin: Client, a: PublicQuoteAsk) => Promise<number | null>;
  /** Tells the office about requests nobody was told of. Best effort. */
  tell: (admin: Client) => Promise<unknown>;
  /** Tells the office a day's limit is nearly reached, or reached. Best effort. */
  limitAlert?: (admin: Client, alert: PublicLimitAlert) => Promise<unknown>;
}

type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpcOf =
  (admin: Client): Rpc =>
  (fn, args) =>
    (admin as unknown as { rpc: Rpc }).rpc(fn, args);

/**
 * A database refusal as words for the visitor. The public functions in the database raise
 * their own plain sentences under two codes; anything else (a fault of ours) is never shown.
 */
function plainRefusal(error: { message: string; code?: string }): Error {
  if (visitorCanFix(error)) return new Error(error.message);
  console.error("Public form: the database refused —", error.code ?? "", error.message);
  return new Error(PUBLIC_TRY_AGAIN);
}

/** A refusal in words written for the visitor: something they typed, or a price that moved. */
export const visitorCanFix = (error: { code?: string }): boolean =>
  error.code === "22023" || error.code === "P0001";

/**
 * A request the database turned down for a reason the visitor can fix is not counted against
 * them (Nov 26; the audit of Nov 25). It was counted before it was checked, so someone putting
 * right "the price changed" or "the address changed after the prices" used up their five an
 * hour and was told to call. The count is given back to this connection's own hour and day
 * (public_form_give_back), at most 20 times a day; after that a refusal counts as before. The
 * day's count for everyone is not given back. Best effort: the visitor is told the same reason
 * whether or not the count went back.
 */
async function giveBack(
  deps: PublicDeps & { admin: Client },
  error: { message: string; code?: string },
): Promise<void> {
  if (!visitorCanFix(error)) return;
  try {
    const back = await rpcOf(deps.admin)("public_form_give_back", {
      p_kind: "request",
      p_key: deps.key,
    });
    if (back.error)
      console.error("Public form: a refused request was not given back —", back.error.message);
  } catch (e) {
    console.error("Public form: a refused request was not given back —", e);
  }
}

/**
 * A form dropped as a robot's is counted (Nov 24), so the office can see whether it ever
 * happens: a browser that fills the hidden box by itself would drop a real person's request.
 * Best effort: the answer to the sender is the same whether or not the count was kept.
 */
async function countDropped(deps: PublicDeps): Promise<void> {
  if (!deps.admin) return;
  try {
    const { error } = await rpcOf(deps.admin)("public_form_dropped", { p_key: deps.key });
    if (error) console.error("Public form: a dropped form was not counted —", error.message);
  } catch (e) {
    console.error("Public form: a dropped form was not counted —", e);
  }
}

/**
 * Counts this call against the limits and refuses it in the visitor's words when one is met
 * (Nov 24; public_form_take2). The count answers which limit it was: this connection's hour,
 * this connection's day, or the day's count for everyone. When this call is the one that takes
 * the day's count past four fifths, or to its end, the office is told, once.
 */
async function withinLimit(deps: PublicDeps & { admin: Client }, kind: "quote" | "request") {
  const { data, error } = await rpcOf(deps.admin)("public_form_take2", {
    p_kind: kind,
    p_key: deps.key,
  });
  if (error) {
    console.error("Public form: the limit could not be read —", error.message);
    throw new Error(PUBLIC_TRY_AGAIN);
  }
  const o = (data ?? {}) as Record<string, unknown>;
  if (o["ok"] !== true) {
    const why = o["why"];
    throw new Error(
      why === "all" ? PUBLIC_BUSY : why === "one_day" ? PUBLIC_TOO_MANY_TODAY : PUBLIC_TOO_MANY,
    );
  }
  const level = o["alert"];
  if ((level === "near" || level === "reached") && deps.limitAlert) {
    const alert: PublicLimitAlert = {
      kind,
      level,
      used: Number(o["used"]) || 0,
      cap: Number(o["cap"]) || 0,
    };
    await deps
      .limitAlert(deps.admin, alert)
      .catch((e) => console.error("Public form: the office was not told of the limit —", e));
  }
}

/** Made-up numbers for the local test server. They match no real price. */
export function sampleQuote(ask: PublicQuoteAsk): PublicQuote {
  const custom = ask.size_range === "over_75k";
  const size = ask.sqft ?? (ask.size_range ? PUBLIC_SIZE_RANGE_SQFT[ask.size_range] : null);
  // A range picked with no size typed: a low and a high price, as the real answer gives. The
  // smallest range has one price from end to end, as it does on the real prices.
  const ranged = ask.sqft == null && !!ask.size_range && !custom;
  const spread = (price: number): Partial<PublicPlanOffer> =>
    !ranged
      ? {}
      : ask.size_range === "under_10k"
        ? { price_low: price, price_high: price }
        : { price_low: Math.round(price * 0.8), price_high: Math.round(price * 1.2) };
  const base: PublicPlanOffer[] =
    custom || size == null
      ? []
      : [
          {
            plan: "watch",
            name: "Roof Watch",
            price: 1111,
            benefits: { allowance: 0, leak_calls: 0, storm: 0 },
          },
          {
            plan: "care",
            name: "Roof Care",
            price: 2222,
            benefits: { allowance: 444, leak_calls: 0, storm: 0 },
          },
          {
            plan: "guard",
            name: "Roof Guard",
            price: 3333,
            benefits: { allowance: 1333, leak_calls: 2, storm: 1 },
          },
        ];
  const plans: PublicPlanOffer[] = base.map((o) => ({ ...o, ...spread(o.price) }));
  return {
    found: true,
    rough: false,
    place: null,
    sqft: custom ? null : size,
    sqft_source: custom || size == null ? null : ask.sqft != null ? "typed" : "range",
    custom_quote: custom,
    plans,
    quote_token: "sample",
    sample: true,
  };
}

function readOffers(x: unknown): PublicPlanOffer[] {
  if (!Array.isArray(x)) return [];
  const out: PublicPlanOffer[] = [];
  for (const raw of x) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const b = (r["benefits"] ?? {}) as Record<string, unknown>;
    const plan = r["plan"];
    const price = Number(r["price"]);
    if ((plan !== "watch" && plan !== "care" && plan !== "guard") || !Number.isFinite(price))
      continue;
    // The two ends of a picked size range: kept only as a pair that sits around the price.
    const low = r["price_low"] == null ? NaN : Number(r["price_low"]);
    const high = r["price_high"] == null ? NaN : Number(r["price_high"]);
    const ends =
      Number.isFinite(low) && Number.isFinite(high) && low > 0 && low <= price && high >= price
        ? { price_low: low, price_high: high }
        : {};
    // Only these fields leave the server, whatever the database answered.
    out.push({
      plan,
      name: typeof r["name"] === "string" ? r["name"] : plan,
      price,
      ...ends,
      benefits: {
        allowance: Number(b["allowance"]) || 0,
        leak_calls: Number(b["leak_calls"]) || 0,
        storm: Number(b["storm"]) || 0,
      },
    });
  }
  return out;
}

/** The three yearly prices for one building. */
export async function quoteFor(askIn: unknown, deps: PublicDeps): Promise<PublicQuote> {
  const ask = parsePlain(quoteAskSchema, askIn) as PublicQuoteAsk;
  if (!deps.admin) {
    if (deps.sample) return sampleQuote(ask);
    throw new Error(PUBLIC_NOT_READY);
  }
  const admin = deps.admin;
  await withinLimit({ ...deps, admin }, "quote");

  let drive: RoofCareDrive | null;
  let mapSqft: number | null;
  try {
    [drive, mapSqft] = await Promise.all([
      deps.drive(admin, ask),
      deps.mapSize(admin, ask).catch(() => null),
    ]);
  } catch (e) {
    console.error("Public quote: the drive could not be worked out —", e);
    throw new Error(PUBLIC_TRY_AGAIN);
  }
  const over = ask.size_range === "over_75k";
  // The map's outline first, then what the visitor typed, then the middle of the range picked.
  const typed = ask.sqft ?? null;
  const ranged = ask.size_range ? PUBLIC_SIZE_RANGE_SQFT[ask.size_range] : null;
  const size = over ? null : (mapSqft ?? typed ?? ranged);
  const source = size == null ? null : mapSqft != null ? "map" : typed != null ? "typed" : "range";
  // With only a range to go on, its two ends are priced too: the page shows low to high.
  const ends = source === "range" && ask.size_range ? PUBLIC_SIZE_RANGE_ENDS[ask.size_range] : null;
  const found = !!drive;
  const rough = drive ? placedRoughly(drive.placed_by) : false;
  const place = drive?.place ?? null;

  const { data, error } = await rpcOf(admin)("public_care_quote", {
    p_key: deps.key,
    p: {
      address: ask.address,
      city: ask.city,
      state: ask.state,
      zip: ask.zip,
      found,
      rough,
      place,
      sqft: size,
      sqft_source: source,
      ...(ends ? { sqft_low: ends.low, sqft_high: ends.high } : {}),
    } as unknown as Json,
    p_hours: drive?.hours ?? null,
    p_miles: drive?.miles ?? null,
  });
  if (error) throw plainRefusal(error);
  const o = (data ?? {}) as Record<string, unknown>;
  const token = typeof o["quote_token"] === "string" ? o["quote_token"] : "";
  if (!token) throw new Error(PUBLIC_TRY_AGAIN);
  // Nov 24: a building further than the plans are priced for is a custom quote too, said in
  // its own words. It used to come back as a refusal written for the office.
  const far = found && o["far"] === true;
  const custom = over || far || o["custom_quote"] === true;
  return {
    found,
    rough,
    place,
    sqft: size,
    sqft_source: source,
    custom_quote: custom,
    ...(far ? { far: true } : {}),
    plans: custom || !found ? [] : readOffers(o["plans"]),
    quote_token: token,
  };
}

/** "Sign me up for this plan": checked, kept for the office, and the office told. */
export async function sendCare(dataIn: unknown, deps: PublicDeps): Promise<PublicSent> {
  const d = parsePlain(careRequestSchema, dataIn) as PublicCareRequest;
  if (looksLikeRobot(d)) {
    await countDropped(deps);
    return pretendSent();
  }
  if (!reachable(d.phone, d.email)) throw new Error(PUBLIC_NEED_CONTACT);
  if (d.email && !publicEmailOk(d.email)) throw new Error(PUBLIC_EMAIL_WRONG);
  if (d.terms_version !== ROOF_CARE_TERMS_VERSION) throw new Error(PUBLIC_TERMS_MOVED);
  if (!deps.admin) {
    if (deps.sample) return { reference: "R-0000", sample: true };
    throw new Error(PUBLIC_NOT_READY);
  }
  await withinLimit({ ...deps, admin: deps.admin }, "request");
  const { website: _w, open_ms: _o, ...kept } = d;
  const { data, error } = await rpcOf(deps.admin)("public_request_submit", {
    p_key: deps.key,
    p: { kind: "care", ...kept } as unknown as Json,
  });
  if (error) {
    await giveBack({ ...deps, admin: deps.admin }, error);
    throw plainRefusal(error);
  }
  if (typeof data !== "string" || !data) throw new Error(PUBLIC_TRY_AGAIN);
  await deps
    .tell(deps.admin)
    .catch((e) => console.error("Public request: the office was not told —", e));
  return { reference: data };
}

/** "My roof needs this": checked, kept for the office, and the office told. */
export async function sendService(dataIn: unknown, deps: PublicDeps): Promise<PublicSent> {
  const d = parsePlain(serviceRequestSchema, dataIn) as PublicServiceRequest;
  if (looksLikeRobot(d)) {
    await countDropped(deps);
    return pretendSent();
  }
  if (d.services.length === 0 && !d.details) throw new Error(PUBLIC_NEED_WHAT);
  if (!reachable(d.phone, d.email)) throw new Error(PUBLIC_NEED_CONTACT);
  if (d.email && !publicEmailOk(d.email)) throw new Error(PUBLIC_EMAIL_WRONG);
  if (!deps.admin) {
    if (deps.sample) return { reference: "R-0000", sample: true };
    throw new Error(PUBLIC_NOT_READY);
  }
  await withinLimit({ ...deps, admin: deps.admin }, "request");
  const { website: _w, open_ms: _o, ...kept } = d;
  const { data, error } = await rpcOf(deps.admin)("public_request_submit", {
    p_key: deps.key,
    p: { kind: "service", ...kept } as unknown as Json,
  });
  if (error) {
    await giveBack({ ...deps, admin: deps.admin }, error);
    throw plainRefusal(error);
  }
  if (typeof data !== "string" || !data) throw new Error(PUBLIC_TRY_AGAIN);
  await deps
    .tell(deps.admin)
    .catch((e) => console.error("Public request: the office was not told —", e));
  return { reference: data };
}

/** Made-up services for the local test server. */
export const SAMPLE_SERVICES = ["Roof leak or repair", "Roof inspection", "Something else"];

export async function serviceChoices(deps: PublicDeps): Promise<{ services: string[] }> {
  if (!deps.admin) {
    if (deps.sample) return { services: SAMPLE_SERVICES };
    throw new Error(PUBLIC_NOT_READY);
  }
  const { data, error } = await rpcOf(deps.admin)("public_service_choices");
  if (error) {
    console.error("Public form: the services could not be read —", error.message);
    throw new Error(PUBLIC_TRY_AGAIN);
  }
  return {
    services: Array.isArray(data) ? data.filter((s): s is string => typeof s === "string") : [],
  };
}

/** How long the price question waits for the map's outline before going on without it. */
export const PUBLIC_MAP_WAIT_MS = 8_000;

/** The real doors, made from the request that came in. SERVER ONLY. */
async function realDeps(): Promise<PublicDeps> {
  const [{ getRequest }, server, care, aerial] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/lib/public-forms.server"),
    import("@/lib/roof-care.functions"),
    import("@/lib/service-aerial.functions"),
  ]);
  return {
    admin: await server.publicAdmin(),
    key: server.connectionKey(getRequest().headers),
    sample: server.publicSampleMode(),
    drive: async (admin, a) => care.driveTo(admin, await care.officeOrigin(admin), a),
    mapSize: async (admin, a) => {
      const line = care.addressLine(a);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const found = await Promise.race([
          aerial.aerialForAddress(admin, line, { stateHint: a.state || null }),
          new Promise<null>((done) => {
            timer = setTimeout(() => done(null), PUBLIC_MAP_WAIT_MS);
          }),
        ]);
        const size = found ? mapRoofSize(found.found, found.note) : null;
        // Only an outline found by the address itself: one found by a name is a guess.
        return size?.sure ? size.sqft : null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    tell: (admin) => server.dispatchPublicRequestNotices(admin),
    limitAlert: (admin, alert) => server.tellPublicLimit(admin, alert),
  };
}

export const publicRoofCareQuote = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }): Promise<PublicQuote> => quoteFor(data, await realDeps()));

export const submitRoofCareRequest = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }): Promise<PublicSent> => sendCare(data, await realDeps()));

export const submitServiceRequest = createServerFn({ method: "POST" })
  .validator((d: unknown) => d)
  .handler(async ({ data }): Promise<PublicSent> => sendService(data, await realDeps()));

export const publicServiceChoices = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ services: string[] }> => serviceChoices(await realDeps()),
);
