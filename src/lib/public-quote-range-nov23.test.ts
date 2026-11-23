/**
 * A size range on the public price page shows a range of prices (owner, Nov 23, after his own
 * try of /care: "how is the range of building size calculating the price? thats a very different
 * price based on what they decide and may give them much smaller idea of what they will pay").
 *
 * A visitor who picked a size range and typed no size was shown one price, worked on the middle
 * of the range, and nothing said which size it was for. He chose: show each plan from its lowest
 * price to its highest for that range, say which size the prices are for, and ask for the exact
 * size. The office reads the same two numbers on the request, and the sign-up it opens starts
 * with a blank size box.
 *
 * Every number here is made up and matches no plan price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  PUBLIC_SIZE_RANGES,
  PUBLIC_SIZE_RANGE_ENDS,
  PUBLIC_SIZE_RANGE_SQFT,
  type PublicQuote,
} from "@/lib/public-forms";
import { quoteFor, sampleQuote, type PublicDeps } from "@/lib/public-forms.functions";
import {
  offerPriceWords,
  offerSpread,
  priceSizeLine,
  quoteAsk,
  sizeRangeWords,
} from "@/lib/public-pages";
import {
  carePrefill,
  carePrefillWords,
  careShownWords,
  shownRange,
  type PublicRequestRow,
} from "@/lib/public-requests";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ASK = { address: "120 Mill St", city: "London", state: "KY", zip: "40741" };
const benefits = { allowance: 0, leak_calls: 0, storm: 0 };

type Args = Record<string, unknown> | undefined;
function deps(plans: unknown[], over: Partial<PublicDeps> = {}) {
  const calls: { fn: string; args: Args }[] = [];
  const admin = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "public_form_take") return { data: true, error: null };
      if (fn === "public_care_quote")
        return { data: { quote_token: "tok-9", custom_quote: false, plans }, error: null };
      return { data: null, error: { message: "no such function", code: "42883" } };
    },
  };
  const d: PublicDeps = {
    admin: admin as never,
    key: "k".repeat(40),
    sample: false,
    drive: async () =>
      ({
        hours: 1,
        miles: 40,
        source: "routed",
        note: "",
        placed_by: "street",
        place: null,
      }) as never,
    mapSize: async () => null,
    tell: async () => undefined,
    ...over,
  };
  return { deps: d, calls };
}
const sent = (calls: { fn: string; args: Args }[]) =>
  calls.find((c) => c.fn === "public_care_quote")!.args!["p"] as Record<string, unknown>;

describe("the two ends of each size range", () => {
  it("every range a price is shown for has its ends around its middle", () => {
    for (const r of PUBLIC_SIZE_RANGES) {
      const ends = PUBLIC_SIZE_RANGE_ENDS[r.key];
      const mid = PUBLIC_SIZE_RANGE_SQFT[r.key];
      if (mid == null) {
        expect(ends).toBeNull();
        continue;
      }
      expect(ends!.low).toBeGreaterThan(0);
      expect(ends!.low).toBeLessThanOrEqual(mid);
      expect(ends!.high).toBeGreaterThanOrEqual(mid);
    }
    expect(PUBLIC_SIZE_RANGE_ENDS["25k_50k"]).toEqual({ low: 25000, high: 50000 });
    expect(PUBLIC_SIZE_RANGE_ENDS.over_75k).toBeNull();
  });
  it("is said in the words on its button", () => {
    expect(sizeRangeWords("25k_50k")).toBe("25,000 to 50,000 sq ft");
    expect(sizeRangeWords("under_10k")).toBe("under 10,000 sq ft");
    expect(sizeRangeWords("over_75k")).toBe("");
    expect(sizeRangeWords(null)).toBe("");
    expect(sizeRangeWords("nonsense")).toBe("");
  });
});

describe("the server asks for the two ends only when a range is all there is", () => {
  it("a range picked, no size typed, no roof on the map: the ends go with the middle", async () => {
    const { deps: d, calls } = deps([
      { plan: "care", name: "Roof Care", price: 3140, price_low: 2410, price_high: 3870, benefits },
    ]);
    const q = await quoteFor({ ...ASK, size_range: "25k_50k" }, d);
    expect(sent(calls)).toMatchObject({
      sqft: 37500,
      sqft_source: "range",
      sqft_low: 25000,
      sqft_high: 50000,
    });
    expect(q.plans).toEqual([
      { plan: "care", name: "Roof Care", price: 3140, price_low: 2410, price_high: 3870, benefits },
    ]);
  });
  it("a typed size is one price: no ends are asked for", async () => {
    const { deps: d, calls } = deps([{ plan: "care", name: "Roof Care", price: 3140, benefits }]);
    const q = await quoteFor({ ...ASK, sqft: 31000, size_range: "25k_50k" }, d);
    expect(sent(calls)).toMatchObject({ sqft: 31000, sqft_source: "typed" });
    expect(sent(calls)).not.toHaveProperty("sqft_low");
    expect(sent(calls)).not.toHaveProperty("sqft_high");
    expect(q.plans[0]).not.toHaveProperty("price_low");
  });
  it("a roof found on the map is one price, even with a range picked", async () => {
    const { deps: d, calls } = deps([{ plan: "care", name: "Roof Care", price: 3140, benefits }], {
      mapSize: async () => 28800,
    });
    await quoteFor({ ...ASK, size_range: "25k_50k" }, d);
    expect(sent(calls)).toMatchObject({ sqft: 28800, sqft_source: "map" });
    expect(sent(calls)).not.toHaveProperty("sqft_low");
  });
  it("ends that do not sit around the price never leave the server", async () => {
    for (const bad of [
      { price_low: 3200, price_high: 3870 }, // low above the price
      { price_low: 2410, price_high: 3000 }, // high below the price
      { price_low: 2410 }, // half a pair
      { price_low: 0, price_high: 3870 },
      { price_low: "abc", price_high: 3870 },
    ]) {
      const { deps: d } = deps([
        { plan: "care", name: "Roof Care", price: 3140, benefits, ...bad },
      ]);
      const q = await quoteFor({ ...ASK, size_range: "25k_50k" }, d);
      expect(q.plans[0]).toEqual({ plan: "care", name: "Roof Care", price: 3140, benefits });
    }
  });
  it("the test server's sample numbers follow the same shape", () => {
    const ranged = sampleQuote({ ...ASK, size_range: "25k_50k" });
    for (const o of ranged.plans) {
      expect(o.price_low!).toBeLessThan(o.price);
      expect(o.price_high!).toBeGreaterThan(o.price);
    }
    const small = sampleQuote({ ...ASK, size_range: "under_10k" });
    for (const o of small.plans) expect([o.price_low, o.price_high]).toEqual([o.price, o.price]);
    const typed = sampleQuote({ ...ASK, sqft: 31000 });
    for (const o of typed.plans) expect(o).not.toHaveProperty("price_low");
  });
});

describe("what a plan's card shows as its price", () => {
  it("a range of sizes is a range of prices, low to high", () => {
    expect(offerPriceWords({ price: 3140, price_low: 2410, price_high: 3870 })).toBe(
      "$2,410 to $3,870",
    );
    expect(offerSpread({ price: 3140, price_low: 2410, price_high: 3870 })).toEqual({
      low: 2410,
      high: 3870,
    });
  });
  it("one price when there is one: typed, measured, or a range that costs the same end to end", () => {
    expect(offerPriceWords({ price: 3140 })).toBe("$3,140");
    expect(offerPriceWords({ price: 1260, price_low: 1260, price_high: 1260 })).toBe("$1,260");
    expect(offerPriceWords({ price: 1260, price_low: 1259.6, price_high: 1260.4 })).toBe("$1,260");
    expect(offerSpread({ price: 3140, price_low: 3300, price_high: 3870 })).toBeNull();
    expect(offerSpread({ price: 3140, price_low: 2410, price_high: null })).toBeNull();
  });
  it("the page shows it on the card and in the line above Send", () => {
    const page = flat(read("src/components/public/care-page.tsx"));
    expect(page).toContain("price={o ? offerPriceWords(o) : null}");
    expect(page).toContain(
      "<b>{offerOf(plan)?.name}</b>: {offerPriceWords(offerOf(plan)!)} per year, an estimate until we measure your roof.",
    );
    expect(page).not.toContain("wholeDollars(o.price)");
  });
});

describe("under the prices, the page says which size they are for", () => {
  const quote = (over: Partial<PublicQuote>): PublicQuote => ({
    found: true,
    rough: false,
    place: null,
    sqft: 37500,
    sqft_source: "range",
    custom_quote: false,
    plans: [{ plan: "care", name: "Roof Care", price: 3140, benefits }],
    quote_token: "tok-9",
    ...over,
  });
  const building = {
    ...ASK,
    building_name: "",
    sqft: "",
    size_range: "25k_50k" as const,
    several_buildings: false,
  };
  it("a range: both ends of the size, why there are two prices, and how to get one", () => {
    const q = quote({
      plans: [
        {
          plan: "care",
          name: "Roof Care",
          price: 3140,
          price_low: 2410,
          price_high: 3870,
          benefits,
        },
      ],
    });
    expect(priceSizeLine(q, quoteAsk(building))).toBe(
      "You picked 25,000 to 50,000 sq ft, so each plan shows its lowest and its highest price for a roof that size. For one price, type your roof's size in step 1 and press Show my price again.",
    );
  });
  it("a range with one price from end to end says the size and no more", () => {
    const q = quote({ sqft: 7500 });
    expect(priceSizeLine(q, quoteAsk({ ...building, size_range: "under_10k" }))).toBe(
      "These prices are for a roof under 10,000 sq ft, the size you picked.",
    );
    expect(priceSizeLine(q, quoteAsk({ ...building, size_range: "10k_25k" }))).toBe(
      "These prices are for a roof of 10,000 to 25,000 sq ft, the size you picked.",
    );
  });
  it("a typed size and a roof found on the map are named as what they are", () => {
    expect(
      priceSizeLine(
        quote({ sqft: 31000, sqft_source: "typed" }),
        quoteAsk({ ...building, sqft: "31,000" }),
      ),
    ).toBe("These prices are for a roof of 31,000 sq ft, the size you typed.");
    expect(priceSizeLine(quote({ sqft: 28812.4, sqft_source: "map" }), quoteAsk(building))).toBe(
      "These prices are for a roof of about 28,812 sq ft, the size we measured from the map at your address.",
    );
  });
  it("says nothing where no price is shown", () => {
    expect(priceSizeLine(null, null)).toBe("");
    expect(priceSizeLine(quote({ found: false, plans: [] }), quoteAsk(building))).toBe("");
    expect(priceSizeLine(quote({ custom_quote: true, plans: [] }), quoteAsk(building))).toBe("");
  });
  it("the page prints it above the estimate line", () => {
    const page = flat(read("src/components/public/care-page.tsx"));
    expect(page).toContain("const sizeLine = priceSizeLine(quote, answer?.ask ?? null);");
    expect(page).toMatch(
      /data-public="price-size"> \{sizeLine\} <\/p> \)\} \{priced && \( <p className="[^"]*">\{PRICE_IS_ESTIMATE\}<\/p>/,
    );
  });
});

describe("the office reads the same two prices on the request", () => {
  const row = (over: Partial<PublicRequestRow> = {}): PublicRequestRow => ({
    id: "0b6a3c1e-1111-4222-8333-444455556666",
    reference: "R-4010",
    kind: "care",
    created_at: "2026-11-23T15:00:00Z",
    status: "new",
    contact_name: "Pat Smith",
    company: "",
    phone: "606-555-0142",
    email: "pat@example.com",
    address: "120 Mill St",
    city: "London",
    state: "KY",
    zip: "40741",
    building_name: "",
    referred_by: "",
    plan: "care",
    sqft: 37500,
    size_range: "25k_50k",
    sqft_source: "range",
    shown_price: 3140,
    quote: {
      found: true,
      rough: false,
      place: null,
      custom_quote: false,
      plans: [
        { plan: "watch", price: 2020, price_low: 1610, price_high: 2430 },
        { plan: "care", price: 3140, price_low: 2410, price_high: 3870 },
      ],
    },
    pay_method: "check",
    terms_version: "2026-11-20.1",
    agreed_by: "Pat Smith",
    several_buildings: false,
    notes: "",
    services: [],
    details: "",
    handled_at: null,
    handled_by_name: null,
    dismiss_reason: null,
    account_id: null,
    site_id: null,
    opportunity_id: null,
    roof_care_plan_id: null,
    ...over,
  });
  it("a range request: low to high for the plan they picked, and that no size was typed", () => {
    expect(shownRange(row())).toEqual({ low: 2410, high: 3870 });
    expect(careShownWords(row())).toBe(
      ", shown $2,410 to $3,870 a year, for the size range they picked (25,000 to 50,000 sq ft). They typed no roof size.",
    );
    // Never the middle of the range as if it were the roof's size.
    expect(careShownWords(row())).not.toContain("37,500");
  });
  it("a range request from before this change still reads true: one price, for a range", () => {
    const old = row({ quote: { found: true, custom_quote: false } });
    expect(shownRange(old)).toBeNull();
    expect(careShownWords(old)).toBe(
      ", shown $3,140 a year, for the size range they picked (25,000 to 50,000 sq ft). They typed no roof size.",
    );
  });
  it("a typed size and a map size read as before", () => {
    expect(careShownWords(row({ sqft: 31000, sqft_source: "typed", size_range: null }))).toBe(
      ", shown $3,140 a year, for 31,000 sq ft, typed by them.",
    );
    expect(careShownWords(row({ sqft: 28812, sqft_source: "map" }))).toBe(
      ", shown $3,140 a year, for 28,812 sq ft, from the map.",
    );
    expect(shownRange(row({ sqft_source: "typed" }))).toBeNull();
  });
  it("the strip on the opportunity prints those words", () => {
    const strip = flat(read("src/components/opportunity-request-strip.tsx"));
    expect(strip).toContain("<span data-request-shown>{careShownWords(r)}</span>");
    expect(strip).not.toContain("the middle of the size range they picked");
  });
  it("the sign-up it opens starts with a blank size box and says why", () => {
    const p = carePrefill(row())!;
    expect(p.sqft).toBeNull();
    expect(p.picked_range).toEqual({ size: "25,000 to 50,000 sq ft", low: 2410, high: 3870 });
    expect(carePrefillWords(p, "2026-11-20.1")).toBe(
      "From the public Roof Care page, request R-4010. They typed no roof size and picked 25,000 to 50,000 sq ft, so the page showed them $2,410 to $3,870 a year. They ticked these terms there, so the tick is already on. The roof size box is blank: type the roof's real size, press Show my price and choose when the first inspection is.",
    );
    // One price for the whole range: still no size in the box.
    const small = carePrefill(
      row({ size_range: "under_10k", sqft: 7500, shown_price: 1260, quote: { found: true } }),
    )!;
    expect(small.sqft).toBeNull();
    expect(carePrefillWords(small, "2026-11-20.1")).toBe(
      "From the public Roof Care page, request R-4010. The page showed them $1,260 a year. They typed no roof size and picked under 10,000 sq ft. They ticked these terms there, so the tick is already on. The roof size box is blank: type the roof's real size, press Show my price and choose when the first inspection is.",
    );
    // A size they typed is still handed over.
    const typed = carePrefill(row({ sqft: 31000, sqft_source: "typed", size_range: null }))!;
    expect(typed.sqft).toBe(31000);
    expect(typed).not.toHaveProperty("picked_range");
  });
});

describe("the database prices the two ends", () => {
  const sql = flat(read("supabase/migrations/20261124500000_public_quote_range_prices.sql"));
  it("reads the ends only for a range, and drops ends that do not sit around the size", () => {
    expect(sql).toContain("if v_source = 'range' then");
    expect(sql).toContain("v_low := nullif(p->>'sqft_low', '')::numeric;");
    expect(sql).toContain(
      "or v_low <= 0 or v_low > v_sqft or v_high < v_sqft or v_high > 100000000 then v_low := null; v_high := null;",
    );
  });
  it("gives no ends when either end is a custom quote, and only a pair around the price", () => {
    expect(sql).toContain(
      "or coalesce((v_lo->>'custom_quote')::boolean, false) or coalesce((v_hi->>'custom_quote')::boolean, false) then v_lo := null; v_hi := null;",
    );
    expect(sql).toContain(
      "case when v_pl is not null and v_ph is not null and v_pl <= v_price and v_ph >= v_price then jsonb_build_object('price_low', v_pl, 'price_high', v_ph) else '{}'::jsonb end",
    );
  });
  it("keeps the one price a request is proved against, and stays the server's alone", () => {
    expect(sql).toContain("'price', (r->>'price')::numeric,");
    expect(sql).toContain(
      "revoke all on function public.public_care_quote(text, jsonb, numeric, numeric) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.public_care_quote(text, jsonb, numeric, numeric) to service_role;",
    );
  });
});
