/**
 * The minor repairs a Roof Care plan includes each year (owner, Nov 19: "have that under the
 * plan status on the customer properties pages (think about how we can ensure this is followed)
 * I like the tick idea"). Pure.
 *
 * The plan keeps its yearly allowance from the day it is signed. A repair at that property is
 * invoiced as any repair is, at the standard rates. On that invoice the office answers one
 * question: does it use the plan? Yes puts one line on the invoice that takes the covered
 * amount off, and that amount counts against the plan. No is kept too, with who chose it.
 *
 * How it is made sure of:
 *  - The invoice is not finalised until the question is answered, while the plan has allowance
 *    left and the invoice has something to bill. The database refuses it as well.
 *  - The database never lets the lines of a plan add up to more than its allowance.
 *  - The property page shows what is used and what is left, with the invoices it went on.
 *
 * No amount lives here: the allowance is the plan's own, set from the price setup at sign-up.
 */
import { planName } from "@/lib/roof-care-plan";

/** The `source` of the line that takes covered repairs off an invoice. */
export const ALLOWANCE_SOURCE_PREFIX = "roof-care-allowance:";
export const allowanceLineSource = (planId: string): string =>
  `${ALLOWANCE_SOURCE_PREFIX}${planId}`;
export const isAllowanceLine = (l: { source?: string | null | undefined }): boolean =>
  !!l.source && l.source.startsWith(ALLOWANCE_SOURCE_PREFIX);
/** The plan a line takes from, or null. */
export const allowancePlanOf = (l: { source?: string | null | undefined }): string | null =>
  isAllowanceLine(l) ? l.source!.slice(ALLOWANCE_SOURCE_PREFIX.length) : null;

/**
 * Where the question stands (owner, Nov 19: "can we have the tick auto ticked if there is still
 * any allowance left?"):
 *  - "auto": nobody has chosen, so the plan covers all it can. The amount follows the invoice as
 *    its lines change.
 *  - "applied": a person typed the amount. It is held, and only ever cut to what the invoice
 *    still bills.
 *  - "declined": a person said this invoice does not use the plan.
 */
export type AllowanceChoice = "auto" | "applied" | "declined";
const r2 = (n: number) => Math.round(Number((n * 100).toFixed(6))) / 100;
export const asAllowanceChoice = (v: unknown): AllowanceChoice | null =>
  v === "auto" || v === "applied" || v === "declined" ? v : null;

/**
 * What the invoice's allowance line should be after its other lines changed, and whose choice
 * it then is. With nothing chosen the plan covers all it can (ticked by itself); a typed amount
 * is held and never grows; a "no" stays a "no". Amount 0 means no line.
 */
export function allowanceStep(a: {
  choice: AllowanceChoice | null;
  /** What the invoice's line takes now. */
  taken: number;
  /** The most it can take: what is left of the plan, and never more than the invoice bills. */
  cap: number;
}): { choice: AllowanceChoice | null; amount: number } {
  if (a.choice === "declined") return { choice: "declined", amount: 0 };
  if (a.choice === "applied") {
    const amount = r2(Math.max(0, Math.min(a.taken, a.cap)));
    if (amount > 0) return { choice: "applied", amount };
  }
  return a.cap > 0 ? { choice: "auto", amount: r2(a.cap) } : { choice: null, amount: 0 };
}

type Totalled = { source?: string | null | undefined; total: number | string | null };

/** What the allowance lines among `lines` take off: they are saved as negative totals. */
export function allowanceTaken(lines: readonly Totalled[]): number {
  let n = 0;
  for (const l of lines) if (isAllowanceLine(l)) n += -(Number(l.total) || 0);
  return r2(Math.max(0, n));
}

/** What the invoice bills before any allowance: its other lines, before tax. */
export function billableBefore(lines: readonly Totalled[]): number {
  let n = 0;
  for (const l of lines) if (!isAllowanceLine(l)) n += Number(l.total) || 0;
  return r2(n);
}

/**
 * The most an invoice can take: what is left of the plan's allowance, and never more than the
 * invoice's own work. Never below nothing.
 */
export function allowanceCap(a: { allowance: number; usedElsewhere: number; billable: number }) {
  return r2(Math.max(0, Math.min(a.allowance - a.usedElsewhere, a.billable)));
}

/**
 * What the allowance goes toward on an invoice of the plan's own inspection, where it is not a
 * repair: a storm inspection beyond the ones the plan includes (Nov 19, late), a return trip
 * charged after a visit we could not do (owner, Nov 20: "it comes out of the allocation if
 * there is allocation left"), or both. False on a repair's invoice.
 */
export type AllowanceToward = false | "inspection" | "trip" | "both";
export const allowanceToward = (a: {
  storm?: boolean | undefined;
  trip?: boolean | undefined;
}): AllowanceToward => (a.storm ? (a.trip ? "both" : "inspection") : a.trip ? "trip" : false);

/** What the customer reads on the line. `toward` true is the storm inspection, as it was. */
export const allowanceLineWords = (
  plan: unknown,
  toward: AllowanceToward | boolean = false,
): string =>
  toward === true || toward === "inspection"
    ? `${planName(plan)} plan: your minor repairs amount used toward this inspection`
    : toward === "trip"
      ? `${planName(plan)} plan: your minor repairs amount used toward the return trip`
      : toward === "both"
        ? `${planName(plan)} plan: your minor repairs amount used toward this inspection and the return trip`
        : `${planName(plan)} plan: minor repairs included in your plan`;

/** The line itself: listed on the customer's copy with its amount, not taxed, no cost. */
export function allowanceLine(
  plan: { id: string; plan: unknown },
  amount: number,
  sort: number,
  toward: AllowanceToward | boolean = false,
) {
  const off = -r2(Math.max(0, amount));
  return {
    sort,
    kind: "other",
    description: allowanceLineWords(plan.plan, toward),
    qty: 1,
    unit: "ea",
    rate: off,
    total: off,
    cost_rate: 0,
    cost_total: 0,
    on_date: null,
    source: allowanceLineSource(plan.id),
    taxable: false,
    rate_overridden: true,
    show_on_invoice: true,
    hide_price: false,
  };
}

/** Where an invoice stands with its property's plan. */
export interface InvoiceAllowance {
  plan_id: string;
  plan: string;
  /** The plan's yearly allowance. */
  allowance: number;
  /** Taken by the plan's other invoices (a void one gives its amount back). */
  used_elsewhere: number;
  /** Left for this invoice: the allowance less what the others took. */
  left: number;
  /** What this invoice bills before the allowance. */
  billable: number;
  /** The most this invoice can take. */
  cap: number;
  choice: AllowanceChoice | null;
  /** What this invoice takes now. */
  applied: number;
  /**
   * The invoice is a storm inspection's beyond the ones the plan includes (Nov 19, late): the
   * allowance goes toward the inspection's price and nothing else on the invoice.
   */
  storm?: boolean;
  /**
   * The invoice carries a return trip charged after a visit we could not do (Nov 20): the
   * allowance goes toward the trip, on the plan's own inspection's invoice.
   */
  trip?: boolean;
}

export function invoiceAllowance(a: {
  plan_id: string;
  plan: string;
  allowance: number;
  usedElsewhere: number;
  lines: readonly Totalled[];
  choice: unknown;
  /**
   * The billed storm inspection's own line, when the invoice is one's. With it or `tripSources`
   * the allowance goes toward those lines only. Both left out, the whole invoice is the repair.
   */
  towardSource?: string;
  /** The lines of the return trips charged on this invoice (roof-care-no-access.ts). */
  tripSources?: readonly string[];
}): InvoiceAllowance {
  const trips = a.tripSources ?? [];
  const toward =
    a.towardSource === undefined && trips.length === 0
      ? null
      : new Set([...(a.towardSource === undefined ? [] : [a.towardSource]), ...trips]);
  const billable =
    toward === null
      ? billableBefore(a.lines)
      : billableBefore(a.lines.filter((l) => !!l.source && toward.has(l.source)));
  const left = r2(Math.max(0, a.allowance - a.usedElsewhere));
  return {
    plan_id: a.plan_id,
    plan: a.plan,
    allowance: r2(a.allowance),
    used_elsewhere: r2(a.usedElsewhere),
    left,
    billable,
    cap: allowanceCap({ allowance: a.allowance, usedElsewhere: a.usedElsewhere, billable }),
    choice: asAllowanceChoice(a.choice),
    applied: allowanceTaken(a.lines),
    ...(a.towardSource === undefined ? {} : { storm: true }),
    ...(trips.length ? { trip: true } : {}),
  };
}

/**
 * Finalise waits: nothing is chosen and there is something the plan could cover. Since the tick
 * is given by itself this is rare (an invoice made some other way); the check stays.
 */
export const allowanceUnanswered = (a: InvoiceAllowance | null): a is InvoiceAllowance =>
  !!a && a.choice === null && a.cap > 0;

const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const allowanceMoney = usd;

/**
 * The last sentence of the invoice's Roof Care box while the plan is used by itself: what the
 * amount goes toward. A repair's invoice is told how to say it is not a minor repair.
 */
export const allowanceAutoNote = (a: Pick<InvoiceAllowance, "storm" | "trip">): string => {
  const toward = allowanceToward(a);
  return toward === "trip"
    ? "It goes toward the return trip, as the agreement says."
    : toward === "inspection"
      ? "It goes toward this storm inspection, as the agreement says."
      : toward === "both"
        ? "It goes toward this storm inspection and the return trip, as the agreement says."
        : "If this is not a minor repair, press Does not use the plan.";
};

/** The server's refusal; the database's trigger says the same in its own words. */
export const ALLOWANCE_UNANSWERED = (left: number): string =>
  `This property has a Roof Care plan with ${usd(left)} of minor repairs left this plan year. Choose in the Roof Care plan box on the invoice whether it uses the plan, then finalise.`;
export const ALLOWANCE_NOT_HERE =
  "This invoice has no Roof Care plan allowance to use. The property needs a plan in force that includes minor repairs, and the invoice has to be the customer's.";
export const ALLOWANCE_NOTHING_TO_TAKE =
  "There is nothing for the plan to cover on this invoice: the allowance is used up, or the invoice bills nothing yet.";

/** The amount asked for, held to the cap; blank means all of it. */
export function allowanceAmount(asked: number | null | undefined, cap: number): number {
  if (asked == null || !Number.isFinite(asked)) return r2(cap);
  return r2(Math.min(Math.max(0, asked), cap));
}

/**
 * After a rebuild threw the lines away: what the line it had still covers of the rebuilt
 * invoice, to carry it over before the step above is taken.
 */
export function allowanceAfterChange(taken: number, billable: number): number {
  return r2(Math.max(0, Math.min(taken, billable)));
}

/** "Minor repairs: $120.00 of $300.00 used this plan year. $180.00 left." (made-up amounts) */
export function allowanceStatusWords(p: { repair_allowance: number; allowance_used: number }) {
  const left = Math.max(0, p.repair_allowance - p.allowance_used);
  return `Minor repairs: ${usd(p.allowance_used)} of ${usd(p.repair_allowance)} used this plan year. ${usd(left)} left.`;
}
/** For a reader who does not see invoices: no amounts. */
export const ALLOWANCE_INCLUDED_WORDS = "Minor repairs are included in this plan each year.";
