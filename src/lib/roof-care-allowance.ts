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

/** A return trip's line counted at no more than the trip was worked out at. */
function heldToWorkedOut<T extends Totalled>(
  l: T,
  caps: Readonly<Record<string, number>> | undefined,
): Totalled {
  const cap = l.source ? caps?.[l.source] : undefined;
  if (cap == null || !Number.isFinite(cap)) return l;
  return { source: l.source, total: Math.min(Number(l.total) || 0, Math.max(0, cap)) };
}

/**
 * Under a return trip's line whose price was typed away from what the trip was worked out at
 * (owner, Nov 20: "this should be editable though no?"). Null when the two agree.
 */
export function tripWorkedOutWords(typed: number, worked: number | null | undefined) {
  if (worked == null || !Number.isFinite(worked)) return null;
  if (Math.abs(r2(typed) - r2(worked)) < 0.005) return null;
  return r2(typed) > r2(worked)
    ? `Worked out: ${usd(worked)}. The plan's minor repairs pay toward the trip up to that; the rest is the customer's.`
    : `Worked out: ${usd(worked)}.`;
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
  /**
   * What each return trip was worked out at, by its line's source (owner, Nov 20: break test,
   * number 5). The office may type another price on the line; the plan pays toward the trip no
   * more than this, and what is typed above it is the customer's. A trip left out is not held.
   */
  tripCaps?: Readonly<Record<string, number>>;
}): InvoiceAllowance {
  const trips = a.tripSources ?? [];
  const toward =
    a.towardSource === undefined && trips.length === 0
      ? null
      : new Set([...(a.towardSource === undefined ? [] : [a.towardSource]), ...trips]);
  const billable =
    toward === null
      ? billableBefore(a.lines)
      : billableBefore(
          a.lines
            .filter((l) => !!l.source && toward.has(l.source))
            .map((l) => heldToWorkedOut(l, a.tripCaps)),
        );
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

/**
 * A draft's plan lines worked out again (owner, Nov 20: break test, number 2). A draft kept the
 * credit it was given when it was made or last saved. When another invoice of the plan was then
 * deleted or voided, the credit that came free stayed off this draft and the customer was billed
 * for it; a leak call that came free was missed the same way. The lines are now worked out again
 * when the draft is opened and when it is finalised, and the office is told what changed.
 *
 * What a person chose by hand is kept as it always was (allowanceStep, travelStep): a "does not
 * use the plan" stays, a typed amount is held and never raised, "charge the travel" stays.
 */
export interface PlanLinesStand {
  /** What the minor repairs line takes off the invoice. */
  credit: number;
  /** The travel the leak call line takes off the invoice. */
  travel: number;
  /** The invoice's total. */
  total: number;
}

/** Why the lines moved, as far as it can be read once they have: the plan as it now stands. */
export interface PlanLinesWhy {
  /** Left of the plan's minor repairs for this invoice (the others' taken off). */
  left?: number | null;
  /** What this invoice bills before the credit. */
  billable?: number | null;
}

/** Did the amounts move? A cent is the smallest change there is. */
export const planLinesMoved = (before: PlanLinesStand, after: PlanLinesStand): boolean =>
  r2(before.credit) !== r2(after.credit) || r2(before.travel) !== r2(after.travel);

/**
 * What changed on a draft when its plan lines were worked out again, in plain words for the
 * office; null when no amount moved. The amounts are the invoice's own.
 */
export function planLinesChangeWords(
  before: PlanLinesStand,
  after: PlanLinesStand,
  why: PlanLinesWhy = {},
): string | null {
  if (!planLinesMoved(before, after)) return null;
  const out: string[] = [];
  const b = r2(before.credit);
  const a = r2(after.credit);
  if (a > b) {
    out.push(
      b > 0
        ? `The Roof Care plan now takes ${usd(a)} off this invoice for minor repairs. It took ${usd(b)} before.`
        : `The Roof Care plan now takes ${usd(a)} off this invoice for minor repairs. It took nothing before.`,
      "More of the plan's minor repairs amount is free: another invoice that used it was deleted, voided or changed.",
    );
  } else if (a < b) {
    out.push(
      a > 0
        ? `The Roof Care plan now takes ${usd(a)} off this invoice for minor repairs. It took ${usd(b)} before.`
        : `The Roof Care plan no longer takes anything off this invoice for minor repairs. It took ${usd(b)} before.`,
    );
    const usedFirst = why.left != null && r2(why.left) < b;
    const billsLess = why.billable != null && r2(why.billable) < b;
    out.push(
      usedFirst
        ? "Another invoice of this plan used part of the minor repairs amount first."
        : billsLess
          ? "This invoice bills less than the plan was covering."
          : "The plan has less left for this invoice than it had.",
    );
  }
  const tb = r2(before.travel);
  const ta = r2(after.travel);
  if (ta > tb && !(tb > 0))
    out.push(
      `The travel on this invoice, ${usd(ta)}, is no longer charged: the plan has a leak call free again.`,
    );
  else if (ta < tb && !(ta > 0))
    out.push(
      `The travel on this invoice, ${usd(tb)}, is charged again: the plan's leak calls are used by its other invoices, or the invoice has no travel now.`,
    );
  else if (ta !== tb)
    out.push(
      `The travel taken off for the plan's leak call is now ${usd(ta)}. It was ${usd(tb)}: it follows the travel on the invoice.`,
    );
  out.push(`The invoice total is now ${usd(after.total)}. It was ${usd(before.total)}.`);
  return out.join(" ");
}

/** Said after the change when a Finalise was stopped for it: nothing is final yet. */
export const PLAN_LINES_LOOK_AGAIN =
  "The invoice is not final yet. Look it over, then press Finalise again.";

// ── The plan a ticket's work belongs to (owner, Nov 20: break test, number 3) ────────────────
//
// One rule for the minor repairs credit and for Roof Guard's leak calls with no travel charge:
// work dated inside a plan's year gets what that plan gave, whenever the invoice is made, also
// after the plan has ended. Work dated after the plan's last day gets nothing of it. Until now
// both asked only whether a plan was in force on the day the invoice was opened, so an invoice
// made after the year ended for work done inside it got nothing new, kept a credit nobody could
// untick, and lost its leak call when it was built again.
//
// The work's date is read off the ticket: the day it was completed; with none, the day the
// technician was on site; with none, the day it was scheduled; with none, today. Days are the
// office's (Eastern).

export const PLAN_WORK_TZ = "America/New_York";

/** The office's day of a moment: "2026-12-10". */
export function officeDay(at: string | Date): string | null {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PLAN_WORK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export type WorkDayFrom = "completed" | "on_site" | "scheduled" | "today";
export interface WorkDay {
  day: string;
  from: WorkDayFrom;
}
const YMD_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The day a ticket's work was done, and which of the ticket's dates said so. */
export function workDay(
  job: {
    completed_at?: string | null | undefined;
    on_site_at?: string | null | undefined;
    scheduled_date?: string | null | undefined;
  },
  today: string,
): WorkDay {
  const done = job.completed_at ? officeDay(job.completed_at) : null;
  if (done) return { day: done, from: "completed" };
  const there = job.on_site_at ? officeDay(job.on_site_at) : null;
  if (there) return { day: there, from: "on_site" };
  if (job.scheduled_date && YMD_ONLY.test(job.scheduled_date))
    return { day: job.scheduled_date, from: "scheduled" };
  return { day: today, from: "today" };
}

/** What of a plan this rule reads. Dates are days ("2026-01-01") or missing. */
export interface PlanYear {
  status: string;
  starts_on?: string | null | undefined;
  signed_on?: string | null | undefined;
  renews_on?: string | null | undefined;
  ended_on?: string | null | undefined;
}

/** The first day of the plan's year: the day it started; for an older plan, the day it was signed. */
export const planFirstDay = (p: PlanYear): string | null => p.starts_on || p.signed_on || null;

/** The last day of the plan's year: the day it ended when that came first, else its last day. */
export function planLastDay(p: PlanYear): string | null {
  const year = p.renews_on || null;
  if (p.status !== "ended") return year;
  const ended = p.ended_on || null;
  if (!ended) return year;
  return year && year < ended ? year : ended;
}

/** Is `day` inside the plan's year, first and last day included? */
export function planHoldsDay(p: PlanYear, day: string): boolean {
  const first = planFirstDay(p);
  const last = planLastDay(p);
  return !!first && !!last && first <= day && day <= last;
}

/**
 * May this plan give anything to work dated `day`? A plan waiting for its payment never. A plan
 * that has ended: only work dated inside its year. A plan in force: work up to its last day
 * (work dated before it started is covered while the plan is in force, as it always was).
 */
export function planCoversDay(p: PlanYear, day: string): boolean {
  if (p.status === "ended") return planHoldsDay(p, day);
  if (p.status !== "active") return false;
  const last = planLastDay(p);
  return !last || day <= last;
}

/**
 * The plan a day's work belongs to, of the plans at its property: the one whose year holds the
 * day (the one in force first, should two hold it); failing that, the plan in force when the
 * work is dated before it started. Null when no plan covers the day.
 */
export function planForWork<T extends PlanYear>(plans: readonly T[], day: string): T | null {
  const inForce = plans.filter((p) => p.status === "active");
  const ended = plans.filter((p) => p.status === "ended");
  return (
    inForce.find((p) => planHoldsDay(p, day)) ??
    ended.find((p) => planHoldsDay(p, day)) ??
    inForce.find((p) => planCoversDay(p, day)) ??
    null
  );
}

/**
 * A plan that ended early with a refund (owner, Nov 20). The refund was worked from what the
 * plan had given by then, so what it gives afterwards must not be handed back twice:
 *  - while the refund is not sent, a later credit lowers the refund owed by the same amount
 *    (the database does it, roof_care_refund_restep);
 *  - once the refund is sent, the plan gives nothing more than it had given when it ended.
 */
export interface PlanRefund {
  status: string;
  refund_due?: number | string | null | undefined;
  refund_sent_on?: string | null | undefined;
  /** What the refund was worked from: { repairs, travel, confirmed, … }. */
  refund_worked?: unknown;
}

/** Has this plan's refund been sent? Then what it gave is closed at what the refund counted. */
export const planRefundSent = (p: PlanRefund): boolean =>
  p.status === "ended" && !!p.refund_sent_on && Number(p.refund_due) > 0;

const workedPart = (p: PlanRefund, key: "repairs" | "travel"): number => {
  const w = p.refund_worked;
  const n = w && typeof w === "object" ? Number((w as Record<string, unknown>)[key]) : NaN;
  return Number.isFinite(n) && n > 0 ? r2(n) : 0;
};

/** The plan's minor repairs as this rule counts them: closed at what the sent refund counted. */
export function planAllowanceNow(p: PlanRefund & { repair_allowance: number | string | null }) {
  const allowance = Math.max(0, Number(p.repair_allowance) || 0);
  return planRefundSent(p) ? Math.min(allowance, workedPart(p, "repairs")) : r2(allowance);
}

/** The leak call travel the plan had taken off when its sent refund was worked. */
export const planTravelAtRefund = (p: PlanRefund): number | null =>
  planRefundSent(p) ? workedPart(p, "travel") : null;

/** Why a ticket's invoice gets nothing of a plan, for the plan box and for a refusal. */
export const PLAN_WORK_AFTER = (plan: unknown, last: string, day: string): string =>
  `This ticket's work is dated ${day}, after the ${planName(plan)} plan's last day (${last}). Nothing of the plan comes off this invoice.`;
