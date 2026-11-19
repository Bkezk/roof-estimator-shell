/**
 * Roof Guard's leak calls with no travel charge (owner, Nov 19; docs/roof-care-plans.md). Pure.
 *
 * The owner: "two leak calls with the credit subtracting until it reaches 0 and on those two
 * leak calls travel is not charged? then after that it is", and "travel does come out of the
 * later ones if theyve had 2 calls but havent used all their repair allotment yet". The flyer
 * gives this to Roof Guard alone ("no trip charge on 2 calls a year").
 *
 * So: a plan keeps how many repair calls a year have no travel charge
 * (roof_care_plans.free_travel_calls, taken from the price setup at sign-up; 0 for the other
 * plans). A repair invoice at that property carries ONE line that takes its travel off, while
 * the plan has a call left. It is put there by itself; the office unticks it when the visit was
 * not a leak call. The minor repairs credit then covers what the invoice still charges, as it
 * always did: on a later call that includes the travel.
 *
 * How it is made sure of: the database lets no more invoices carry the line than the plan has
 * calls, and refuses one that adds money (invoice_lines_care_rule). A void invoice gives its
 * call back.
 *
 * No amount lives here.
 */
import { isAllowanceLine } from "@/lib/roof-care-allowance";
import { planName } from "@/lib/roof-care-plan";

export const TRAVEL_SOURCE_PREFIX = "roof-care-travel:";
export const travelLineSource = (planId: string): string => `${TRAVEL_SOURCE_PREFIX}${planId}`;
export const isTravelWaiverLine = (l: { source?: string | null | undefined }): boolean =>
  !!l.source && l.source.startsWith(TRAVEL_SOURCE_PREFIX);

/**
 * A line the plan put on the invoice: the minor repairs credit or the leak call's travel. The
 * editor never types over either, and both print under the work they are taken from.
 */
export const isPlanLine = (l: { source?: string | null | undefined }): boolean =>
  isAllowanceLine(l) || isTravelWaiverLine(l);

const r2 = (n: number) => Math.round(n * 100) / 100;

type Totalled = {
  kind?: string | null | undefined;
  source?: string | null | undefined;
  total: number | string | null;
};

/** What the invoice charges for travel: its travel lines, before anything is taken off. */
export function travelBilled(lines: readonly Totalled[]): number {
  let n = 0;
  for (const l of lines) if (l.kind === "travel") n += Number(l.total) || 0;
  return r2(Math.max(0, n));
}

/** What the leak call line among `lines` takes off: it is saved as a negative total. */
export function travelWaived(lines: readonly Totalled[]): number {
  let n = 0;
  for (const l of lines) if (isTravelWaiverLine(l)) n += -(Number(l.total) || 0);
  return r2(Math.max(0, n));
}

export type TravelChoice = "auto" | "declined" | null;
export const asTravelChoice = (v: unknown): TravelChoice =>
  v === "auto" || v === "declined" ? v : null;

/**
 * What the invoice's leak call line should take off after its lines changed, and what is kept
 * as the answer. "Charge the travel" stays whatever the invoice then bills. Otherwise the whole
 * travel comes off while the plan has a call for this invoice: one it already holds, or one
 * still unused. With no travel on the invoice, or no call left, nothing is taken and nothing
 * is kept, so a later change is looked at afresh.
 */
export function travelStep(a: {
  choice: TravelChoice;
  travel: number;
  calls: number;
  usedElsewhere: number;
}): { choice: TravelChoice; amount: number } {
  if (a.choice === "declined") return { choice: "declined", amount: 0 };
  if (!(a.travel > 0) || a.usedElsewhere >= a.calls) return { choice: null, amount: 0 };
  return { choice: "auto", amount: r2(a.travel) };
}

/** What the customer reads on the line. */
export const travelWaiverWords = (plan: unknown): string =>
  `${planName(plan)} plan: leak call, travel included in your plan`;

/** The line itself: listed on the customer's copy with its amount, not taxed, no cost. */
export function travelWaiverLine(
  plan: { id: string; plan: unknown },
  amount: number,
  sort: number,
) {
  const off = -r2(Math.max(0, amount));
  return {
    sort,
    kind: "other",
    description: travelWaiverWords(plan.plan),
    qty: 1,
    unit: "ea",
    rate: off,
    total: off,
    cost_rate: 0,
    cost_total: 0,
    on_date: null,
    source: travelLineSource(plan.id),
    taxable: false,
    rate_overridden: true,
    show_on_invoice: true,
    hide_price: false,
  };
}

/** Where a repair invoice stands with the plan's leak calls, for the plan box. */
export interface InvoiceTravel {
  plan_id: string;
  plan: string;
  /** The plan's calls a year with no travel charge. */
  calls: number;
  /** How many other live invoices hold one. */
  usedElsewhere: number;
  /** What this invoice charges for travel. */
  travel: number;
  /** What its leak call line takes off now. */
  waived: number;
  choice: TravelChoice;
}

/** "Leak call 1 of 2: the travel is not charged." and its fellows, for the plan box. */
export function travelBoxWords(t: InvoiceTravel): string {
  if (t.waived > 0)
    return `Leak call ${t.usedElsewhere + 1} of ${t.calls}: the travel on this invoice is not charged.`;
  if (t.choice === "declined")
    return `The travel on this invoice is charged. The plan has ${Math.max(0, t.calls - t.usedElsewhere)} of ${t.calls} leak calls with no travel charge left.`;
  if (t.usedElsewhere >= t.calls)
    return `The plan's ${t.calls} leak calls with no travel charge are used. The travel on this invoice is charged.`;
  return `This invoice has no travel to take off. The plan has ${t.calls - t.usedElsewhere} of ${t.calls} leak calls with no travel charge left.`;
}
export const TRAVEL_CHARGE_IT = "Charge the travel: not a leak call";
export const TRAVEL_USE_CALL = "Use a leak call: do not charge the travel";

/** On the property's page: "Leak calls with no travel charge: 1 of 2 used." */
export function travelStatusWords(calls: number, used: number): string {
  return `Leak calls with no travel charge: ${Math.min(used, calls)} of ${calls} used this plan year.`;
}
export const TRAVEL_INCLUDED_WORDS =
  "The plan includes leak calls with no travel charge each year.";
