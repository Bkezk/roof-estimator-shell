/**
 * Roof Care plans: what a plan costs the customer, what it costs JBK, and how the price follows
 * the drive (owner, Nov 18; docs/roof-care-plans.md).
 *
 * The owner's costing sheet showed whether a plan made money at one fixed drive. It did not
 * change the price. The owner's words: "we need the prices to adjust to the travel distance x
 * paying the crew to get there and back based on customer location", and "the baseline assumes 2
 * hour round trip drive time no matter what, but based on the distance of the address from jbk
 * office determines if its more than that and the price should auto adjust accordingly".
 *
 * So:
 *
 *   list price   = the plan's base + its price per square foot x the roof
 *   travel       = for a round trip LONGER than the baseline, each trip of the plan year adds
 *                  the hours over the baseline at the crew's pay and the miles over the baseline
 *                  at the vehicle's cost per mile. At cost, no markup (the owner's choice).
 *                  A closer building pays the list price, never less.
 *   price        = list price + travel, to the dollar
 *   trips a year = the two visits; Roof Guard also drives for its leak calls and its storm
 *                  inspections
 *
 * The cost side is the sheet's own, line for line (`planCost`), worked with the building's real
 * drive, so the profit shown is the profit at that distance. With the travel added at cost, a
 * far building earns the same dollars as one at the baseline.
 *
 * NO NUMBER IS IN THIS FILE. Every rate, price and hour is typed on Admin › Settings › Roof Care
 * plans and kept in the database (roof_care_settings), where only an admin reads it. A number
 * that is missing is named (`settingsProblems`) and no price is given: never a price worked from
 * a blank read as zero.
 *
 * Pure: no React, no database, no clock.
 */
import { z } from "zod";

export const PLAN_KEYS = ["watch", "care", "guard"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const PLAN_NAMES: Record<PlanKey, string> = {
  watch: "Roof Watch",
  care: "Roof Care",
  guard: "Roof Guard",
};

/** Two inspections a year, on every plan. */
export const VISITS_PER_YEAR = 2;

const num = z.number().finite().nonnegative().nullable();
const planSchema = z.object({
  /** The part of the yearly price that does not depend on the roof's size. */
  base: num,
  /** Dollars per square foot of roof, per year. */
  per_sqft: num,
  /** Dollars of minor repairs included each year; null where the plan includes none. */
  allowance: num,
});
const hoursRowSchema = z.object({
  sqft: z.number().finite().positive(),
  /** Hours on the roof for one inspection. */
  inspection: z.number().finite().nonnegative(),
  /** Hours cleaning drains and scuppers, per visit. */
  drains: z.number().finite().nonnegative(),
  /** Hours cleaning gutters, per visit. */
  gutters: z.number().finite().nonnegative(),
});

export const roofCareSettingsSchema = z.object({
  /** What one crew member costs JBK for an hour. */
  crew_cost_per_hour: num,
  crew_size: num,
  /** The round trip the list prices already cover. */
  baseline_drive_hours: num,
  baseline_miles: num,
  vehicle_cost_per_mile: num,
  /** Writing the photo report, per visit, in dollars. */
  report_cost_per_visit: num,
  /** What an included repair costs JBK, as a percent of its retail value. */
  repair_cost_pct: num,
  /** How much of the repair allowance is expected to be used, percent. */
  allowance_used_pct: num,
  guard_leak_calls: num,
  guard_hours_per_leak_call: num,
  guard_storm_inspections: num,
  guard_forecast_cost: num,
  /** Roofs larger than this get a custom quote, not a price. */
  custom_quote_over_sqft: num,
  /**
   * The smallest roof the price is worked for (owner, Nov 19: "the minimum roof size pricing is
   * always priced at … so its never not profitable, thats the floor similarly to where drive time
   * is minimum of 2 hrs"). A smaller roof pays the price of this size. Blank: no floor.
   */
  min_price_sqft: num,
  /**
   * What a card payment costs (owner, Nov 19, night): a percent of the amount and a flat sum
   * for each payment. Taken off a refund of a year paid by card. Blank: nothing is taken off.
   */
  card_fee_pct: num.optional(),
  card_fee_flat: num.optional(),
  /**
   * What a return trip is charged after a visit we could not do (owner, Nov 20: "go" on a trip
   * rate of the plan's own): for each hour of the round trip, the whole crew, and for each mile.
   * Both blank: the Service rates page's travel rates are used, as before.
   */
  trip_charge_per_hour: num.optional(),
  trip_charge_per_mile: num.optional(),
  plans: z.object({ watch: planSchema, care: planSchema, guard: planSchema }),
  hours: z.array(hoursRowSchema).max(40),
});
export type RoofCareSettings = z.infer<typeof roofCareSettingsSchema>;
export type HoursRow = z.infer<typeof hoursRowSchema>;

const blankPlan = () => ({ base: null, per_sqft: null, allowance: null });

/** Nothing typed yet: every box blank. */
export function emptyRoofCareSettings(): RoofCareSettings {
  return {
    crew_cost_per_hour: null,
    crew_size: null,
    baseline_drive_hours: null,
    baseline_miles: null,
    vehicle_cost_per_mile: null,
    report_cost_per_visit: null,
    repair_cost_pct: null,
    allowance_used_pct: null,
    guard_leak_calls: null,
    guard_hours_per_leak_call: null,
    guard_storm_inspections: null,
    guard_forecast_cost: null,
    custom_quote_over_sqft: null,
    min_price_sqft: null,
    card_fee_pct: null,
    card_fee_flat: null,
    trip_charge_per_hour: null,
    trip_charge_per_mile: null,
    plans: { watch: blankPlan(), care: blankPlan(), guard: blankPlan() },
    hours: [],
  };
}

/** The stored settings, read leniently: a part that is missing or malformed is blank. */
export function asRoofCareSettings(x: unknown): RoofCareSettings {
  const empty = emptyRoofCareSettings();
  if (!x || typeof x !== "object") return empty;
  const whole = roofCareSettingsSchema.safeParse({ ...empty, ...(x as object) });
  if (whole.success) return whole.data;
  // One bad part does not blank the rest: take each field that reads on its own.
  const src = x as Record<string, unknown>;
  const out = empty as unknown as Record<string, unknown>;
  for (const [k, schema] of Object.entries(roofCareSettingsSchema.shape)) {
    const r = (schema as z.ZodTypeAny).safeParse(src[k]);
    if (r.success && r.data !== undefined) out[k] = r.data;
  }
  return out as unknown as RoofCareSettings;
}

/** The boxes of the settings page that are single numbers, with the words beside each. */
export const SETTING_LABELS = {
  crew_cost_per_hour: "Crew member cost per hour ($)",
  crew_size: "Crew size (people)",
  baseline_drive_hours: "Round trip the list price covers (hours)",
  baseline_miles: "Round trip the list price covers (miles)",
  vehicle_cost_per_mile: "Vehicle cost per mile ($)",
  report_cost_per_visit: "Report time per visit ($)",
  repair_cost_pct: "Repair cost, % of retail value",
  allowance_used_pct: "Repair allowance used (%)",
  guard_leak_calls: "Roof Guard: leak calls per year",
  guard_hours_per_leak_call: "Roof Guard: hours per leak call",
  guard_storm_inspections: "Roof Guard: storm inspections a year",
  guard_forecast_cost: "Roof Guard: budget forecast cost ($)",
  custom_quote_over_sqft: "Custom quote for roofs over (sq ft)",
  min_price_sqft: "Smallest roof the price is worked for (sq ft)",
  card_fee_pct: "Card fee, % of a payment",
  card_fee_flat: "Card fee, flat sum per payment ($)",
  trip_charge_per_hour: "Return trip charge per hour of the round trip, whole crew ($)",
  trip_charge_per_mile: "Return trip charge per mile ($)",
} as const;
export type SettingKey = keyof typeof SETTING_LABELS;

/** What must be typed before any price can be given, in the page's own words; [] when ready. */
export function settingsProblems(s: RoofCareSettings): string[] {
  const out: string[] = [];
  const need: SettingKey[] = [
    "crew_cost_per_hour",
    "crew_size",
    "baseline_drive_hours",
    "baseline_miles",
    "vehicle_cost_per_mile",
    "report_cost_per_visit",
    "repair_cost_pct",
    "allowance_used_pct",
    "guard_leak_calls",
    "guard_hours_per_leak_call",
    "guard_storm_inspections",
    "guard_forecast_cost",
  ];
  for (const k of need) if (s[k] == null) out.push(`Type “${SETTING_LABELS[k]}”`);
  if (s.crew_size != null && s.crew_size <= 0) out.push("The crew size must be more than 0");
  for (const p of PLAN_KEYS) {
    if (s.plans[p].base == null) out.push(`Type the base price of ${PLAN_NAMES[p]}`);
    if (s.plans[p].per_sqft == null) out.push(`Type the price per sq ft of ${PLAN_NAMES[p]}`);
  }
  // Roof Watch includes no repairs; the other two do.
  for (const p of ["care", "guard"] as const)
    if (s.plans[p].allowance == null) out.push(`Type the repair allowance of ${PLAN_NAMES[p]}`);
  if (s.hours.length === 0) out.push("Add at least one row to Hours on site per visit");
  return out;
}

// To the cent, as the database rounds: half a cent goes up. The sum is cleaned of binary noise
// first (0.285 held as 0.28499999… would round down where the database rounds up).
const r2 = (n: number) => Math.round(Number((n * 100).toFixed(6))) / 100;
const dollars = (n: number) => Math.round(n);

/**
 * Hours on site for a roof of `sqft`: the table's own row, a straight line between two rows, the
 * smallest row's hours for a smaller roof and the largest row's for a larger one (such a roof is
 * a custom quote anyway). Null with no rows.
 */
export function hoursAt(
  rows: readonly HoursRow[],
  sqft: number,
): { inspection: number; drains: number; gutters: number } | null {
  if (!rows.length || !Number.isFinite(sqft)) return null;
  const sorted = [...rows].sort((a, b) => a.sqft - b.sqft);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const pick = (r: HoursRow) => ({
    inspection: r.inspection,
    drains: r.drains,
    gutters: r.gutters,
  });
  if (sqft <= first.sqft) return pick(first);
  if (sqft >= last.sqft) return pick(last);
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1]!;
    const hi = sorted[i]!;
    if (sqft > hi.sqft) continue;
    const t = (sqft - lo.sqft) / (hi.sqft - lo.sqft);
    const mix = (a: number, b: number) => a + (b - a) * t;
    return {
      inspection: mix(lo.inspection, hi.inspection),
      drains: mix(lo.drains, hi.drains),
      gutters: mix(lo.gutters, hi.gutters),
    };
  }
  return pick(last);
}

/** A round trip from the office: hours on the road there and back, and the miles. */
export interface Drive {
  hours: number;
  miles: number;
}

/** A complete set of numbers: what `settingsProblems` promises when it returns none. */
type Ready = {
  [K in SettingKey]: number;
} & { plans: Record<PlanKey, { base: number; per_sqft: number; allowance: number }> };

function ready(s: RoofCareSettings): Ready | null {
  if (settingsProblems(s).length) return null;
  const n = (v: number | null) => v ?? 0;
  const plan = (p: PlanKey) => ({
    base: n(s.plans[p].base),
    per_sqft: n(s.plans[p].per_sqft),
    allowance: n(s.plans[p].allowance),
  });
  return {
    crew_cost_per_hour: n(s.crew_cost_per_hour),
    crew_size: n(s.crew_size),
    baseline_drive_hours: n(s.baseline_drive_hours),
    baseline_miles: n(s.baseline_miles),
    vehicle_cost_per_mile: n(s.vehicle_cost_per_mile),
    report_cost_per_visit: n(s.report_cost_per_visit),
    repair_cost_pct: n(s.repair_cost_pct),
    allowance_used_pct: n(s.allowance_used_pct),
    guard_leak_calls: n(s.guard_leak_calls),
    guard_hours_per_leak_call: n(s.guard_hours_per_leak_call),
    guard_storm_inspections: n(s.guard_storm_inspections),
    guard_forecast_cost: n(s.guard_forecast_cost),
    custom_quote_over_sqft: n(s.custom_quote_over_sqft),
    min_price_sqft: n(s.min_price_sqft),
    card_fee_pct: n(s.card_fee_pct ?? null),
    card_fee_flat: n(s.card_fee_flat ?? null),
    trip_charge_per_hour: n(s.trip_charge_per_hour ?? null),
    trip_charge_per_mile: n(s.trip_charge_per_mile ?? null),
    plans: { watch: plan("watch"), care: plan("care"), guard: plan("guard") },
  };
}

/**
 * The roof size the price is worked for: the roof's own, and never under the floor. As the list
 * price never goes under the baseline drive, it never goes under this size either. No floor
 * typed: the roof's own size.
 */
export function pricedSqft(s: Pick<RoofCareSettings, "min_price_sqft">, sqft: number): number {
  return Math.max(sqft, s.min_price_sqft ?? 0);
}

/** How many times a year the crew drives to the building for a plan. */
export function tripsPerYear(s: RoofCareSettings, plan: PlanKey): number {
  if (plan !== "guard") return VISITS_PER_YEAR;
  return VISITS_PER_YEAR + (s.guard_leak_calls ?? 0) + (s.guard_storm_inspections ?? 0);
}

/**
 * What ONE trip adds to the price for a drive longer than the baseline: the extra hours at the
 * whole crew's pay, and the extra miles. Nothing for a drive at or under the baseline, and each
 * of the two is counted on its own (a slow short road adds hours, not miles).
 */
export function travelPerTrip(s: RoofCareSettings, drive: Drive): number {
  const crew = (s.crew_cost_per_hour ?? 0) * (s.crew_size ?? 0);
  const hours = Math.max(0, drive.hours - (s.baseline_drive_hours ?? 0));
  const miles = Math.max(0, drive.miles - (s.baseline_miles ?? 0));
  return r2(hours * crew + miles * (s.vehicle_cost_per_mile ?? 0));
}

/**
 * A return trip after a visit we could not do, for a round trip of `drive`: what it costs us
 * (the whole crew's pay for the hours, and the vehicle for the miles) and what the two trip
 * charge boxes charge for it. `cost` is null until the numbers it needs are typed. `charge` is
 * null when both boxes are blank: the Service rates page's travel rates are used then, and the
 * database works that amount.
 */
export function tripCostAndCharge(
  s: Pick<
    RoofCareSettings,
    | "crew_cost_per_hour"
    | "crew_size"
    | "vehicle_cost_per_mile"
    | "trip_charge_per_hour"
    | "trip_charge_per_mile"
  >,
  drive: Drive,
): { cost: number | null; charge: number | null } {
  const cost =
    s.crew_cost_per_hour == null || s.crew_size == null || s.vehicle_cost_per_mile == null
      ? null
      : r2(
          drive.hours * s.crew_cost_per_hour * s.crew_size + drive.miles * s.vehicle_cost_per_mile,
        );
  const perHour = s.trip_charge_per_hour ?? 0;
  const perMile = s.trip_charge_per_mile ?? 0;
  const charge =
    perHour > 0 || perMile > 0 ? r2(drive.hours * perHour + drive.miles * perMile) : null;
  return { cost, charge };
}

const usd2 = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The line under the two trip charge boxes, for the round trip the list price covers: what that
 * trip costs us, and what the boxes charge for it. Null until that round trip is typed.
 */
export function tripChargeNote(s: RoofCareSettings): string | null {
  if (s.baseline_drive_hours == null || s.baseline_miles == null) return null;
  const { cost, charge } = tripCostAndCharge(s, {
    hours: s.baseline_drive_hours,
    miles: s.baseline_miles,
  });
  const trip = `a round trip of ${s.baseline_drive_hours} hours and ${s.baseline_miles} miles`;
  const costs = cost == null ? "" : ` It costs us ${usd2(cost)}.`;
  if (charge == null)
    return `Both blank: a return trip is charged at the travel rates on the Service rates page. For ${trip}:${costs || " type the crew and vehicle costs above to see what it costs us."}`;
  const short =
    cost != null && charge < cost
      ? ` That is ${usd2(r2(cost - charge))} under what it costs us.`
      : "";
  return `For ${trip}: these two boxes charge ${usd2(charge)}.${costs}${short}`;
}

export interface PlanPrice {
  plan: PlanKey;
  name: string;
  /** Base + per square foot: the price at the baseline drive. */
  list: number;
  /** What the drive adds for the year. 0 at or under the baseline. */
  travel: number;
  /** What the customer pays for the year: list + travel, to the dollar. */
  price: number;
  /** Half the yearly price, billed at each of the two visits (the first takes the odd dollar). */
  per_visit: [number, number];
  trips: number;
  /** What the year costs JBK at this drive, as the costing sheet builds it. */
  cost: number;
  profit: number;
}

export interface RoofCareQuote {
  sqft: number;
  /** The drive the prices were worked with; the baseline when none was given. */
  drive: Drive;
  /** True when the building is further than the list price covers. */
  beyond_baseline: boolean;
  /** Over the size limit: the plans are quoted by hand, and `plans` is empty. */
  custom_quote: boolean;
  plans: PlanPrice[];
}

/**
 * The three plans for a roof of `sqft` at `drive` (null = the baseline drive, as on the costing
 * sheet). Null with `problems` when a number is missing or the roof's size is not a size.
 */
export function roofCareQuote(
  s: RoofCareSettings,
  input: { sqft: number; drive?: Drive | null },
): { quote: RoofCareQuote; problems: [] } | { quote: null; problems: string[] } {
  const problems = settingsProblems(s);
  if (!Number.isFinite(input.sqft) || input.sqft <= 0)
    problems.push("Type the roof's size in square feet");
  const drive = input.drive ?? null;
  if (drive && !(Number.isFinite(drive.hours) && Number.isFinite(drive.miles) && drive.hours >= 0))
    problems.push("The drive time could not be worked out");
  const v = ready(s);
  const hours = hoursAt(s.hours, input.sqft);
  if (problems.length || !v || !hours) return { quote: null, problems };

  const used: Drive = drive ?? { hours: v.baseline_drive_hours, miles: v.baseline_miles };
  const custom = v.custom_quote_over_sqft > 0 && input.sqft > v.custom_quote_over_sqft;
  const crew = v.crew_cost_per_hour * v.crew_size;
  // The sheet's own lines, with this building's drive.
  const trip = used.hours * crew + used.miles * v.vehicle_cost_per_mile;
  const visit = trip + hours.inspection * crew + v.report_cost_per_visit;
  const repairs = (p: PlanKey) =>
    v.plans[p].allowance * (v.allowance_used_pct / 100) * (v.repair_cost_pct / 100);
  const cost: Record<PlanKey, number> = {
    watch: VISITS_PER_YEAR * visit,
    care: VISITS_PER_YEAR * visit + VISITS_PER_YEAR * hours.drains * crew + repairs("care"),
    guard:
      VISITS_PER_YEAR * visit +
      VISITS_PER_YEAR * (hours.drains + hours.gutters) * crew +
      repairs("guard") +
      v.guard_leak_calls * (trip + v.guard_hours_per_leak_call * crew) +
      v.guard_storm_inspections * visit +
      v.guard_forecast_cost,
  };
  const perTrip = travelPerTrip(s, used);
  const plans = custom
    ? []
    : PLAN_KEYS.map((p): PlanPrice => {
        // The price floor (owner, Nov 19): a roof under the floor pays the floor size's price.
        // The cost above is the real roof's, so the profit shown is what such a roof earns.
        const list = v.plans[p].base + v.plans[p].per_sqft * pricedSqft(s, input.sqft);
        const trips = tripsPerYear(s, p);
        const travel = perTrip * trips;
        const price = dollars(list + travel);
        const first = Math.ceil(price / 2);
        return {
          plan: p,
          name: PLAN_NAMES[p],
          list: dollars(list),
          // The price less the list price, so "X plus Y for the drive" always adds up (Nov 19:
          // each was rounded on its own and the two could be a dollar off the price).
          travel: price - dollars(list),
          price,
          per_visit: [first, price - first],
          trips,
          cost: dollars(cost[p]),
          profit: price - dollars(cost[p]),
        };
      });
  return {
    quote: {
      sqft: input.sqft,
      drive: { hours: r2(used.hours), miles: r2(used.miles) },
      beyond_baseline: perTrip > 0,
      custom_quote: custom,
      plans,
    },
    problems: [],
  };
}

/** "$1,250" for a whole-dollar amount. */
export const money0 = (n: number): string =>
  `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** The sizes the costing sheet's own table shows; the page adds one row for a size typed. */
export const TABLE_SIZES_DEFAULT = [10_000, 20_000, 50_000, 75_000] as const;
