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

export type AllowanceChoice = "applied" | "declined";
export const asAllowanceChoice = (v: unknown): AllowanceChoice | null =>
  v === "applied" || v === "declined" ? v : null;

const r2 = (n: number) => Math.round(Number((n * 100).toFixed(6))) / 100;
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

/** What the customer reads on the line. */
export const allowanceLineWords = (plan: unknown): string =>
  `${planName(plan)} plan: minor repairs included in your plan`;

/** The line itself: listed on the customer's copy with its amount, not taxed, no cost. */
export function allowanceLine(plan: { id: string; plan: unknown }, amount: number, sort: number) {
  const off = -r2(Math.max(0, amount));
  return {
    sort,
    kind: "other",
    description: allowanceLineWords(plan.plan),
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
}

export function invoiceAllowance(a: {
  plan_id: string;
  plan: string;
  allowance: number;
  usedElsewhere: number;
  lines: readonly Totalled[];
  choice: unknown;
}): InvoiceAllowance {
  const billable = billableBefore(a.lines);
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
  };
}

/** Finalise waits: nobody has answered, and there is something the plan could cover. */
export const allowanceUnanswered = (a: InvoiceAllowance | null): a is InvoiceAllowance =>
  !!a && a.choice === null && a.cap > 0;

const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const allowanceMoney = usd;

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
 * After the invoice's other lines changed (a save, a rebuild): the allowance line it had, held
 * to what the invoice now bills. `amount` 0 means the line goes and the question is open again.
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
