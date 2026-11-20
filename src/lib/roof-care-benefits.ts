/**
 * What each Roof Care plan includes, in the customer's words, and what a plan has given so far.
 *
 * The owner, Nov 19: "the care plan menu … will likely be customer facing so we need it to be
 * visually appealing, explain the plans, and the verbiage should be as if a customer is reading
 * it", and "if they click care plan it pops up the plan they are currently on and its benefits.
 * we also need to ensure everything related to the care plan … keeps track of what it should …
 * tracking repair allocation and amount of free inspections/other benefits that have already
 * been given".
 *
 * The wording follows the Roof Care Plans sheet the customer is handed. The numbers in it (the
 * minor repairs each year, the leak calls with no trip charge, the storm inspections) are not
 * written here: they come from the plan settings (roof_care_benefits() in the database) for a
 * plan on offer, and from the plan's own record for a plan that was signed.
 */
import { longDay } from "@/lib/followup-rules";
import { CLEANING_LABEL, cleaningTally } from "@/lib/roof-care-cleaning";
import { noAccessTally } from "@/lib/roof-care-no-access";
import { visitsDone, visitState, type PlanNoAccess, type RoofCarePlan } from "@/lib/roof-care-plan";
import {
  money0,
  PLAN_KEYS,
  PLAN_NAMES,
  VISITS_PER_YEAR,
  type PlanKey,
} from "@/lib/roof-care-price";

/** The numbers one plan's description needs. */
export interface PlanBenefitNumbers {
  /** Minor repairs included each year, in dollars; 0 for a plan with none. */
  allowance: number;
  /** Leak calls a year with no trip charge. */
  leak_calls: number;
  /** Storm inspections a year. */
  storm: number;
}
export type BenefitNumbers = Record<PlanKey, PlanBenefitNumbers>;

const count = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** roof_care_benefits()'s answer, read strictly: anything odd is "not known", never a number. */
export function readBenefits(x: unknown): BenefitNumbers | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const out = {} as BenefitNumbers;
  for (const k of PLAN_KEYS) {
    const r = (o[k] ?? null) as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return null;
    const allowance = count(r["allowance"]);
    const leak = count(r["leak_calls"]);
    const storm = count(r["storm"]);
    if (allowance == null || leak == null || storm == null) return null;
    out[k] = { allowance, leak_calls: Math.round(leak), storm: Math.round(storm) };
  }
  return out;
}

/** The numbers a signed plan carries on its own record. */
export function benefitsOfPlan(
  p: Pick<RoofCarePlan, "repair_allowance" | "free_travel_calls">,
  stormIncluded: number,
): PlanBenefitNumbers {
  return {
    allowance: p.repair_allowance,
    leak_calls: p.free_travel_calls,
    storm: Math.max(0, Math.round(stormIncluded)),
  };
}

// ── The sign-up, as the customer reads it ───────────────────────────────────────────────────

export const SIGN_UP_TITLE = "Roof Care Plans";
export const SIGN_UP_LEAD =
  "Two inspections a year, spring and fall, with a photo report after every visit. Pick the level of care that fits your building.";

/** One line under each plan's name. */
export const PLAN_PITCH: Record<PlanKey, string> = {
  watch: "We find the problems and tell you what they cost to fix.",
  care: "We clear the drains and fix the small things on the spot.",
  guard: "Full coverage, with fast response when something goes wrong.",
};
/** The plan the sheet recommends. */
export const PLAN_RECOMMENDED: PlanKey = "care";
export const RECOMMENDED_WORDS = "Our recommendation";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a plan adds, a line each. A larger plan starts with "Everything in …". `n` null: the
 * numbers could not be read, and the lines that hold one say it without it.
 */
export function planIncludes(plan: PlanKey, n: PlanBenefitNumbers | null): string[] {
  const repairs =
    n && n.allowance > 0
      ? `${money0(n.allowance)} of minor repairs included each year`
      : "Minor repairs included each year";
  if (plan === "watch")
    return [
      `${VISITS_PER_YEAR} inspections a year, spring and fall`,
      "A photo report with a condition grade after each one",
      "A repair list with a quote for each item",
      "Inspection records kept for your warranty",
    ];
  if (plan === "care")
    return [
      `Everything in ${PLAN_NAMES.watch}`,
      "Drains and scuppers cleaned at both inspections",
      repairs,
      "Priority scheduling on leak calls",
    ];
  const out = [`Everything in ${PLAN_NAMES.care}`, "Gutters cleaned at both inspections*", repairs];
  out.push(
    n && n.leak_calls > 0
      ? `Next-business-day leak response, with no trip charge on ${plural(n.leak_calls, "call", "calls")} a year`
      : "Next-business-day leak response",
  );
  if (!n || n.storm > 0)
    out.push(
      `${n ? plural(n.storm, "storm inspection", "storm inspections") : "A storm inspection"} a year, after a major storm†`,
    );
  out.push("A yearly roof budget forecast");
  return out;
}

/** Everything a plan includes, spelled out: a larger plan lists the smaller ones' lines too. */
export function everythingIncluded(plan: PlanKey, n: PlanBenefitNumbers | null): string[] {
  const chain: PlanKey[] =
    plan === "watch" ? ["watch"] : plan === "care" ? ["watch", "care"] : ["watch", "care", "guard"];
  const out: string[] = [];
  for (const k of chain) {
    for (const line of planIncludes(k, k === plan ? n : null)) {
      if (line.startsWith("Everything in ")) continue;
      // The larger plan's own repairs line replaces the smaller plan's.
      if (k !== plan && /minor repairs/i.test(line)) continue;
      out.push(line);
    }
  }
  return out;
}

/** The small print under the three plans. */
export const PLAN_FOOTNOTES: readonly string[] = [
  "* Gutters that can be reached without a lift or other access equipment.",
  "† Call us after the storm to ask for your inspection.",
  "Minor repairs are valued at our standard rates. An unused amount does not carry over to the next year.",
];

/** Under a plan before the roof's size is known. */
export const PRICE_AFTER_SIZE = "Your price shows once we have the roof's size";
export const PRICE_PAID_FIRST = "Paid once for the year, before the plan starts";

// How the customer pays, in their words. Card (owner, Nov 19): "if the pay by card is selected
// at the end it needs to reroute to the stripe checkout once that's set up". Until Stripe is set
// up the office takes the card; AGENTS.md carries the reminder.
export const PAY_QUESTION = "How would you like to pay for the year?";
export const PAY_CARD_NOTE_CUSTOMER =
  "Our office will contact you to take your card payment. Your plan starts the day it is received.";
export const PAY_CHECK_NOTE_CUSTOMER =
  "Make the check out to JBK Commercial Roofing. Your plan starts the day it is received.";

export const EMAIL_LABEL = "Email for your agreement and receipt";
export const EMAIL_NONE_NOTE =
  "Without an email address we cannot send you a copy of the agreement or a receipt.";
export const EMAIL_BAD = "That does not look like an email address";
/** The same shape the database takes. */
export const looksLikeEmail = (s: string): boolean =>
  s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export const AGREE_WORDS = "I have read these terms and agree to them.";
export const SIGN_UP_BUTTON = "Agree and sign up";

/**
 * What the sign-up still needs before "Agree and sign up" can be pressed (owner, Nov 20: the
 * button was grey with no word why). In the order of the form, in the customer's words.
 */
export function signUpMissing(a: {
  /** A price is on the screen for the size in the box. */
  priced: boolean;
  /** The size in the box changed since the price was shown. */
  stale: boolean;
  plan: boolean;
  first: boolean;
  /** "A set number of days" is picked and the days are not 1 to 365. */
  daysBad: boolean;
  pay: boolean;
  name: boolean;
  emailBad: boolean;
  agreed: boolean;
  /** The typed size is far under the map's: "blocked" for someone who cannot confirm it. */
  size?: "ok" | "tick" | "blocked";
}): string[] {
  const out: string[] = [];
  if (!a.priced) out.push("the roof size, then Show my price");
  else if (a.stale) out.push("Show my price again: the roof size changed");
  if (a.size === "blocked") out.push("a roof size that matches the map, or a manager to sign it");
  else if (a.size === "tick") out.push("the tick that the typed roof size is right");
  if (!a.plan) out.push("a plan");
  if (!a.first) out.push("when the first inspection is");
  else if (a.daysBad) out.push("the days to the first inspection, 1 to 365");
  if (!a.pay) out.push("how you are paying");
  if (!a.name) out.push("your name");
  if (a.emailBad) out.push("an email address that reads right, or none");
  if (!a.agreed) out.push("the tick that you agree to the terms");
  return out;
}

/** "Still needed: a plan, your name." Empty when nothing is. */
export function signUpMissingLine(missing: readonly string[]): string {
  return missing.length ? `Still needed: ${missing.join("; ")}.` : "";
}

// ── What a plan has given so far ────────────────────────────────────────────────────────────

export type BenefitKey =
  | "inspections"
  | "drains"
  | "gutters"
  | "repairs"
  | "leak_calls"
  | "storm"
  | "forecast"
  | "no_access";
export const NO_ACCESS_TALLY_LABEL = "Visits with no access";
export const FORECAST_LABEL = "Yearly budget forecast";
export const FORECAST_MARK_SENT = "Mark the budget forecast sent";
export const FORECAST_UNDO = "Not sent after all";
export interface BenefitUse {
  key: BenefitKey;
  label: string;
  /** How much is used; null when the reader may not see it (it is read from invoices). */
  used: number | null;
  /** How much the plan includes for the year. */
  of: number;
  /** The whole line, as it is shown. */
  words: string;
}

/**
 * The plan year's tally: the two inspections, the minor repairs, the leak calls with no trip
 * charge and the storm inspections. Only what the plan includes is listed. The repairs and the
 * leak calls are counted from invoices, so they are null for a reader who does not see invoices.
 */
export function benefitsUsed(
  plan: Pick<
    RoofCarePlan,
    | "plan"
    | "visits"
    | "repair_allowance"
    | "allowance_used"
    | "free_travel_calls"
    | "free_travel_used"
  > & { forecast_sent_on?: string | null; no_access?: readonly PlanNoAccess[] | null },
  today: string,
  stormIncluded: number,
): BenefitUse[] {
  const out: BenefitUse[] = [];
  const done = visitsDone(plan, today).visits;
  out.push({
    key: "inspections",
    label: "Inspections",
    used: done,
    of: VISITS_PER_YEAR,
    words: `${done} of ${VISITS_PER_YEAR} done`,
  });
  // The cleaning the plan includes at each inspection (Nov 19, night): what was answered Yes.
  if (plan.plan !== "watch") {
    const d = cleaningTally(plan.visits, "drains");
    out.push({
      key: "drains",
      label: CLEANING_LABEL.drains,
      used: d.done,
      of: d.of,
      words: d.words,
    });
  }
  if (plan.plan === "guard") {
    const g = cleaningTally(plan.visits, "gutters");
    out.push({
      key: "gutters",
      label: CLEANING_LABEL.gutters,
      used: g.done,
      of: g.of,
      words: g.words,
    });
  }
  if (plan.repair_allowance > 0) {
    const used = plan.allowance_used;
    const left = used == null ? null : Math.max(0, plan.repair_allowance - used);
    out.push({
      key: "repairs",
      label: "Minor repairs",
      used,
      of: plan.repair_allowance,
      words:
        used == null || left == null
          ? `${money0(plan.repair_allowance)} a year included`
          : `${money0(used)} of ${money0(plan.repair_allowance)} used, ${money0(left)} left`,
    });
  }
  if (plan.free_travel_calls > 0) {
    const used = plan.free_travel_used;
    out.push({
      key: "leak_calls",
      label: "Leak calls with no trip charge",
      used,
      of: plan.free_travel_calls,
      words:
        used == null
          ? `${plan.free_travel_calls} a year included`
          : `${Math.min(used, plan.free_travel_calls)} of ${plan.free_travel_calls} used`,
    });
  }
  // A storm inspection is used once it is asked for: its ticket is made then. One beyond the
  // ones the plan includes is billed by itself (Nov 19, late): it carries an amount, and is
  // told apart here.
  const stormVisits = plan.visits.filter(
    (v) => v.kind === "storm" && visitState(v, today) !== "lost",
  );
  // A technician is given no amount: the database says which ones are billed (`extra`).
  const stormBilled = stormVisits.filter((v) => v.amount > 0 || v.extra === true).length;
  const storms = stormVisits.length - stormBilled;
  const stormOf = Math.max(0, Math.round(stormIncluded));
  if (plan.plan === "guard" && (stormOf > 0 || stormVisits.length > 0)) {
    const included =
      storms > stormOf ? `${storms} used, ${stormOf} included` : `${storms} of ${stormOf} used`;
    out.push({
      key: "storm",
      label: stormVisits.length > 1 || storms > stormOf ? "Storm inspections" : "Storm inspection",
      used: storms,
      of: stormOf,
      words:
        stormBilled > 0
          ? `${included}, and ${stormBilled} more, not included: billed by itself`
          : included,
    });
  }
  if (plan.plan === "guard") {
    const sent = plan.forecast_sent_on ?? null;
    out.push({
      key: "forecast",
      label: FORECAST_LABEL,
      used: sent ? 1 : 0,
      of: 1,
      words: sent ? `Sent ${longDay(sent)}` : "Not sent yet",
    });
  }
  // The times we could not get on the roof (Nov 19, late): for the office, once there is one.
  if (plan.no_access?.length) {
    const t = noAccessTally(plan.no_access);
    out.push({
      key: "no_access",
      label: NO_ACCESS_TALLY_LABEL,
      used: t.count,
      of: 0,
      words: t.words,
    });
  }
  return out;
}
