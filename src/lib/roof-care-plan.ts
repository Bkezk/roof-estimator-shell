/**
 * Roof Care plans, step 2: a property's plan and its inspections (owner, Nov 18;
 * docs/roof-care-plans.md). Pure: what the screens say about a plan. The rules themselves are
 * the database's (20261118240000_roof_care_plans.sql): the price, one plan per property, the
 * two windows, the push-back limit. What is here is their twin for the screen, so a form can
 * say what will happen before it is pressed. No prices live here.
 */
import { daysBetween, longDay } from "@/lib/followup-rules";
import { PLAN_KEYS, PLAN_NAMES, type PlanKey } from "@/lib/roof-care-price";
import { plusDays } from "@/lib/working-days";

// "carried": an inspection owed from last plan year, brought into the renewal for 60 days.
export const VISIT_KINDS = ["visit1", "visit2", "storm", "carried"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];
export const FIRST_VISIT_CHOICES = ["now", "days", "window"] as const;
export type FirstVisit = (typeof FIRST_VISIT_CHOICES)[number];

/** A push-back of more than this many days past the first date needs a manager and a reason. */
export const PUSH_LIMIT_DAYS = 30;
/** The second inspection is at least this long after the first. */
export const SECOND_VISIT_GAP_DAYS = 120;
/** The second inspection's window is never shorter than this (owner, Nov 19). */
export const SECOND_WINDOW_MIN_DAYS = 14;
/** A ticket is made this many days before its inspection is due. */
export const TICKET_LEAD_DAYS = 14;

/** The two buttons' names (owner, Nov 18). */
export const CARE_PLAN_LABEL = "Care Plan";
export const ADDITIONAL_SERVICES_LABEL = "Additional Services";

/** The cache key of a property's plans. */
export const roofCarePlansKey = (siteId: string) => ["roof-care-plans", siteId] as const;

export const asPlanKey = (v: unknown): PlanKey | null =>
  (PLAN_KEYS as readonly string[]).includes(String(v)) ? (v as PlanKey) : null;
export const planName = (v: unknown): string => {
  const k = asPlanKey(v);
  return k ? PLAN_NAMES[k] : "Roof Care plan";
};

/** The inspection ticket of a visit, as far as the reader may see it. */
export interface VisitTicket {
  id: string;
  number: number;
  stage: string;
  scheduled_date: string | null;
  completed_at: string | null;
  invoice_id: string | null;
}

export interface PlanVisit {
  id: string;
  kind: VisitKind;
  due_from: string;
  due_by: string;
  first_due_by: string;
  amount: number;
  push_reason: string | null;
  pushed_by_name: string | null;
  /** A push-back of it was at the customer's asking. */
  customer_asked: boolean;
  /** A carried inspection not done in its 60 days: the day it was lost. */
  lost_on: string | null;
  ticket: VisitTicket | null;
  /**
   * Its share of the plan is on a live invoice (Nov 19). Null for a reader who does not see
   * invoices: nothing is said to them either way.
   */
  billed: boolean | null;
}

/** An invoice that took from the plan's minor repairs allowance. */
export interface AllowanceUse {
  invoice_id: string;
  number: string;
  amount: number;
}

/** The plan's own invoice for the year, for a reader who sees invoices. */
export interface PlanInvoiceRef {
  id: string;
  number: string;
  status: string;
  total: number;
  paid_amount: number;
}

/** How the customer pays for the plan year (owner, Nov 19: "by check or card either one"). */
export const PAY_METHODS = ["check", "card"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const asPayMethod = (v: unknown): PayMethod | null =>
  v === "check" || v === "card" ? v : null;
export const PAY_METHOD_WORDS: Record<PayMethod, string> = { check: "Check", card: "Card" };
export const PAY_METHOD_NEEDED = "Pick how they are paying: by check or by card";
/** "Paying by check (#1042)." */
export function payWords(method: PayMethod | null, note: string | null): string {
  if (!method) return "";
  const n = (note ?? "").trim();
  return `Paying by ${PAY_METHOD_WORDS[method].toLowerCase()}${n ? ` (${n})` : ""}.`;
}
export const PAY_CARD_NOTE =
  "A card cannot be charged from here yet. The office takes the card and marks the invoice paid.";

/** The refund of a plan that was ended early. */
export interface PlanRefund {
  due: number;
  sent_on: string | null;
  ref: string | null;
}

export type PlanStatus = "awaiting_payment" | "active" | "ended";
export const asPlanStatus = (v: unknown): PlanStatus =>
  v === "ended" ? "ended" : v === "awaiting_payment" ? "awaiting_payment" : "active";

export interface RoofCarePlan {
  id: string;
  account_id: string;
  site_id: string;
  plan: PlanKey;
  /** Signed and waiting for its payment, in force, or over. */
  status: PlanStatus;
  /**
   * Paid for the year before it starts (owner, Nov 19). False for a plan signed before that:
   * billed half at each inspection.
   */
  pay_first: boolean;
  /** "RC-1001" is plan 1001; null for a plan signed before plans were numbered. */
  plan_number: number | null;
  /** What was chosen for the first inspection, counted from the payment. */
  first_visit: FirstVisit;
  first_days: number | null;
  /** The first day of the plan year: the day the payment was received. */
  starts_on: string | null;
  /**
   * The plan's invoice for the year: null for a reader who does not see invoices, and when
   * there is none yet.
   */
  invoice: PlanInvoiceRef | null;
  /** How the customer said they pay, at the sign-up; null for a plan signed before that was asked. */
  pay_method: PayMethod | null;
  /** A note with it: a check's number. */
  pay_note: string | null;
  /** Repair calls a year with no travel charge (Roof Guard's leak calls); 0 for a plan with none. */
  free_travel_calls: number;
  /** How many invoices hold one; null for a reader who does not see invoices. */
  free_travel_used: number | null;
  /**
   * The refund confirmed when the plan was ended early; null when there is none, and for a
   * reader who does not see invoices.
   */
  refund: PlanRefund | null;
  /** The plan year this one renews; null for a plan signed up new. */
  renewed_from: string | null;
  /** What was decided about an inspection still owed when the renewal was made. */
  renewal_choice: RenewalChoice | null;
  /** What was taken off the renewal for inspections we did not get to. */
  renewal_credit: number;
  signed_on: string;
  renews_on: string;
  roof_sqft: number;
  price: number;
  price_estimated: boolean;
  /** The minor repairs the plan includes each year; 0 for a plan with none. */
  repair_allowance: number;
  /** What invoices have taken from it; null for a reader who does not see invoices. */
  allowance_used: number | null;
  allowance_uses: AllowanceUse[];
  agreed_by: string;
  sold_by_name: string;
  notes: string;
  ended_on: string | null;
  ended_reason: string | null;
  visits: PlanVisit[];
}

// ── The two windows ─────────────────────────────────────────────────────────────────────────

export interface Window {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Mid March to mid May, and mid October to the end of December (owner, Nov 18): every window
 * that has not ended before `from`, soonest first. The database's roof_care_windows().
 */
export function windowsFrom(from: string): Window[] {
  const y0 = Number(from.slice(0, 4));
  const out: Window[] = [];
  for (let y = y0; y <= y0 + 2; y++) {
    out.push({ from: ymd(y, 3, 15), to: ymd(y, 5, 15) });
    out.push({ from: ymd(y, 10, 15), to: ymd(y, 12, 31) });
  }
  return out.filter((w) => w.to >= from).sort((a, b) => a.from.localeCompare(b.from));
}

/** The next window to open after `today`: what "wait for the next window" means. */
export function nextWindow(today: string): Window {
  return windowsFrom(today).find((w) => w.from > today)!;
}

/** "Mar 15 to May 15, 2027". */
export function windowWords(w: Window): string {
  const a = longDay(w.from);
  const b = longDay(w.to);
  return a.slice(-4) === b.slice(-4) ? `${a.slice(0, -6)} to ${b}` : `${a} to ${b}`;
}

/** "Due Nov 28, 2026" for a set day, "Due Mar 15 to May 15, 2027" for a window. */
export function dueWords(v: Pick<PlanVisit, "due_from" | "due_by">): string {
  return v.due_from === v.due_by
    ? `Due ${longDay(v.due_by)}`
    : `Due ${windowWords({ from: v.due_from, to: v.due_by })}`;
}

/**
 * When the two inspections of a new plan fall, for the sign-up form to say before it is
 * pressed. The same sum as roof_care_sign_up: the first is today, in `days` days, or in the next
 * window to open; the second is in the first window still open four months after the first, and
 * inside the plan year when it fits.
 */
export function planDates(
  today: string,
  first: FirstVisit,
  days: number | null,
): { first: Window; second: Window; renews: string } | null {
  let v1: Window;
  if (first === "now") v1 = { from: today, to: today };
  else if (first === "days") {
    if (days == null || !Number.isInteger(days) || days < 1 || days > 365) return null;
    const d = plusDays(today, days);
    v1 = { from: d, to: d };
  } else v1 = nextWindow(today);
  const earliest = plusDays(v1.from, SECOND_VISIT_GAP_DAYS);
  // At least two weeks of the window left, else the next one (owner, Nov 19: a sign-up in
  // mid January used to leave May 15 alone for the second inspection).
  const w = windowsFrom(earliest)
    .map((x) => ({ from: x.from > earliest ? x.from : earliest, to: x.to }))
    .find((x) => daysBetween(x.from, x.to) >= SECOND_WINDOW_MIN_DAYS - 1)!;
  const year = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  // Feb 29 has no day a year on; the database lands on Feb 28.
  const renews = /^\d{4}-02-29$/.test(year) ? `${year.slice(0, 4)}-02-28` : year;
  const from = w.from;
  let to = w.to;
  // Inside the plan year when it fits, and never under two weeks. The plan year is twelve
  // months and no longer (owner, Nov 19: "one year of coverage … and the benefits dont roll
  // over"): an inspection that ends after it does not move the renewal, it is owed at renewal.
  if (from <= renews) {
    const floor = plusDays(from, SECOND_WINDOW_MIN_DAYS - 1);
    const cap = renews > floor ? renews : floor;
    to = to < cap ? to : cap;
  }
  return { first: v1, second: { from, to }, renews };
}

// ── What a visit is doing ───────────────────────────────────────────────────────────────────

/** Stages at which the inspection has been done on the roof. */
const DONE_STAGES = ["done", "authorized", "invoiced", "closed"];
/** Stages at which its invoice should exist: it is made when the ticket is authorized. */
const BILLED_BY_STAGES = ["authorized", "invoiced", "closed"];

/**
 * Done and signed off, with its share of the plan on no invoice (owner, Nov 19: "Go with 6"):
 * the draft made at Authorized was deleted or voided, and nothing else said so. Only for a
 * reader who sees invoices, and only for an inspection that bills something.
 */
export function visitUnbilled(v: PlanVisit): boolean {
  return (
    v.billed === false && v.amount > 0 && !!v.ticket && BILLED_BY_STAGES.includes(v.ticket.stage)
  );
}
export const VISIT_UNBILLED_WORDS = "Not invoiced";

export type VisitState = "done" | "late" | "ticket" | "waiting" | "lost";

/**
 * Done (the ticket is Done or further), lost (carried from last plan year and not done in its
 * 60 days), late (not done and past its last day), a ticket is out for it, or it is waiting for
 * its time.
 */
export function visitState(v: PlanVisit, today: string): VisitState {
  if (v.ticket && DONE_STAGES.includes(v.ticket.stage)) return "done";
  if (v.lost_on) return "lost";
  if (today > v.due_by) return "late";
  return v.ticket ? "ticket" : "waiting";
}

export const VISIT_LABEL: Record<VisitKind, string> = {
  visit1: "Inspection 1",
  visit2: "Inspection 2",
  storm: "Storm inspection",
  carried: "Inspection owed from last plan year",
};

/** How many of the plan's inspections are done: the two visits, and the storm inspections. */
export function visitsDone(
  plan: Pick<RoofCarePlan, "visits">,
  today: string,
): { visits: number; storm: number } {
  let visits = 0;
  let storm = 0;
  for (const v of plan.visits) {
    if (visitState(v, today) !== "done") continue;
    if (v.kind === "storm") storm++;
    // One carried from last plan year is not one of this year's two.
    else if (v.kind !== "carried") visits++;
  }
  return { visits, storm };
}

/** "1 of 2 inspections done", with the storm inspection when there is one. */
export function visitsDoneWords(plan: Pick<RoofCarePlan, "visits">, today: string): string {
  const d = visitsDone(plan, today);
  const base = `${d.visits} of 2 inspections done`;
  if (!d.storm) return base;
  return `${base}, and ${d.storm === 1 ? "a storm inspection" : `${d.storm} storm inspections`}`;
}

/**
 * The plan year ran on because an inspection was pushed past it. The year starts at the payment
 * for a plan paid first, and at the sign-up for an older one.
 */
export function runsLate(
  p: Pick<RoofCarePlan, "signed_on" | "renews_on"> & { starts_on?: string | null },
): boolean {
  const from = p.starts_on || p.signed_on;
  const year = `${Number(from.slice(0, 4)) + 1}${from.slice(4)}`;
  return p.renews_on > year;
}

// ── A plan whose year is over (owner, Nov 19) ───────────────────────────────────────────────
//
// "the agreement is for one year of coverage …, and the benefits dont roll over". The morning
// run ends a plan on its renewal date as "Expired" (roof_care_expire). What it included stops.
// An inspection not done is still owed, and the plan can still be renewed.

/** What the database writes as the reason. */
export const EXPIRED_REASON = "Expired";
export const isExpired = (p: { status: string; ended_reason?: string | null }): boolean =>
  p.status === "ended" && p.ended_reason === EXPIRED_REASON;

/** "Expired Dec 19, 2026. The minor repairs and leak calls it included have stopped." */
export function expiredWords(p: Pick<RoofCarePlan, "ended_on" | "renews_on">): string {
  return `Expired ${longDay(p.ended_on || p.renews_on)}. What the plan included has stopped. It can be renewed: the new plan year starts the day the renewal is paid.`;
}

/** An expired plan is listed in Needs attention for this long. */
export const EXPIRED_LISTED_DAYS = 60;

/**
 * The badge on a property: "Roof Guard", "awaiting payment" for one signed and not yet paid,
 * and "ended" for a plan that is over.
 */
export function planBadge(
  p: Pick<RoofCarePlan, "plan" | "status"> & { ended_reason?: string | null },
): string {
  if (isExpired(p)) return `${planName(p.plan)} (expired)`;
  if (p.status === "ended") return `${planName(p.plan)} (ended)`;
  if (p.status === "awaiting_payment") return `${planName(p.plan)} (awaiting payment)`;
  return planName(p.plan);
}

// ── Paid for the year before it starts (owner, Nov 19) ──────────────────────────────────────
//
// "i think we are going to do payment up front rather than at time of service … so we dont have
// to fight apathy", and "they can pay up front by check". A plan is signed, then waits for its
// payment. One invoice for the year belongs to the plan. The day it is marked paid in full the
// plan year starts and the inspections are dated. The database does all of it
// (20261119600000_roof_care_pay_first.sql); these are the words.

export const PLAN_NUMBER_PREFIX = "RC-";
/** "RC-1001": the plan's number, and its invoice's. */
export const planNumberLabel = (n: number): string => `${PLAN_NUMBER_PREFIX}${n}`;
export const isPlanInvoiceNumber = (display: string | null | undefined): boolean =>
  !!display && display.startsWith(PLAN_NUMBER_PREFIX);

export const AWAITING_PAYMENT_WORDS = "Awaiting payment";
export const AWAITING_PAYMENT_NOTE =
  "The plan starts the day its payment is received. No inspection is made before that.";
export const PLAN_NO_INVOICE = "No invoice has been made for this plan yet.";
export const PLAN_MAKE_INVOICE = "Make the invoice";
export const PLAN_INVOICE_EXISTS = "This plan already has an invoice.";
export const PLAN_INVOICE_NOT_AWAITING =
  "Only a plan that is waiting for its payment gets an invoice made for it.";

/** "Roof Care plan, one year: two inspections with photo reports". The invoice's one line. */
export function planInvoiceLineWords(plan: unknown): string {
  return `${planName(plan)} plan, one year: two inspections with a photo report after each`;
}

/** When the first inspection is, counted from the payment: for the plan that is waiting. */
export function firstVisitWords(first: FirstVisit, days: number | null): string {
  if (first === "now") return "First inspection: as soon as the payment is received.";
  if (first === "days")
    return `First inspection: ${days ?? 0} ${days === 1 ? "day" : "days"} after the payment is received.`;
  return "First inspection: in the next inspection window after the payment is received.";
}

/** Under the dates on the sign-up: they move with the payment. */
export const DATES_FROM_PAYMENT =
  "These dates are for a payment received today. They are counted from the day it is received.";

// ── The refund when a plan ends early (owner, Nov 19) ───────────────────────────────────────
//
// "a share for inspections not done, if we did one half is refunded", and "i like the repairs
// coming off a refund rule". The database works it (roof_care_refund_worked): the share of what
// was paid for the inspections not done, less the minor repairs the plan already covered, never
// below nothing. A manager confirms the amount when ending the plan. These are the words.

export interface RefundWorked {
  paid: number;
  inspections_done: number;
  share: number;
  repairs: number;
  refund: number;
}

/** The database's answer, or null when it is not one. */
export function readRefundWorked(x: unknown): RefundWorked | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const n = (k: string) => {
    const v = Number(o[k]);
    return Number.isFinite(v) ? v : null;
  };
  const paid = n("paid");
  const done = n("inspections_done");
  const share = n("share");
  const repairs = n("repairs");
  const refund = n("refund");
  if (paid == null || done == null || share == null || repairs == null || refund == null)
    return null;
  return { paid, inspections_done: done, share, repairs, refund };
}

const cents = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The sum, a line at a time, as the End plan box shows it. */
export function refundLines(w: RefundWorked): string[] {
  if (!(w.paid > 0)) return ["Nothing was paid for this plan year, so there is nothing to refund."];
  const out = [
    `Paid for the year: ${cents(w.paid)}`,
    `Inspections done: ${w.inspections_done} of 2`,
    `Share for the inspections not done: ${cents(w.share)}`,
  ];
  if (w.repairs > 0) out.push(`Minor repairs the plan already covered: ${cents(w.repairs)} off`);
  out.push(`Refund: ${cents(w.refund)}`);
  return out;
}

/** "Refund owed: $650.00." / "Refund of $650.00 sent Nov 20, 2026 (check 2001)." */
export function refundStatusWords(r: PlanRefund): string {
  if (!(r.due > 0)) return "";
  if (!r.sent_on) return `Refund owed: ${cents(r.due)}.`;
  return `Refund of ${cents(r.due)} sent ${longDay(r.sent_on)}${r.ref ? ` (${r.ref})` : ""}.`;
}
export const REFUND_MARK_SENT = "Mark the refund sent";
export const REFUND_BAD_AMOUNT = "Type the refund, 0 or more, and no more than was paid";

// ── Renewal (owner, Nov 19) ─────────────────────────────────────────────────────────────────
//
// A plan is one plan year. In its last 60 days the office renews it: the renewal is next year's
// plan, priced again today, signed and waiting for its payment. An inspection still owed then is
// the office's call, with the push-back reasons shown: "half off is the default unless a reason
// says the customer asked". The database does all of it (20261119800000_roof_care_renewal.sql);
// these are the words.

/** A plan can be renewed, and is listed in Needs attention, this many days before its renewal. */
export const RENEWAL_OPEN_DAYS = 60;
/** An inspection the customer kept us from stays owed this many days into the new year. */
export const CARRY_DAYS = 60;

export const RENEWAL_CHOICES = ["half_off", "full"] as const;
export type RenewalChoice = (typeof RENEWAL_CHOICES)[number];
export const asRenewalChoice = (v: unknown): RenewalChoice | null =>
  v === "half_off" || v === "full" ? v : null;

/** The renewal can be made today: the plan is in the last 60 days of its year, or past it. */
export function renewalOpen(p: Pick<RoofCarePlan, "renews_on">, today: string): boolean {
  return daysBetween(today, p.renews_on) <= RENEWAL_OPEN_DAYS;
}

/** "Renews Jan 10, 2028, in 43 days." / "Was due to renew Jan 10, 2028, 5 days ago." */
export function renewsWords(p: Pick<RoofCarePlan, "renews_on">, today: string): string {
  const n = daysBetween(today, p.renews_on);
  const day = longDay(p.renews_on);
  if (n > 1) return `Renews ${day}, in ${n} days.`;
  if (n === 1) return `Renews ${day}, tomorrow.`;
  if (n === 0) return `Renews today, ${day}.`;
  return `Was due to renew ${day}, ${-n} ${n === -1 ? "day" : "days"} ago.`;
}

export const RENEW_LABEL = "Renew for another year";
export const RENEWAL_WORDS = "Renewal";
export const RENEWAL_CHOICE_NEEDED = "Pick what happens with the inspection that is still owed";

/** An inspection still owed when the plan is renewed, as the Renew box lists it. */
export interface OwedInspection {
  kind: VisitKind;
  due_by: string;
  push_reason: string | null;
  customer_asked: boolean;
  /** Its last day has gone by. One still inside its window is not late: it is still to do. */
  late: boolean;
}

/** Why the Renew box leans the way it does. */
export type RenewalReason = "customer" | "not_late" | "late";

/** What renewing a plan today would be: the database's answer (roof_care_renewal_offer). */
export interface RenewalOffer {
  renews_on: string;
  /** The first day it can be renewed. */
  opens_on: string;
  open: boolean;
  /** The yearly price today, and what this year was sold at. */
  price: number;
  price_was: number;
  owed: OwedInspection[];
  /** Which way the rule leans; null with nothing owed. */
  default_choice: RenewalChoice | null;
  /** Why: the customer asked, nothing is late yet, or it is late and ours. */
  default_reason: RenewalReason | null;
  /** What "half off" takes off: half the price for each inspection owed. */
  credit_if_half_off: number;
  /** The last day an inspection charged in full stays owed, for a payment made today. */
  carried_until: string;
  pay_method: PayMethod | null;
  has_renewal: boolean;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The database's answer, or null when it is not one. */
export function readRenewalOffer(x: unknown): RenewalOffer | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const day = (k: string) => (typeof o[k] === "string" && YMD_RE.test(o[k]) ? o[k] : null);
  const amount = (k: string) => {
    const v = Number(o[k]);
    return Number.isFinite(v) ? v : null;
  };
  const renews_on = day("renews_on");
  const opens_on = day("opens_on");
  const carried_until = day("carried_until");
  const price = amount("price");
  const price_was = amount("price_was");
  const credit = amount("credit_if_half_off");
  if (!renews_on || !opens_on || !carried_until || price == null || price_was == null) return null;
  if (credit == null || !Array.isArray(o["owed"])) return null;
  const owed: OwedInspection[] = [];
  for (const raw of o["owed"]) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const kind = (VISIT_KINDS as readonly string[]).includes(String(r["kind"]))
      ? (r["kind"] as VisitKind)
      : null;
    if (!kind || typeof r["due_by"] !== "string") return null;
    owed.push({
      kind,
      due_by: r["due_by"],
      push_reason: typeof r["push_reason"] === "string" ? r["push_reason"] : null,
      customer_asked: r["customer_asked"] === true,
      late: r["late"] === true,
    });
  }
  return {
    renews_on,
    opens_on,
    open: o["open"] === true,
    price,
    price_was,
    owed,
    default_choice: owed.length ? asRenewalChoice(o["default_choice"]) : null,
    default_reason: owed.length
      ? o["default_reason"] === "customer" || o["default_reason"] === "not_late"
        ? o["default_reason"]
        : "late"
      : null,
    credit_if_half_off: credit,
    carried_until,
    pay_method: asPayMethod(o["pay_method"]),
    has_renewal: o["has_renewal"] === true,
  };
}

/** "1 inspection is still owed" / "Both inspections are still owed". */
export function owedWords(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "1 inspection is still owed" : "Both inspections are still owed";
}

/** The two answers, in the Renew box. */
export function renewalChoiceWords(
  choice: RenewalChoice,
  offer: Pick<RenewalOffer, "credit_if_half_off" | "price" | "carried_until" | "owed">,
): string {
  const one = offer.owed.length === 1;
  if (choice === "half_off") {
    const left = Math.max(0, Math.round((offer.price - offer.credit_if_half_off) * 100) / 100);
    return left > 0
      ? `We did not get there. Take ${cents(offer.credit_if_half_off)} off the renewal: the customer pays ${cents(left)}. The inspection is dropped.`
      : "We did not get there. The renewal is at no charge, and a manager makes it. The inspections are dropped.";
  }
  return `The customer kept us off the roof. Charge the renewal in full. ${one ? "The inspection stays" : "The inspections stay"} owed until ${longDay(offer.carried_until)}, then ${one ? "it is" : "they are"} lost.`;
}

/**
 * Why the Renew box leans the way it does. A renewal is made up to 60 days ahead, when the
 * year's second inspection is often still inside its own window: that one is still to do, and
 * nothing comes off for it.
 */
export function renewalDefaultWords(
  offer: Pick<RenewalOffer, "default_choice" | "default_reason">,
): string {
  if (!offer.default_choice) return "";
  if (offer.default_reason === "customer")
    return "A push-back of it was marked as the customer asking, so charging in full is picked.";
  if (offer.default_reason === "not_late")
    return "It is not late yet, so charging in full is picked: it can still be done on time.";
  return "It is late and no push-back says the customer asked, so half off is picked.";
}

/** "Price for the year: $2,100" and, when it moved, what this year was. */
export function renewalPriceWords(offer: Pick<RenewalOffer, "price" | "price_was">): string {
  const now = wholeDollars(offer.price);
  return Math.round(offer.price) === Math.round(offer.price_was)
    ? `Price for the year: ${now}, the same as this year.`
    : `Price for the year: ${now}. This year was ${wholeDollars(offer.price_was)}: the prices have changed since.`;
}

/** Under a renewal that is waiting: what was decided about the inspection owed. */
export function renewalDecisionWords(
  p: Pick<RoofCarePlan, "renewal_choice" | "renewal_credit">,
): string {
  if (p.renewal_choice === "half_off" && p.renewal_credit > 0)
    return `${cents(p.renewal_credit)} is taken off for the inspection not done. That inspection is dropped when the renewal is paid.`;
  if (p.renewal_choice === "full")
    return `Charged in full. The inspection still owed comes into the new year for ${CARRY_DAYS} days.`;
  return "";
}

export const RENEWAL_NOTE =
  "The new plan year starts on the renewal date, or the day the payment is received when that is later.";

/** The second line of a renewal's invoice: what is taken off, and why. */
export const renewalCreditSource = (planId: string): string => `roof-care-renewal:${planId}`;
export function renewalCreditWords(owed: number): string {
  return owed >= 2
    ? "Both inspections of last plan year were not done"
    : "One inspection of last plan year was not done: half off this renewal";
}

/** "Lost Mar 11, 2028": a carried inspection whose 60 days ran out. */
export const lostWords = (day: string): string =>
  `Lost ${longDay(day)}: not done in its ${CARRY_DAYS} days`;
export const CUSTOMER_ASKED_LABEL = "The customer asked for this";
export const CUSTOMER_ASKED_NOTE =
  "It decides the renewal: an inspection we could not do because the customer asked is charged in full.";
export const CARRIED_NO_PUSH = "Owed from last plan year: it cannot be pushed back.";

// ── Push back ───────────────────────────────────────────────────────────────────────────────

export const PUSH_NEEDS_MANAGER = (total: number) =>
  `That puts this inspection ${total} days past its first date. More than ${PUSH_LIMIT_DAYS} days needs a manager.`;
export const PUSH_NEEDS_REASON = (total: number) =>
  `Type the reason. This inspection would be ${total} days past its first date.`;

/**
 * What a push-back of `days` would do, for the dialog: the new last day, how far that is past
 * the first date, and why it cannot be done (null = it can). The database decides; this is so
 * the form says it first.
 */
export function pushPreview(
  v: Pick<PlanVisit, "due_by" | "first_due_by">,
  days: number | null,
  who: { manager: boolean; reason: string },
): { due_by: string; total: number; problem: string | null } | null {
  if (days == null || !Number.isInteger(days) || days < 1 || days > 365) return null;
  const due_by = plusDays(v.due_by, days);
  const total = daysBetween(v.first_due_by, due_by);
  let problem: string | null = null;
  if (total > PUSH_LIMIT_DAYS) {
    if (!who.manager) problem = PUSH_NEEDS_MANAGER(total);
    else if (!who.reason.trim()) problem = PUSH_NEEDS_REASON(total);
  }
  return { due_by, total, problem };
}

// ── The price the database hands back ───────────────────────────────────────────────────────

export interface PlanOffer {
  plan: PlanKey;
  name: string;
  list: number;
  travel: number;
  price: number;
  visit1: number;
  visit2: number;
}

export type PriceAnswer =
  | { ready: false }
  | { ready: true; custom_quote: true; over_sqft: number; plans: [] }
  | {
      ready: true;
      custom_quote: false;
      beyond_baseline: boolean;
      baseline_hours: number;
      baseline_miles: number;
      plans: PlanOffer[];
    };

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** roof_care_price()'s answer, read strictly: anything odd is "not ready", never a price. */
export function readPriceAnswer(x: unknown): PriceAnswer {
  const o = (x ?? {}) as Record<string, unknown>;
  if (o["ready"] !== true) return { ready: false };
  if (o["custom_quote"] === true)
    return {
      ready: true,
      custom_quote: true,
      over_sqft: num(o["custom_quote_over_sqft"]) ?? 0,
      plans: [],
    };
  const plans: PlanOffer[] = [];
  for (const raw of Array.isArray(o["plans"]) ? o["plans"] : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const plan = asPlanKey(r["plan"]);
    const list = num(r["list"]);
    const travel = num(r["travel"]);
    const price = num(r["price"]);
    const visit1 = num(r["visit1"]);
    const visit2 = num(r["visit2"]);
    if (
      !plan ||
      list == null ||
      travel == null ||
      price == null ||
      visit1 == null ||
      visit2 == null
    )
      return { ready: false };
    plans.push({ plan, name: PLAN_NAMES[plan], list, travel, price, visit1, visit2 });
  }
  const bh = num(o["baseline_hours"]);
  const bm = num(o["baseline_miles"]);
  if (plans.length !== PLAN_KEYS.length || bh == null || bm == null) return { ready: false };
  return {
    ready: true,
    custom_quote: false,
    beyond_baseline: o["beyond_baseline"] === true,
    baseline_hours: bh,
    baseline_miles: bm,
    plans,
  };
}

// ── The invoice of a visit ──────────────────────────────────────────────────────────────────

/** The `source` of the plan's own line on a visit's invoice, so a rebuild knows it. */
export const carePlanLineSource = (visitId: string): string => `roof-care:${visitId}`;

/**
 * "Roof Guard plan: inspection 1 of 2 (half of the yearly price)", and for a plan paid for the
 * year before it started, "(included in the plan)".
 */
export function carePlanLineWords(plan: unknown, kind: VisitKind, paidFirst = false): string {
  const name = planName(plan);
  if (kind === "storm") return `${name} plan: storm inspection (included in the plan)`;
  if (kind === "carried")
    return `${name} plan: inspection owed from last plan year (included in the plan)`;
  const which = `${name} plan: inspection ${kind === "visit1" ? 1 : 2} of 2`;
  return paidFirst ? `${which} (included in the plan)` : `${which} (half of the yearly price)`;
}

/** The note on the ticket's own lines of a visit's invoice: they are covered by the plan. */
export const CARE_PLAN_COVERED = "Included in the Roof Care plan";

// ── The terms ───────────────────────────────────────────────────────────────────────────────

/**
 * What the customer agrees to at sign-up (owner, Nov 18: "i like all 10 you came up with").
 * The plan keeps which set was agreed (`terms_version`), so a later change to the wording does
 * not rewrite what an earlier customer said yes to. Change a line: change the version too.
 */
// Nov 19 (version 2026-11-19), with paying for the year first: terms 2, 3 and 9 changed. Term 9
// carries the owner's refund rule: "a share for inspections not done, if we did one half is
// refunded", and "i like the repairs coming off a refund rule, we may need to note that on the
// agreement".
export const ROOF_CARE_TERMS_VERSION = "2026-11-19";
export const ROOF_CARE_TERMS: readonly string[] = [
  "Your plan includes the services listed for it on the Roof Care Plans sheet.",
  "The yearly price is paid in full before the plan starts. We send one invoice for the year.",
  "The plan runs for twelve months from the day we receive your payment.",
  "The price is an estimate until we measure the roof. If the roof's size is different, the price is corrected once.",
  "Minor repairs included in the plan are valued at our standard rates. An unused amount does not carry over to the next year.",
  "Repairs beyond what the plan includes are quoted to you first and billed separately.",
  "You give us access to the roof on the agreed day. A missed visit is rescheduled once at no charge.",
  "A storm inspection, where the plan includes one, is done when you ask for it after a storm.",
  "Either of us can end the plan in writing. We refund the share for inspections not yet done, less any minor repairs the plan has already covered.",
  "The plan is not a warranty and does not cover replacing the roof.",
];
export const TERMS_NOT_AGREED = "The customer has to agree to the plan's terms";

// ── The price that is saved is the price that was shown (owner, Nov 19: "Fix") ──────────────
//
// Sign-up works the drive out again on the server, so the form cannot send its own. If the road
// router answers differently the second time, or an admin changed the numbers in between, the
// price would have been saved different from the one the customer had just agreed to. The form
// now sends the price it showed, and the sign-up is refused when it is no longer the price.

/** Starts the refusal, so the form knows to read the prices again. */
export const PRICE_CHANGED = "The price changed";
const wholeDollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export function priceChangedLine(shown: number, now: number): string {
  return (
    PRICE_CHANGED +
    ": this plan is now " +
    wholeDollars(now) +
    ", not the " +
    wholeDollars(shown) +
    " shown. The prices have been read again. Check them with the customer and press again."
  );
}
export const isPriceChanged = (message: string): boolean => message.includes(PRICE_CHANGED);

/**
 * Under the prices, when the road router did not answer and the straight line was used. It
 * says the price is an estimate and nothing of why (owner, Nov 19: "they shouldn't know they're
 * paying more for distance neither the customer or tech").
 */
export const PRICE_ESTIMATE_JUST_NOW =
  "This price is an estimate just now. Press Get the price again in a minute for the exact one.";
/** The same, when the address is placed by its town or zip and not the building. */
export const PRICE_ESTIMATE_ROUGH =
  "The street address is not on the map. This price is an estimate until the office confirms the address.";

// ── What the sign-up screen is told (owner, Nov 19) ─────────────────────────────────────────
//
// The customer reads the sign-up screen with whoever holds it. The price is one number: not the
// list price and what the distance adds, not the hours or the miles. So none of that is sent to
// the browser at all. The database still saves both parts on the plan for the Owner page.

export interface ShownOffer {
  plan: PlanKey;
  name: string;
  price: number;
  visit1: number;
  visit2: number;
}
export type ShownPrice =
  | { ready: false }
  | { ready: true; custom_quote: true; over_sqft: number; plans: [] }
  | { ready: true; custom_quote: false; plans: ShownOffer[] };

/** The price answer with everything about the distance left out. */
export function shownPrice(a: PriceAnswer): ShownPrice {
  if (!a.ready) return { ready: false };
  if (a.custom_quote) return { ready: true, custom_quote: true, over_sqft: a.over_sqft, plans: [] };
  return {
    ready: true,
    custom_quote: false,
    plans: a.plans.map((o) => ({
      plan: o.plan,
      name: o.name,
      price: o.price,
      visit1: o.visit1,
      visit2: o.visit2,
    })),
  };
}

// The roof size box of the sign-up starts blank, as every number box does. When our map has a
// building outline at the property's address, the sign-up says its size beside the box and
// offers it (owner, Nov 19: "should we go ahead and lookup … the customers properties to make it
// easier to price the plans?"). It is the outline's area, so it is said as "about", to the
// hundred, and it is one building: a property with more roofs than one is added up by a person.

/** What the map shows at a property's address. `sure` is false when it was found by its name. */
export interface MapRoofSize {
  sqft: number;
  sure: boolean;
}

/** An outline smaller than this is a shed or a canopy, not the roof a plan is for. */
export const MAP_ROOF_MIN_SQFT = 500;

/**
 * The address finder's answer as a roof size to offer, or null: nothing found, a point with no
 * outline, or an outline too small to be the building.
 */
export function mapRoofSize(
  found: { areaSqFt: number | null } | null | undefined,
  note: string | null | undefined,
): MapRoofSize | null {
  const area = found?.areaSqFt;
  if (area == null || !Number.isFinite(area) || area < MAP_ROOF_MIN_SQFT) return null;
  return { sqft: Math.round(area / 100) * 100, sure: !/^found by name/i.test((note ?? "").trim()) };
}

export const MAP_ROOF_USE = "Use this size";
export const MAP_ROOF_MORE = "If the property has more than one roof, add them together.";

/** "The map shows a building of about 22,400 sq ft at this address." */
export function mapRoofSizeLine(m: MapRoofSize): string {
  const size = m.sqft.toLocaleString("en-US");
  return m.sure
    ? `The map shows a building of about ${size} sq ft at this address.`
    : `The map shows a building of about ${size} sq ft that matches this property's name. Check it is the right building.`;
}

/** Why a shown price is an estimate, when it is. */
export type PriceEstimate = "rough" | "just-now" | null;
