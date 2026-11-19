/**
 * Roof Care: a floor under the price (owner, Nov 19; docs/roof-care-plans.md).
 *
 * The owner's words: "lets make it to where the minimum roof size pricing is always priced at …
 * sq feet so its never not profitable, thats the floor similarly to where drive time is minimum
 * of 2 hrs no matter what".
 *
 * Before this a small roof paid for its own size, and the fixed work of two inspections cost
 * more than the price brought in. Now a roof under the floor pays the price of the floor size.
 *
 * THE NUMBERS HERE ARE MADE UP. The office's floor and prices are in the database and nowhere in
 * this repository; the database's prices were held against this engine's on the office's own
 * numbers outside the repository (docs/qa/roof-care-floor-2026-11-19.md).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { draftFrom, SETTING_KEYS, settingsFromDraft } from "@/lib/roof-care-form";
import {
  asRoofCareSettings,
  emptyRoofCareSettings,
  pricedSqft,
  roofCareQuote,
  roofCareSettingsSchema,
  SETTING_LABELS,
  settingsProblems,
  type RoofCareSettings,
} from "@/lib/roof-care-price";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

/** Made up. The floor is 12,000 sq ft; the list price covers a 1 hour, 40 mile round trip. */
const S = (over: Partial<RoofCareSettings> = {}): RoofCareSettings => ({
  crew_cost_per_hour: 30,
  crew_size: 3,
  baseline_drive_hours: 1,
  baseline_miles: 40,
  vehicle_cost_per_mile: 0.5,
  report_cost_per_visit: 20,
  repair_cost_pct: 40,
  allowance_used_pct: 50,
  guard_leak_calls: 2,
  guard_hours_per_leak_call: 1,
  guard_storm_inspections: 1,
  guard_forecast_cost: 30,
  custom_quote_over_sqft: 60_000,
  min_price_sqft: 12_000,
  plans: {
    watch: { base: 500, per_sqft: 0.02, allowance: null },
    care: { base: 800, per_sqft: 0.05, allowance: 400 },
    guard: { base: 1500, per_sqft: 0.08, allowance: 1000 },
  },
  hours: [
    { sqft: 10_000, inspection: 1, drains: 1, gutters: 0.5 },
    { sqft: 30_000, inspection: 3, drains: 2, gutters: 1.5 },
  ],
  ...over,
});
const quote = (s: RoofCareSettings, sqft: number, drive?: { hours: number; miles: number }) => {
  const r = roofCareQuote(s, drive ? { sqft, drive } : { sqft });
  if (!r.quote) throw new Error(`no quote: ${r.problems.join("; ")}`);
  return r.quote;
};
const prices = (q: ReturnType<typeof quote>) =>
  Object.fromEntries(q.plans.map((p) => [p.plan, p.price]));

describe("the size the price is worked for", () => {
  it("is the roof's own, and never under the floor", () => {
    expect(pricedSqft({ min_price_sqft: 12_000 }, 3_000)).toBe(12_000);
    expect(pricedSqft({ min_price_sqft: 12_000 }, 11_999)).toBe(12_000);
    expect(pricedSqft({ min_price_sqft: 12_000 }, 12_000)).toBe(12_000);
    expect(pricedSqft({ min_price_sqft: 12_000 }, 12_001)).toBe(12_001);
    expect(pricedSqft({ min_price_sqft: 12_000 }, 40_000)).toBe(40_000);
  });

  it("is the roof's own when no floor is typed, or 0", () => {
    expect(pricedSqft({ min_price_sqft: null }, 3_000)).toBe(3_000);
    expect(pricedSqft({ min_price_sqft: 0 }, 3_000)).toBe(3_000);
  });
});

describe("the price of a small roof", () => {
  it("is the price of the floor size, on all three plans", () => {
    // 500 + 0.02 x 12,000 = 740; 800 + 0.05 x 12,000 = 1,400; 1,500 + 0.08 x 12,000 = 2,460.
    const atFloor = { watch: 740, care: 1400, guard: 2460 };
    expect(prices(quote(S(), 12_000))).toEqual(atFloor);
    for (const sqft of [1, 500, 3_000, 9_999, 11_999])
      expect(prices(quote(S(), sqft)), `${sqft} sq ft`).toEqual(atFloor);
  });

  it("was its own size's price before, which is what no floor still gives", () => {
    // 500 + 0.02 x 3,000 = 560; 800 + 0.05 x 3,000 = 950; 1,500 + 0.08 x 3,000 = 1,740.
    expect(prices(quote(S({ min_price_sqft: null }), 3_000))).toEqual({
      watch: 560,
      care: 950,
      guard: 1740,
    });
  });

  it("is split into two halves of the floor price", () => {
    const care = quote(S(), 3_000).plans.find((p) => p.plan === "care")!;
    expect(care.per_visit).toEqual([700, 700]);
  });

  it("still pays for a long drive on top of the floor price", () => {
    const far = { hours: 3, miles: 140 };
    const small = quote(S(), 3_000, far);
    const floor = quote(S(), 12_000, far);
    expect(prices(small)).toEqual(prices(floor));
    for (const p of small.plans) {
      expect(p.travel, p.plan).toBeGreaterThan(0);
      expect(p.price, p.plan).toBe(p.list + p.travel);
    }
  });
});

describe("a roof at the floor or over it", () => {
  it("is priced as it was", () => {
    for (const sqft of [12_000, 12_001, 20_000, 45_000, 60_000])
      expect(prices(quote(S(), sqft)), `${sqft} sq ft`).toEqual(
        prices(quote(S({ min_price_sqft: null }), sqft)),
      );
  });

  it("still gets a custom quote over the size for one", () => {
    expect(quote(S(), 60_001).custom_quote).toBe(true);
    expect(quote(S(), 60_001).plans).toEqual([]);
  });
});

describe("what a small roof costs and earns", () => {
  it("costs what the real roof costs, not what the floor size would", () => {
    const withFloor = quote(S(), 3_000);
    const without = quote(S({ min_price_sqft: null }), 3_000);
    for (const p of withFloor.plans) {
      const before = without.plans.find((x) => x.plan === p.plan)!;
      expect(p.cost, p.plan).toBe(before.cost);
      expect(p.profit, p.plan).toBe(p.price - p.cost);
      // The whole of the floor's difference in price is profit.
      expect(p.profit - before.profit, p.plan).toBe(p.price - before.price);
      expect(p.profit, p.plan).toBeGreaterThan(before.profit);
    }
  });
});

describe("the floor on the price setup page", () => {
  it("has a box of its own, with plain words", () => {
    expect(SETTING_LABELS.min_price_sqft).toBe("Smallest roof the price is worked for (sq ft)");
    expect(SETTING_KEYS).toContain("min_price_sqft");
    const page = flat("src/components/roof-care-settings.tsx");
    // (Nov 19, night: the card fee's two boxes follow it.)
    expect(page).toContain(
      '"custom_quote_over_sqft", "min_price_sqft", "card_fee_pct", "card_fee_flat", ]',
    );
  });

  it("starts blank, and blank is not a problem: it means no floor", () => {
    expect(emptyRoofCareSettings().min_price_sqft).toBeNull();
    expect(draftFrom(emptyRoofCareSettings()).values.min_price_sqft).toBe("");
    expect(settingsProblems(S({ min_price_sqft: null }))).toEqual([]);
    expect(roofCareQuote(S({ min_price_sqft: null }), { sqft: 3_000 }).quote).not.toBeNull();
  });

  it("goes to the boxes and back unchanged", () => {
    const d = draftFrom(S());
    expect(d.values.min_price_sqft).toBe("12000");
    const back = settingsFromDraft(d);
    expect(back.problems).toEqual([]);
    expect(back.settings.min_price_sqft).toBe(12_000);
    d.values.min_price_sqft = "";
    expect(settingsFromDraft(d).settings.min_price_sqft).toBeNull();
    d.values.min_price_sqft = "twelve";
    expect(settingsFromDraft(d).problems.join(" ")).toContain(SETTING_LABELS.min_price_sqft);
  });

  it("reads a setup saved before the floor as having none, and loses nothing else", () => {
    const { min_price_sqft: _gone, ...saved } = S();
    const s = asRoofCareSettings(saved);
    expect(s.min_price_sqft).toBeNull();
    expect(s.plans.care.base).toBe(800);
    expect(s.hours).toHaveLength(2);
    expect(asRoofCareSettings(S()).min_price_sqft).toBe(12_000);
  });

  it("is sent with every save, so a save can change it and remove it", () => {
    // The database keeps the floor when a save leaves it out (an older page). A save from this
    // page must therefore name it, as a number or as blank.
    expect(roofCareSettingsSchema.safeParse(S()).success).toBe(true);
    expect(roofCareSettingsSchema.safeParse(S({ min_price_sqft: null })).success).toBe(true);
    const { min_price_sqft: _gone, ...without } = S();
    expect(roofCareSettingsSchema.safeParse(without).success).toBe(false);
    expect(settingsFromDraft(draftFrom(S({ min_price_sqft: null }))).settings).toHaveProperty(
      "min_price_sqft",
      null,
    );
  });
});

describe("the database works the same floor", () => {
  const sql = flat("supabase/migrations/20261119400000_roof_care_price_floor.sql");

  it("prices the larger of the roof and the floor, and the roof alone with no floor", () => {
    expect(sql).toContain(
      "v_list := v_base + v_per * greatest(p_sqft, coalesce((d->>''min_price_sqft'')::numeric, 0));",
    );
    // The change is made to the function as it stands, and says so if it is not as expected.
    expect(sql).toContain("'v_list := v_base + v_per * p_sqft;'");
    expect(sql).toContain("raise exception 'roof_care_price is not as this change expects'");
  });

  it("keeps the floor when a page that does not know it saves the setup", () => {
    expect(sql).toContain(
      "not (new.data ? 'min_price_sqft') and old.data ? 'min_price_sqft' then new.data := new.data || jsonb_build_object('min_price_sqft', old.data -> 'min_price_sqft');",
    );
    expect(sql).toContain(
      "create trigger roof_care_settings_keep_floor before update on public.roof_care_settings",
    );
  });

  it("holds no number of the office's", () => {
    const file = read("supabase/migrations/20261119400000_roof_care_price_floor.sql");
    expect(file.replace(/20261119400000|Nov 19|of 2 hrs|, 0\)/g, "")).not.toMatch(/\d{3,}/);
    expect(read("src/lib/roof-care-price.ts")).not.toMatch(/15,?000/);
  });
});
