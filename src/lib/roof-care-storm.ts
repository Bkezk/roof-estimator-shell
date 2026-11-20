/**
 * A storm inspection beyond the ones the plan includes (owner, Nov 19: "Second inspection billed
 * at inspection price and their repair allocation contributes to the price if they have any
 * left"). Pure.
 *
 * The agreement's term 8: "A further storm inspection in the same plan year is billed at the
 * price of one inspection, and what is left of the plan's minor repairs amount is used toward it
 * first."
 *
 * The storm inspections the plan includes stay free. A further one is billed at the price of one
 * inspection: half of Roof Watch for that roof and drive, the same amount a renewal takes off
 * for an inspection we did not get to. The database works it out and keeps it on the inspection
 * (roof_care_add_storm, roof_care_visits.amount), and adds a billed one only after the screen
 * has said so. Its invoice is made by itself when the inspection is authorized, with the plan's
 * own line at that amount; the minor repairs line every repair invoice uses then takes what is
 * left of the allowance off it (roof-care-allowance.ts), so the plan's tally and a refund count
 * it as minor repairs used.
 *
 * No amount lives here.
 */
import { allowanceMoney } from "@/lib/roof-care-allowance";

/** Where a plan stands before Storm inspection is pressed: roof_care_storm_offer(). */
export interface StormOffer {
  /** The next one is billed: the ones the plan includes are used. */
  billed: boolean;
  /** How many a plan year the plan includes, and how many of those are used. */
  included: number;
  used: number;
  /** Billed ones already added this plan year. */
  billed_so_far: number;
  /** The price of one inspection; null for an included one, and when it cannot be worked out. */
  price: number | null;
  /** What is left of the plan's minor repairs, what of it goes toward this, and the rest. */
  allowance_left: number;
  plan_pays: number;
  customer_pays: number;
  /**
   * A storm inspection was already added to this plan today (Nov 20): who added it and when.
   * A second one the same day has to be confirmed in the box. Absent on an older answer.
   */
  added_today?: { by_name: string | null; at: string } | null;
}

const whole = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const amount = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** The database's answer, read strictly: anything odd is "not known", never a guess. */
export function readStormOffer(x: unknown): StormOffer | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const included = whole(o["included"]);
  const used = whole(o["used"]);
  if (typeof o["billed"] !== "boolean" || included == null || used == null) return null;
  const today = o["added_today"];
  const added_today =
    today && typeof today === "object" && typeof (today as { at?: unknown }).at === "string"
      ? {
          by_name:
            typeof (today as { by_name?: unknown }).by_name === "string"
              ? (today as { by_name: string }).by_name.trim() || null
              : null,
          at: (today as { at: string }).at,
        }
      : null;
  const base = { included, used, billed_so_far: whole(o["billed_so_far"]) ?? 0, added_today };
  if (!o["billed"])
    return {
      ...base,
      billed: false,
      price: null,
      allowance_left: 0,
      plan_pays: 0,
      customer_pays: 0,
    };
  const price = amount(o["price"]);
  const left = amount(o["allowance_left"]);
  const plan = amount(o["plan_pays"]);
  const customer = amount(o["customer_pays"]);
  if (price == null || !(price > 0) || left == null || plan == null || customer == null)
    return {
      ...base,
      billed: true,
      price: null,
      allowance_left: 0,
      plan_pays: 0,
      customer_pays: 0,
    };
  return {
    ...base,
    billed: true,
    price,
    allowance_left: left,
    plan_pays: plan,
    customer_pays: customer,
  };
}

export const STORM_NO_PRICE =
  "The price of one inspection could not be worked out for this roof, so a billed storm inspection cannot be added. Ask an admin.";
export const STORM_ADD_INCLUDED = "Add the storm inspection";
export const STORM_ADD_BILLED = "Add it as a billed inspection";

/**
 * It can be added: a billed one has its price, and a second one the same day is confirmed
 * (`againOk`: the box's tick).
 */
export const stormCanAdd = (o: StormOffer, againOk = true): boolean =>
  (!o.billed || o.price != null) && (!o.added_today || againOk);

export const STORM_AGAIN_LABEL = "Add a second storm inspection today";
export const STORM_REMOVE_LABEL = "Take off";
export const STORM_REMOVE_NOTE =
  "For a storm inspection added by mistake. It and its ticket go, and the plan's count goes back.";

/** "A storm inspection was already added to this plan today, by Dana at 2:15 PM." */
export function stormAgainLine(
  added: { by_name: string | null; at: string },
  timeZone = "America/New_York",
): string {
  const d = new Date(added.at);
  const when = Number.isNaN(d.getTime())
    ? ""
    : ` at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })}`;
  return `A storm inspection was already added to this plan today${added.by_name ? `, by ${added.by_name}` : ""}${when}. Tick the box to add a second one today.`;
}

/** What the box says before it is pressed, a sentence each. */
export function stormOfferLines(o: StormOffer): string[] {
  if (!o.billed)
    return [
      `This is storm inspection ${o.used + 1} of the ${o.included} the plan includes this plan year.`,
      "It is not billed.",
    ];
  const used =
    o.included === 0
      ? "This plan includes no storm inspection."
      : o.included === 1
        ? "The storm inspection this plan includes is used for this plan year."
        : `The ${o.included} storm inspections this plan includes are used for this plan year.`;
  if (o.price == null) return [used, STORM_NO_PRICE];
  const out = [
    used,
    `This one is billed at the price of one inspection: ${allowanceMoney(o.price)}.`,
  ];
  if (o.plan_pays > 0)
    out.push(
      `${allowanceMoney(o.plan_pays)} of the plan's minor repairs goes toward it, which leaves ${allowanceMoney(Math.max(0, o.allowance_left - o.plan_pays))} of minor repairs.`,
      o.customer_pays > 0
        ? `The customer pays ${allowanceMoney(o.customer_pays)}.`
        : "The customer pays nothing more.",
    );
  else
    out.push(
      "Nothing is left of the plan's minor repairs this plan year.",
      `The customer pays ${allowanceMoney(o.customer_pays)}.`,
    );
  out.push("Its invoice is made when the inspection is authorized.");
  return out;
}

export const roofCareStormKey = (planId: string) => ["roof-care-storm-offer", planId] as const;
