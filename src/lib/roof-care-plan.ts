/**
 * Roof Care plans, step 2: a property's plan and its inspections (owner, Nov 18;
 * docs/roof-care-plans.md). Pure: what the screens say about a plan. The rules themselves are
 * the database's (20261118240000_roof_care_plans.sql): the price, one plan per property, the
 * two windows, the push-back limit. What is here is their twin for the screen, so a form can
 * say what will happen before it is pressed. No prices live here.
 */
import { canAccess, isFieldOnly, type AccessLike } from "@/lib/access";
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
  /**
   * False when the reader cannot open it: a technician's answer names every inspection's
   * ticket, also one that is with somebody else (Nov 20). Absent for the office.
   */
  mine?: boolean;
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
  /**
   * Skipped (Nov 20): an inspection we will not do. Its ticket is off the board and is not
   * made again; it still counts as an inspection owed. Absent on an older read.
   */
  skipped_on?: string | null;
  skip_reason?: string | null;
  skipped_by_name?: string | null;
  /**
   * A storm inspection beyond the ones the plan includes, for a reader who is given no amount
   * (a technician): `amount` is 0 for them, and this says it is a billed one.
   */
  extra?: boolean;
  ticket: VisitTicket | null;
  /**
   * Its share of the plan is on a live invoice (Nov 19). Null for a reader who does not see
   * invoices: nothing is said to them either way.
   */
  billed: boolean | null;
  /**
   * The cleaning the plan includes at this inspection (Nov 19, night): true, false, or null
   * while it is not answered. Absent on an older read. roof-care-cleaning.ts.
   */
  drains_cleaned?: boolean | null;
  gutters_cleaned?: boolean | null;
  cleaning_note?: string | null;
  /** Who answered, and when. */
  cleaning_by_name?: string | null;
  cleaning_at?: string | null;
}

/** One time the crew could not get on the roof for an inspection of the plan. */
export interface PlanNoAccess {
  id: string;
  visit_id: string;
  on: string;
  note: string;
  by_name: string;
  /** The return trip is charged: every one after the first of the plan year. */
  charged: boolean;
  /** What it is charged; null for a free one, and when it could not be worked out. */
  amount: number | null;
  /**
   * The invoice its charge is on. Null when it is on none, and for a reader who does not see
   * invoices (`billed` is then null as well).
   */
  invoice: { id: string; number: string } | null;
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
  /** Each change a manager made to it (Nov 20), oldest first. Absent on an older read. */
  changes?: RefundChange[];
}

/** One change a manager made to a refund that was owed. */
export interface RefundChange {
  from: number;
  to: number;
  reason: string;
  by_name: string;
  on: string;
}

/**
 * Card money that has to go back to the customer (Nov 20; roof_care_card_payments): a payment
 * for a plan already paid, for a plan that had ended, one that did not cover what was owed, or
 * the part of a payment over what was owed.
 */
export interface PlanCardBack {
  id: string;
  /** What is owed back of it. */
  owed: number;
  /** Why: "paid_already", "ended", "short", or "over" for the part over what was owed. */
  why: "paid_already" | "ended" | "short" | "over";
  /** The card processor's own reference of the payment. */
  ref: string;
  paid_on: string;
  /** What was owed for the plan year when it came in; null when not kept. */
  was_owed: number | null;
  sent_back: { on: string; ref: string | null; by_name: string } | null;
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
  /** An expired plan a manager closed out: when, and why. Null otherwise. */
  closed_out: { on: string; reason: string } | null;
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
  /** Storm inspections a year the plan includes (the plan settings); absent on an older read. */
  storm_included?: number;
  /**
   * The times this plan year the crew arrived for an inspection and could not get on the roof
   * (Nov 19; roof-care-no-access.ts). Null for a reader who is not the office: a technician
   * reads only the ones they recorded, so no count is shown to them from here.
   */
  no_access?: PlanNoAccess[] | null;
  /** The day Roof Guard's yearly budget forecast was marked sent; null until it is. */
  forecast_sent_on?: string | null;
  /**
   * A card payment taken online (Nov 19, night): the day, the amount for those who see invoices
   * (null otherwise), and its reference. Null when there was none.
   */
  card_paid?: { on: string; amount: number | null; ref: string | null } | null;
  /**
   * Card money to send back for this plan, sent or not (Nov 20). Null for a reader who does
   * not see invoices; absent on an older read.
   */
  card_back?: PlanCardBack[] | null;
  /** The customer's email, and what has been sent to it (Nov 19). Absent on an older read. */
  email?: PlanEmail;
  /**
   * The roof size against the map at the sign-up (Nov 20). `unchecked`: the map had no size
   * for the property, so the typed one was taken as it is and waits for a manager to confirm
   * it. `confirmed`: who said a typed size is right, and when. Absent on an older read.
   */
  size?: PlanSize;
}

export interface PlanSize {
  unchecked: boolean;
  /** What the map showed when the plan was signed; null when it showed nothing. */
  map_sqft: number | null;
  confirmed: { on: string; by_name: string } | null;
  /** Every time a manager corrected the size, oldest first (Nov 24). Absent on an older read. */
  changes?: PlanSizeChange[];
  /** What a correction after the plan was paid left to settle. Absent when none ever was. */
  balance?: PlanSizeBalance;
}

/** A refund sent for a smaller roof (roof_care_size_refund_sent). */
export interface SizeRefund {
  amount: number;
  /** The day, as YYYY-MM-DD. */
  on: string;
  ref: string | null;
  by_name: string;
}

/**
 * A paid plan whose roof size was corrected (owner, Nov 24: "then build the rest"). The plan
 * takes the price of the right size, and the difference is settled: a bigger roof on an invoice
 * of its own, a smaller roof by a refund the office sends and records.
 */
export interface PlanSizeBalance {
  /** Above 0: the customer owes it. Below 0: it is owed back. 0: settled. */
  owed: number;
  /** The open invoice for a difference owed to us, once it is made. */
  invoice: { id: string; number: string; status: string } | null;
  refunds: SizeRefund[];
}

/** price - what the payments cover so far (roof_care_plans.size_paid_price), to the cent. */
export function sizeOwed(price: number, paidPrice: number | null | undefined): number {
  if (paidPrice == null || !Number.isFinite(paidPrice)) return 0;
  return Math.round((price - paidPrice) * 100) / 100;
}

/** The refunds the database keeps, with anything unreadable left out. */
export function readSizeRefunds(x: unknown): SizeRefund[] {
  const out: SizeRefund[] = [];
  for (const e of Array.isArray(x) ? x : []) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const amount = Number(o["amount"]);
    const on = typeof o["on"] === "string" ? o["on"].slice(0, 10) : "";
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(on)) continue;
    const ref = typeof o["ref"] === "string" ? o["ref"].trim() : "";
    out.push({
      amount,
      on,
      ref: ref || null,
      by_name: typeof o["by_name"] === "string" ? o["by_name"].trim() : "",
    });
  }
  return out;
}

/**
 * One correction of a plan's roof size (owner, Nov 24: "more than once but recorded"). The
 * database writes it (roof_care_correct_size) and nothing edits it afterwards.
 */
export interface PlanSizeChange {
  /** The day, as YYYY-MM-DD. */
  on: string;
  by_name: string;
  from_sqft: number;
  to_sqft: number;
  from_price: number;
  /** The plan's price after it. A plan in force keeps the price it was paid at. */
  to_price: number;
  /** What a year costs at the corrected size, by the prices of that day. */
  would_be: number;
  /** True when the plan's price followed the size. False only on a record from Nov 24's first step, when a paid plan kept its price. */
  repriced: boolean;
  note: string | null;
  /** True when the plan was already paid, so the difference had to be settled. */
  paid?: boolean;
  /** For a paid plan: what the correction left owed. Above 0 to us, below 0 back to the customer. */
  owed?: number;
}

/** The database's record of one correction, read strictly: null for anything odd. */
export function readSizeChange(x: unknown): PlanSizeChange | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const n = (v: unknown) => {
    const v2 = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof v2 === "number" && Number.isFinite(v2) ? v2 : null;
  };
  const from_sqft = n(o["from_sqft"]);
  const to_sqft = n(o["to_sqft"]);
  const from_price = n(o["from_price"]);
  const to_price = n(o["to_price"]);
  const would_be = n(o["would_be"]);
  const on = typeof o["on"] === "string" ? o["on"].slice(0, 10) : "";
  if (
    from_sqft == null ||
    to_sqft == null ||
    from_price == null ||
    to_price == null ||
    would_be == null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(on)
  )
    return null;
  const note = typeof o["note"] === "string" ? o["note"].trim() : "";
  return {
    on,
    by_name: typeof o["by_name"] === "string" ? o["by_name"].trim() : "",
    from_sqft,
    to_sqft,
    from_price,
    to_price,
    would_be,
    repriced: o["repriced"] === true,
    note: note || null,
    ...(o["paid"] === true ? { paid: true, owed: n(o["owed"]) ?? 0 } : {}),
  };
}

/** A plan's corrections as the database keeps them: a list, with anything unreadable left out. */
export const readSizeChanges = (x: unknown): PlanSizeChange[] =>
  (Array.isArray(x) ? x : []).map(readSizeChange).filter((c): c is PlanSizeChange => c !== null);

/** Where the agreement and the receipt go, and whether they went. */
export interface PlanEmail {
  to: string | null;
  agreement_sent_at: string | null;
  agreement_error: string | null;
  receipt_sent_at: string | null;
  receipt_error: string | null;
}

/** "Agreement emailed to a@b.com Nov 19." and the like: one line each, for the office. */
export function planEmailLines(
  e: PlanEmail,
  o: { paid: boolean; day: (iso: string) => string },
): string[] {
  if (!e.to) return ["No email address: the agreement and the receipt were not emailed."];
  const why = (err: string | null) =>
    !err
      ? "It goes out within the half hour."
      : /not set up|not set/i.test(err)
        ? "Email is not set up on the site yet."
        : `It could not be sent: ${err}`;
  const out = [
    e.agreement_sent_at
      ? `Agreement emailed to ${e.to} ${o.day(e.agreement_sent_at.slice(0, 10))}.`
      : `The agreement has not been emailed to ${e.to} yet. ${why(e.agreement_error)}`,
  ];
  if (o.paid)
    out.push(
      e.receipt_sent_at
        ? `Receipt emailed ${o.day(e.receipt_sent_at.slice(0, 10))}.`
        : `The receipt has not been emailed yet. ${why(e.receipt_error)}`,
    );
  return out;
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

/**
 * What "the inspection window" means for a first inspection (owner, Nov 20): the window open
 * today when two weeks of it are left, from today to its last day; otherwise the next one to
 * open. The same rule as roof_care_start in the database.
 */
export function nextWindow(today: string): Window {
  const w = windowsFrom(today).find(
    (x) => x.from > today || daysBetween(today, x.to) >= SECOND_WINDOW_MIN_DAYS - 1,
  )!;
  return w.from > today ? w : { from: today, to: w.to };
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

export type VisitState = "done" | "late" | "ticket" | "waiting" | "lost" | "skipped";

/**
 * Done (the ticket is Done or further), skipped (a manager said we will not do it: Nov 20),
 * lost (carried from last plan year and not done in its 60 days), late (not done and past its
 * last day), a ticket is out for it, or it is waiting for its time.
 */
export function visitState(v: PlanVisit, today: string): VisitState {
  if (v.ticket && DONE_STAGES.includes(v.ticket.stage)) return "done";
  if (v.skipped_on) return "skipped";
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

/** "Closed out Jun 3, 2028: not interested." */
export function closedOutWords(c: { on: string; reason: string }): string {
  return `Closed out ${longDay(c.on)}: ${c.reason.replace(/[.\s]+$/, "")}. What was still owed was dropped.`;
}
export const CLOSE_OUT_LABEL = "Close it out";
export const CLOSE_OUT_NOTE =
  "For a plan that will not be renewed. Any inspection still owed is dropped, its ticket comes off the board, and the plan leaves the Needs attention list. It can still be renewed later.";

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
/**
 * A plan that waits for its payment is shown as what is left to do, in order (owner, Nov 24:
 * "the non paid plan probably needs a rework as well its a bit messy", and "how do you confirm
 * payment was recieved if theyve sent a check or something").
 */
export const STEP_SIZE = "Confirm the roof size";
export const STEP_SIZE_DONE = "Roof size";
export const STEP_PAY_CARD = "Ask for the card payment";
export const STEP_PAY_CHECK = "Send the invoice";
export const STEP_PAY = "Ask for the payment";
export const STEP_START = "Record the payment";
export const STEP_START_CARD =
  "A card payment is recorded by itself, and the plan starts that minute. Nothing has to be marked.";
export const STEP_START_CHECK =
  "When the check arrives, open the invoice and press Mark paid. The plan starts that day and its inspections are made.";
/**
 * A plan that waits for its payment is read again this often while its page is open (owner,
 * Nov 24: "once i paid for the plan on the card via the email that the office sent i had to
 * manually refresh the customer page with the property to get it applied"). The payment comes
 * from the customer's own phone, so the office's page has to look for it by itself.
 */
export const PLAN_WAITING_RELOAD_MS = 10_000;
/** Whether any of a property's plans waits for its payment: only then is it read again. */
export const anyPlanWaits = (
  plans: readonly Pick<RoofCarePlan, "status">[] | null | undefined,
): boolean => !!plans?.some((p) => p.status === "awaiting_payment");
/** The plans that were waiting at the last read and are in force at this one: just paid. */
export function plansJustPaid(
  before: readonly Pick<RoofCarePlan, "id" | "status">[] | null | undefined,
  now: readonly Pick<RoofCarePlan, "id" | "status">[] | null | undefined,
): string[] {
  const waited = new Set(
    (before ?? []).filter((p) => p.status === "awaiting_payment").map((p) => p.id),
  );
  return (now ?? []).filter((p) => p.status === "active" && waited.has(p.id)).map((p) => p.id);
}
export const PLAN_PAID_TOAST = "The payment is in. The plan has started.";
/** On the property, where the plan is shown in short (owner, Nov 24). */
export const PLAN_BRIEF_HINT =
  "Care Plan opens the inspections, what the plan includes and its details.";
export const PLAN_NO_INVOICE = "No invoice has been made for this plan yet.";
export const PLAN_MAKE_INVOICE = "Make the invoice";
/**
 * On a plan year's own invoice (Nov 23). It has no ticket, so the ticket's words do not fit it:
 * its payment starts the plan, and a voided one is made again from the plan, not from a ticket.
 */
export const PLAN_INVOICE_PAID_NOTE =
  "Records the payment here (Sage stays the ledger). A payment that covers the total starts the plan year.";
export const PLAN_INVOICE_REMAKE = `To bill the plan again, open the plan on its property and choose ${PLAN_MAKE_INVOICE}.`;
export const PLAN_INVOICE_EXISTS = "This plan already has an invoice.";
export const PLAN_INVOICE_NOT_AWAITING =
  "Only a plan that is waiting for its payment gets an invoice made for it.";

/** "Roof Care plan, one year: two inspections with photo reports". The invoice's one line. */
export function planInvoiceLineWords(plan: unknown): string {
  return `${planName(plan)} plan, one year: two inspections with a photo report after each`;
}

// ── A first inspection pushed too far (owner, Nov 20: "go with ... 14") ─────────────────────
//
// The second inspection is at least four months after the first, in a window with two weeks
// left. With "first inspection in 250 days" it fell after the plan's last day: its ticket was
// never made. Such a number of days is refused, on the sign-up and by the database
// (roof_care_second_fits, roof_care_max_first_days: the same rule, the same test days).

/** Does the second inspection start on or before the plan's last day? */
export function secondFits(d: { second: Window; renews: string }): boolean {
  return d.second.from <= d.renews;
}

/** The largest number of days the first inspection can be pushed back for a plan signed today. */
export function maxFirstDays(today: string): number {
  let max = 0;
  for (let n = 1; n <= 365; n++) {
    const d = planDates(today, "days", n);
    if (d && secondFits(d)) max = n;
  }
  return max;
}

/** The refusal, in the database's own words. */
export const firstDaysTooFar = (max: number): string =>
  `The second inspection would fall after the plan ends. Choose ${max} days or fewer, or pick the inspection window.`;

/**
 * What is wrong with the first inspection's days, or null. A number that is not 1 to 365 has its
 * own line on the form; "today" and "in the inspection window" always fit.
 */
export function firstDaysProblem(
  today: string,
  first: FirstVisit | null,
  days: number | null,
): string | null {
  if (first !== "days" || days == null) return null;
  const d = planDates(today, "days", days);
  if (!d || secondFits(d)) return null;
  return firstDaysTooFar(maxFirstDays(today));
}

/**
 * Beside "a set number of days after your payment" (owner, Nov 23: "we will accommodate the
 * best we can but we cannot guarantee that date"). The customer reads it on the sign-up and in
 * their copy of the agreement.
 */
export const FIRST_DAYS_NOT_PROMISED =
  "We will do our best to come on that day, but we cannot guarantee the date.";

/** When the first inspection is, counted from the payment: for the plan that is waiting. */
export function firstVisitWords(first: FirstVisit, days: number | null): string {
  if (first === "now") return "First inspection: as soon as the payment is received.";
  if (first === "days")
    return `First inspection: ${days ?? 0} ${days === 1 ? "day" : "days"} after the payment is received. ${FIRST_DAYS_NOT_PROMISED}`;
  return "First inspection: in the inspection window open when the payment is received, if two weeks of it are left. Otherwise in the next one.";
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
  /** How many of those are storm inspections: one counts as an inspection done (Nov 19). */
  storm_counted: number;
  share: number;
  repairs: number;
  /** The travel of the plan's leak calls that was not charged (Nov 19). */
  travel: number;
  /**
   * The card fee on what is refunded, for a year paid by card (owner, Nov 19, night: "go"): the
   * card company keeps its fee whether or not the money goes back.
   */
  card_fee: number;
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
  // The two added Nov 19 read as nothing from an answer made before them.
  return {
    paid,
    inspections_done: done,
    storm_counted: n("storm_counted") ?? 0,
    share,
    repairs,
    travel: n("travel") ?? 0,
    card_fee: n("card_fee") ?? 0,
    refund,
  };
}

const cents = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The sum, a line at a time, as the End plan box shows it. */
export function refundLines(w: RefundWorked): string[] {
  if (!(w.paid > 0)) return ["Nothing was paid for this plan year, so there is nothing to refund."];
  const out = [
    `Paid for the year: ${cents(w.paid)}`,
    `Inspections done: ${w.inspections_done} of 2${w.storm_counted > 0 ? " (a storm inspection counts as one)" : ""}`,
    `Share for the inspections not done: ${cents(w.share)}`,
  ];
  if (w.repairs > 0) out.push(`Minor repairs the plan already covered: ${cents(w.repairs)} off`);
  if (w.travel > 0) out.push(`Leak call travel that was not charged: ${cents(w.travel)} off`);
  if (w.card_fee > 0) out.push(`Card fee on the amount refunded: ${cents(w.card_fee)} off`);
  out.push(`Refund: ${cents(w.refund)}`);
  return out;
}

/**
 * "Refund owed: $612.00." / "Refund of $612.00 sent Nov 20, 2026 (check 2001)." / "No refund is
 * owed." for one a manager changed to nothing.
 */
export function refundStatusWords(r: PlanRefund): string {
  if (!(r.due > 0)) return r.changes?.length ? "No refund is owed." : "";
  if (!r.sent_on) return `Refund owed: ${cents(r.due)}.`;
  return `Refund of ${cents(r.due)} sent ${longDay(r.sent_on)}${r.ref ? ` (${r.ref})` : ""}.`;
}
export const REFUND_MARK_SENT = "Mark the refund sent";

/**
 * The property's OTHER ended plans whose refund is owed and not yet marked sent (owner, Nov 23:
 * "go on 1"). The card showed a refund only for the property's current plan, so once a new plan
 * was signed an older plan's refund could not be reached. Oldest first. A refund already sent,
 * or changed to nothing, is not listed: it is done with.
 */
export function otherRefundsOwed<
  T extends Pick<RoofCarePlan, "id" | "status" | "refund" | "ended_on">,
>(plans: readonly T[], currentId: string | null): T[] {
  return plans
    .filter(
      (p) =>
        p.id !== currentId &&
        p.status === "ended" &&
        !!p.refund &&
        p.refund.due > 0 &&
        !p.refund.sent_on,
    )
    .sort((a, b) => (a.ended_on ?? "").localeCompare(b.ended_on ?? ""));
}

/**
 * Which plan a refund line is for, when the card shows more than the current plan's:
 * "Roof Care plan RC-1004, Mar 10, 2026 to Mar 10, 2027, ended Jun 2, 2026".
 */
export function refundPlanWords(
  p: Pick<
    RoofCarePlan,
    "plan" | "plan_number" | "starts_on" | "signed_on" | "renews_on" | "ended_on"
  >,
): string {
  const first = p.starts_on || p.signed_on;
  const year = first && p.renews_on ? `, ${longDay(first)} to ${longDay(p.renews_on)}` : "";
  const number = p.plan_number != null ? ` RC-${p.plan_number}` : "";
  const ended = p.ended_on ? `, ended ${longDay(p.ended_on)}` : "";
  return `${planName(p.plan)} plan${number}${year}${ended}`;
}
export const REFUND_BAD_AMOUNT = "Type the refund, 0 or more, and no more than was paid";

// ── A manager changes a refund that is owed (owner, Nov 20: "go with ... new issue 2") ──────
//
// His example: the plan ended early, the site worked out an amount to send back, and then the
// customer's own check for the year bounced. A manager sets the refund to 0 with the reason
// "check bounced". Every change is kept: what it was, what it is, why, who and when.

export const REFUND_CHANGE = "Change refund";
export const REFUND_CHANGE_SAVE = "Save the new refund";
export const REFUND_CHANGE_REASON_NEEDED = "Type why the refund is changed";
export const REFUND_CHANGE_HELP =
  "For a manager or an admin. Type what is owed back now, 0 for nothing, and why. It cannot be more than was paid for the plan year. The old amount, the reason, your name and the day are kept.";
export const REFUND_SENT_NO_CHANGE = "A refund that is marked sent cannot be changed.";

/** roof_care_plans.refund_changes, read strictly: anything that is not a change is left out. */
export function readRefundChanges(x: unknown): RefundChange[] {
  if (!Array.isArray(x)) return [];
  const out: RefundChange[] = [];
  for (const raw of x) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const from = Number(c["from"]);
    const to = Number(c["to"]);
    const on = typeof c["on"] === "string" ? c["on"] : "";
    if (!Number.isFinite(from) || !Number.isFinite(to) || !/^\d{4}-\d{2}-\d{2}$/.test(on)) continue;
    out.push({
      from,
      to,
      reason: typeof c["reason"] === "string" ? c["reason"].trim() : "",
      by_name: typeof c["by_name"] === "string" ? c["by_name"].trim() : "",
      on,
    });
  }
  return out;
}

/** "Changed from $612.00 to $0.00 by Mo Manager on Nov 20, 2026: check bounced" */
export function refundChangeWords(c: RefundChange): string {
  return `Changed from ${cents(c.from)} to ${cents(c.to)}${c.by_name ? ` by ${c.by_name}` : ""} on ${longDay(c.on)}${c.reason ? `: ${c.reason}` : ""}`;
}

/** What is wrong with a new refund typed in the box, or null. `current`: what is owed now. */
export function refundChangeProblem(
  amountText: string,
  reason: string,
  current: number,
): string | null {
  const t = amountText.trim().replace(/[$,\s]/g, "");
  const n = t === "" ? NaN : Number(t);
  if (!Number.isFinite(n) || n < 0) return "Type the refund: 0 or more";
  if (Math.round(n * 100) === Math.round(current * 100))
    return `The refund is already ${cents(current)}.`;
  if (!reason.trim()) return REFUND_CHANGE_REASON_NEEDED;
  return null;
}

// ── Card money to send back (owner, Nov 20: "go with ... new issue 1") ──────────────────────

export const CARD_BACK_MARK = "Mark sent back";

/** What is owed back of a card payment row, and why; null when nothing of it is. */
export function cardBackOf(row: {
  id: string;
  outcome: string;
  reason: string | null;
  amount: number | string;
  over: number | string | null;
  owed: number | string | null;
  ref: string;
  paid_on: string;
  sent_back_on: string | null;
  sent_back_ref: string | null;
  sent_back_by_name?: string | null;
}): PlanCardBack | null {
  const sendBack = row.outcome === "send_back";
  const owed = Math.round((Number(sendBack ? row.amount : row.over) || 0) * 100) / 100;
  if (!(owed > 0)) return null;
  const why =
    !sendBack || !row.reason
      ? "over"
      : row.reason === "ended" || row.reason === "short"
        ? row.reason
        : "paid_already";
  return {
    id: row.id,
    owed,
    why,
    ref: row.ref,
    paid_on: row.paid_on,
    was_owed: row.owed == null ? null : Number(row.owed),
    sent_back: row.sent_back_on
      ? {
          on: row.sent_back_on,
          ref: (row.sent_back_ref ?? "").trim() || null,
          by_name: (row.sent_back_by_name ?? "").trim(),
        }
      : null,
  };
}

const CARD_BACK_WHY: Record<PlanCardBack["why"], (c: PlanCardBack) => string> = {
  paid_already: () => "The plan was already paid when this card payment came in.",
  ended: () => "The plan had ended when this card payment came in.",
  short: (c) =>
    c.was_owed != null
      ? `It did not cover the ${cents(c.was_owed)} owed, so the plan did not start on it.`
      : "It did not cover what was owed, so the plan did not start on it.",
  over: () => "The card was charged more than was owed for the plan year.",
};

/** Why a card payment goes back, in a sentence. */
export const cardBackWhy = (c: PlanCardBack): string => CARD_BACK_WHY[c.why](c);

/**
 * "Card money to send back: $840.00. The plan was already paid when this card payment came in.
 * Paid Nov 20, 2026, reference pi_9." / "Sent back $840.00 on Nov 21, 2026 (re_3) by Mo Manager."
 */
export function cardBackWords(c: PlanCardBack): string {
  if (c.sent_back)
    return `Sent back ${cents(c.owed)} on ${longDay(c.sent_back.on)}${c.sent_back.ref ? ` (${c.sent_back.ref})` : ""}${c.sent_back.by_name ? ` by ${c.sent_back.by_name}` : ""}.`;
  return `Card money to send back: ${cents(c.owed)}. ${CARD_BACK_WHY[c.why](c)} Paid ${longDay(c.paid_on)}, reference ${c.ref}.`;
}

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

/**
 * The first day of a renewal's plan year when it is paid before the old year is over: the day
 * after the old year's last day (owner, Nov 23: "start the new year the day after"). The old
 * year covers its last day, so no day is covered by both. The database decides it
 * (roof_care_start, 20261124200000); this is the same day for the words on the invoice.
 */
export const renewalStartsOn = (oldLastDay: string): string => plusDays(oldLastDay, 1);

export const RENEWAL_CHOICES = ["half_off", "full"] as const;
export type RenewalChoice = (typeof RENEWAL_CHOICES)[number];
export const asRenewalChoice = (v: unknown): RenewalChoice | null =>
  v === "half_off" || v === "full" ? v : null;

/**
 * What a plan that renews BY ITSELF may charge (owner, Nov 20: "we should probably ensure if
 * someone ticks auto renew we dont charge them more if prices change and they auto renew w/o
 * knowing"). Renewing by itself is not built yet (it comes with Stripe); this is the rule it has
 * to go by, kept here so it is one rule and a tested one:
 *
 *   - never more than the yearly price the customer last agreed to (`agreed`: the price of the
 *     plan year that is ending), UNLESS they were told the new price at least 30 days before
 *     the renewal day (owner, Nov 23: "30 days is good") and the telling is on record (`told`:
 *     the price they were told, and the day). Told 29 days before, the old price is charged;
 *   - told a price: never more than the price they were told;
 *   - a price that went down is charged as it is today.
 *
 * `held`: the price went up and they were not told, so the old price is charged. The office
 * should hear that, to tell the customer before the year after.
 * A renewal a person makes by hand is not this: the box shows today's price and the database
 * refuses a price that moved since it was shown (roof_care_renew, p_shown_price).
 */
export function autoRenewCharge(
  agreed: number,
  now: number,
  told: { price: number; on: string } | null,
  renewsOn: string,
): { charge: number; held: boolean } {
  const cents = (n: number) => Math.round(n * 100) / 100;
  const cap =
    told && autoRenewToldInTime(told.on, renewsOn) && told.price > agreed ? told.price : agreed;
  if (now <= cap) return { charge: cents(now), held: false };
  return { charge: cents(cap), held: true };
}

/**
 * How long before the renewal day the customer has to be told a new price for it to count
 * (owner, Nov 23: "30 days is good").
 */
export const AUTO_RENEW_NOTICE_DAYS = 30;

/** Was the customer told at least 30 days before the renewal day? */
export function autoRenewToldInTime(toldOn: string, renewsOn: string): boolean {
  return daysBetween(toldOn, renewsOn) >= AUTO_RENEW_NOTICE_DAYS;
}

/** The last day a new price can be told for this renewal to charge it. */
export const autoRenewTellBy = (renewsOn: string): string =>
  plusDays(renewsOn, -AUTO_RENEW_NOTICE_DAYS);

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
  /**
   * What "we did not get there" takes off: the price of one inspection for each one owed (Nov
   * 19: half the Roof Watch price for that roof and drive; it was half the plan's own price).
   */
  credit_if_half_off: number;
  /** The last day an inspection charged in full stays owed, for a payment made today. */
  carried_until: string;
  pay_method: PayMethod | null;
  has_renewal: boolean;
  /**
   * Who may pick the answer the rule did not (Nov 20): a manager or an admin. An office user
   * gets the rule's own answer.
   */
  can_change: boolean;
  /**
   * The plan ended more than 60 days ago (Nov 20): it renews at the full price, and
   * `lapsed_owed` inspections of the old year are neither credited nor carried.
   */
  lapsed: boolean;
  lapsed_owed: number;
  /** The day the plan ended, for one that has. */
  ended_on: string | null;
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
    can_change: o["can_change"] === true,
    lapsed: o["lapsed"] === true,
    lapsed_owed: Math.max(0, Math.round(Number(o["lapsed_owed"]) || 0)),
    ended_on: day("ended_on"),
  };
}

/** Under the two answers, for someone who cannot pick the other one. */
export const RENEWAL_CHANGE_NEEDS_MANAGER =
  "Only a manager or an admin can pick the other answer. Ask one of them if it should be changed.";

/** A plan that ended more than this many days ago is past what the old year owed. */
export const RENEWAL_LAPSED_DAYS = 60;

/** "This plan ended Sep 1, 2025, more than 60 days ago. …" Empty when it has not lapsed. */
export function renewalLapsedWords(
  offer: Pick<RenewalOffer, "lapsed" | "lapsed_owed" | "ended_on">,
): string {
  if (!offer.lapsed) return "";
  const when = offer.ended_on ? `ended ${longDay(offer.ended_on)}, ` : "ended ";
  const base = `This plan ${when}more than ${RENEWAL_LAPSED_DAYS} days ago, so it renews at the full price.`;
  if (offer.lapsed_owed <= 0) return base;
  return `${base} ${offer.lapsed_owed === 1 ? "The inspection that was not done is" : "The inspections that were not done are"} not taken off the price and not carried into the new year.`;
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
      ? `We did not get there. Take ${cents(offer.credit_if_half_off)} off the renewal, the price of ${one ? "one inspection" : "two inspections"}: the customer pays ${cents(left)}. ${one ? "The inspection is" : "The inspections are"} dropped.`
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
  return "It is late and no push-back says the customer asked, so taking its price off is picked.";
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
    ? "Both inspections of last plan year were not done: their price is taken off this renewal"
    : "One inspection of last plan year was not done: its price is taken off this renewal";
}

/** "Lost Mar 11, 2028": a carried inspection whose 60 days ran out. */
export const lostWords = (day: string): string =>
  `Lost ${longDay(day)}: not done in its ${CARRY_DAYS} days`;

// ── Skip an inspection (owner, Nov 20) ──────────────────────────────────────────────────────
//
// "Skip this inspection": a manager or an admin says we will not do it, with a reason. Its
// ticket comes off the board and the morning run does not make it again. It still counts as an
// inspection owed to the customer: a renewal takes its price off or carries it, and a refund
// counts it as not done. Deleting the ticket instead is refused by the database, in words
// that point here.
export const SKIP_LABEL = "Skip this inspection";
export const SKIP_NOTE =
  "For an inspection we will not do. Its ticket comes off the board and is not made again. It still counts as an inspection owed to the customer: the renewal takes its price off or carries it, and a refund counts it as not done.";
export const SKIP_REASON_NEEDED = "Type why this inspection is skipped";
/** "Skipped Nov 20, 2026 by Dana: the roof is being replaced. Still owed to the customer." */
export function skippedWords(
  v: Pick<PlanVisit, "skipped_on" | "skip_reason" | "skipped_by_name">,
): string {
  if (!v.skipped_on) return "";
  const who = (v.skipped_by_name ?? "").trim();
  const why = (v.skip_reason ?? "").trim().replace(/[.\s]+$/, "");
  return `Skipped ${longDay(v.skipped_on)}${who ? ` by ${who}` : ""}${why ? `: ${why}` : ""}. Still owed to the customer.`;
}

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
export function carePlanLineWords(
  plan: unknown,
  kind: VisitKind,
  paidFirst = false,
  /** A storm inspection beyond the ones the plan includes (Nov 19): billed by itself. */
  billedStorm = false,
): string {
  const name = planName(plan);
  if (kind === "storm")
    return billedStorm
      ? `${name} plan: further storm inspection this plan year`
      : `${name} plan: storm inspection (included in the plan)`;
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
// Nov 19, later (version 2026-11-19.2), at the owner's "go" and "ensure it makes it into the
// service agreement": term 9 also names the leak call travel and the storm inspection, and term
// 10 is new: the plan ends after its twelve months, the price of one inspection comes off the
// renewal for one we did not get to, and one we were kept from can be done in the first 60 days.
// Nov 19, night (version 2026-11-19.3), at the owner's "go" on the card fee: term 9 says a year
// paid by card is refunded less the card processing fee on the amount refunded.
// Nov 19, late (version 2026-11-19.4), at the owner's "10. Go." and "11. Second inspection billed
// at inspection price and their repair allocation contributes to the price if they have any
// left": term 7 charges the return trip after the first visit of a plan year we could not do
// for want of access, and term 8 bills a storm inspection beyond the one the plan includes.
// Nov 23 (version 2026-11-23.1), at the owner's "make sure number 6 is included in the terms":
// term 3 says what the plan includes applies to work done in its twelve months, and that work
// done before the plan starts is not covered (the database's rule since 20261123100000).
// Nov 24 (version 2026-11-24.1), at the owner's word: the last term says what an inspection is
// and that we are not responsible for a leak or for a condition we did not find.
// Nov 24, later (version 2026-11-24.2): the fourth term no longer says "once". A manager may
// correct a plan's roof size more than once, and each correction is kept on the plan.
export const ROOF_CARE_TERMS_VERSION = "2026-11-24.2";
export const ROOF_CARE_TERMS: readonly string[] = [
  "Your plan includes the services listed for it on the Roof Care Plans sheet.",
  "The yearly price is paid in full before the plan starts. We send one invoice for the year.",
  // Nov 23 (owner: "make sure number 6 is included in the terms"): what the plan includes is for
  // work done inside its twelve months, never for work done before it started.
  "The plan runs for twelve months from the day we receive your payment. What the plan includes applies to work done in those twelve months. Work done before the plan starts is not covered.",
  // Nov 24 (owner, of how many times a size may be corrected: "more than once but recorded and
  // remove that line"; asked which, he chose to drop only the word "once").
  "The price is an estimate until we measure the roof. If the roof's size is different, the price is corrected.",
  "Minor repairs included in the plan are valued at our standard rates. An unused amount does not carry over to the next year.",
  "Repairs beyond what the plan includes are quoted to you first and billed separately.",
  "You give us access to the roof on the agreed day. The first visit in a plan year that we cannot do because we could not get on the roof is rescheduled at no charge. After that, the return trip is charged at our trip rate, and what is left of the plan's minor repairs amount is used toward it first.",
  "A storm inspection, where the plan includes one, is done when you ask for it after a storm. A further storm inspection in the same plan year is billed at the price of one inspection, and what is left of the plan's minor repairs amount is used toward it first.",
  "Either of us can end the plan in writing. We refund the share for inspections not yet done, less any minor repairs the plan has already covered and any leak call travel we did not charge. A storm inspection counts as an inspection done. A year paid by card is refunded less the card processing fee on the amount refunded.",
  "The plan ends after its twelve months unless it is renewed. If an inspection was not done by then because we could not get there, the price of one inspection is taken off the renewal. If it was not done because we were not given access, it can still be done in the first 60 days of the new plan year.",
  // Nov 24 (owner: "we likely need to add a disclaimer ... were not responsible essentially if we
  // miss something and they have a leak"; of the two drafts, "the shorter version looks fine").
  "The plan is not a warranty or insurance and does not cover replacing the roof. An inspection is a visual check on the day of the visit and cannot find every problem. We are not responsible for leaks or for damage from a leak or from a condition we did not find.",
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

// ── The typed size against the map's (owner, Nov 20) ────────────────────────────────────────
//
// "fix 4 (what happens if it cant be found on the map?)". When the property has a size from
// the map, a typed size more than 20% smaller is not signed: a technician and the office are
// told both sizes, and a manager or an admin may go on after ticking that the typed size is
// right (their name is kept). A larger typed size is always taken: a property can have more
// roofs than the one the map found. When the map has no size, the typed one is taken as it is,
// the plan is marked, and the Owner page lists it until a manager confirms the size. The
// database decides (roof_care_sign_up_await_payment); this is its twin for the screen.

/** A typed size this much smaller than the map's is not signed without a manager. */
export const SIZE_SMALLER_LIMIT = 0.2;
export type SizeCheck = "ok" | "smaller" | "unchecked";

/** `mapSqft`: the size kept on the property (crm_sites.map_roof_sqft); null when none. */
export function sizeAgainstMap(typed: number, mapSqft: number | null | undefined): SizeCheck {
  if (mapSqft == null || !Number.isFinite(mapSqft) || mapSqft < MAP_ROOF_MIN_SQFT)
    return "unchecked";
  return typed < mapSqft * (1 - SIZE_SMALLER_LIMIT) ? "smaller" : "ok";
}

const sqftWords = (n: number) => Math.round(n).toLocaleString("en-US");

export const SIZE_OK_LABEL = "The typed size is right";

/** What the sign-up says when the typed size is too small, to someone who can go on or not. */
export function sizeSmallerLine(mapSqft: number, typed: number, manager: boolean): string {
  const base = `The map shows about ${sqftWords(Math.round(mapSqft / 100) * 100)} sq ft of roof at this property, and ${sqftWords(typed)} sq ft was typed: more than 20% smaller.`;
  return manager
    ? `${base} Tick "${SIZE_OK_LABEL}" to sign the plan up at the typed size. Your name is kept with it.`
    : `${base} Check the size and type the whole roof. If the typed size is right, a manager or an admin signs this plan up: they can confirm it.`;
}
/** On a plan signed where the map had no size. */
export const SIZE_UNCHECKED_WORDS = "Roof size typed by hand, not checked against the map";
export const SIZE_UNCHECKED_STAFF_NOTE =
  "The map has no roof size for this property, so the typed size is taken as it is. The plan is marked, and a manager or an admin confirms the size afterwards.";
export const SIZE_CONFIRM_LABEL = "Confirm the roof size";
/** A size of 0 or below: the database's own words. */
export const SIZE_NEEDED = "Type the roof's size in square feet: a number above 0";

// ── Correcting a plan's roof size (owner, Nov 24) ───────────────────────────────────────────

export const SIZE_CORRECT_LABEL = "Correct the roof size";
export const SIZE_CORRECT_SHOW = "Show the new price";
export const SIZE_CORRECT_SAVE = "Save the new size";
export const SIZE_CORRECT_MANAGERS = "Only a manager or an admin corrects a plan's roof size";
/** The size typed is the one the plan has: said at "Show the new price", in the database's own words. */
export const SIZE_CORRECT_SAME =
  "That is the size the plan already has. To say it is right, press Confirm the roof size.";
export const SIZE_CORRECT_LEAD_WAITING =
  "Type the size you measured. The plan's price follows it, and its invoice is made again at the new price. Nothing changes until you press Save.";
export const SIZE_CORRECT_LEAD_PAID =
  "Type the size you measured. This plan year is already paid. A bigger roof is billed the difference on an invoice of its own. A smaller roof is owed the difference back. Nothing changes until you press Save.";
export const SIZE_REFUND_RECORD = "Record the refund";
export const SIZE_INVOICE_MAKE = "Make the invoice for the difference";
export const SIZE_REFUND_LEAD =
  "Send the customer the amount by check or back to their card, then record it here: the day it was sent and its check number or reference.";
/** The tick that sends the customer the new price, with the payment link for a card plan. */
export const sizeCorrectEmailLabel = (card: boolean): string =>
  card
    ? "Email the customer the new price, with the payment link"
    : "Email the customer the new price";

const dollars0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const dollars2 = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "$214 more a year", "$90 less a year" or "the same price". */
export function priceDifferenceWords(from: number, to: number): string {
  const d = Math.round(to) - Math.round(from);
  if (d === 0) return "the same price";
  return `${dollars0(Math.abs(d))} ${d > 0 ? "more" : "less"} a year`;
}

/** What the box says once the new price is read, before anything is saved. */
export function sizeOfferWords(o: {
  from_sqft: number;
  to_sqft: number;
  from_price: number;
  to_price: number;
  repriced: boolean;
  /** A plan already paid: what saving would leave owed (above 0 to us, below 0 back). */
  paid?: boolean;
  owed?: number;
}): string {
  const sizes = `${sqftWords(o.from_sqft)} sq ft to ${sqftWords(o.to_sqft)} sq ft`;
  if (o.paid) {
    const owed = o.owed ?? 0;
    const settle =
      owed > 0
        ? `The plan year is already paid, so an invoice for the ${dollars2(owed)} difference is made as a draft.`
        : owed < 0
          ? `The plan year is already paid, so ${dollars2(-owed)} is owed back to the customer.`
          : "Nothing more is owed either way.";
    return `From ${sizes}. The price goes from ${dollars0(o.from_price)} to ${dollars0(o.to_price)} a year. ${settle}`;
  }
  return o.repriced
    ? `From ${sizes}. The price goes from ${dollars0(o.from_price)} to ${dollars0(o.to_price)} a year: ${priceDifferenceWords(o.from_price, o.to_price)}.`
    : `From ${sizes}. This plan year stays at the ${dollars0(o.from_price)} it was paid at. At the corrected size a year is ${dollars0(o.to_price)}: ${priceDifferenceWords(o.from_price, o.to_price)}.`;
}

/** What is said once a corrected size is saved: what changed, and what did not happen. */
export function sizeSavedWords(r: {
  change: PlanSizeChange;
  invoice_made: boolean;
  emailed_to: string | null;
  email_reason: string | null;
}): string {
  const c = r.change;
  const price = c.repriced
    ? ` The plan is now ${dollars0(c.to_price)} a year.`
    : " This plan year's price is unchanged.";
  const owed = c.paid ? (c.owed ?? 0) : 0;
  const invoice = c.paid
    ? owed > 0
      ? r.invoice_made
        ? ` An invoice for the ${dollars2(owed)} difference was made as a draft: finalise it and send it.`
        : ` The invoice for the ${dollars2(owed)} difference was not made: press ${SIZE_INVOICE_MAKE} on the plan.`
      : owed < 0
        ? ` ${dollars2(-owed)} is owed back to the customer: send it, then press ${SIZE_REFUND_RECORD} on the plan.`
        : ""
    : c.repriced && !r.invoice_made
      ? " Its invoice was not made again: press Make the invoice on the plan."
      : "";
  const email = r.emailed_to
    ? ` ${r.emailed_to} was emailed the new price.`
    : r.email_reason
      ? ` The customer was not emailed: ${r.email_reason}`
      : "";
  return `Roof size corrected to ${sqftWords(c.to_sqft)} sq ft.${price}${invoice}${email}`;
}

/** One correction as the plan's record says it. `money`: for someone who sees prices. */
export function sizeChangeWords(c: PlanSizeChange, money: boolean): string {
  const head = `Roof size corrected from ${sqftWords(c.from_sqft)} to ${sqftWords(c.to_sqft)} sq ft by ${c.by_name || "a manager"} on ${longDay(c.on)}.`;
  const owed = c.paid ? (c.owed ?? 0) : 0;
  const settled = !c.paid
    ? ""
    : owed > 0
      ? ` The plan year was already paid: ${dollars2(owed)} more was billed.`
      : owed < 0
        ? ` The plan year was already paid: ${dollars2(-owed)} was owed back.`
        : "";
  const price = !money
    ? ""
    : c.repriced
      ? ` The price went from ${dollars0(c.from_price)} to ${dollars0(c.to_price)} a year.${settled}`
      : ` The plan year was already paid, so its price stayed ${dollars0(c.from_price)}. At that size a year was ${dollars0(c.would_be)}.`;
  return `${head}${price}${c.note ? ` Note: ${c.note}` : ""}`;
}

/** What a corrected size on a paid plan still leaves to settle, for someone who sees prices. */
export function sizeBalanceWords(b: PlanSizeBalance): string {
  if (b.owed > 0) {
    const inv = b.invoice
      ? `Invoice #${b.invoice.number} for it is ${b.invoice.status === "draft" ? "a draft: finalise it and send it" : "sent and not paid yet"}.`
      : "The invoice for it is not made yet.";
    return `The corrected roof size costs ${dollars2(b.owed)} more this plan year. ${inv}`;
  }
  if (b.owed < 0)
    return `The corrected roof size costs ${dollars2(-b.owed)} less this plan year. That is owed back to the customer.`;
  return "";
}

/** "$120.00 sent back for the smaller roof on Nov 24, 2026 by Dana (check 123)." */
export const sizeRefundWords = (r: SizeRefund): string =>
  `${dollars2(r.amount)} sent back for the smaller roof on ${longDay(r.on)} by ${r.by_name || "a manager"}${r.ref ? ` (${r.ref})` : ""}.`;

/** "Roof size 20,000 sq ft: typed by hand, not checked against the map." and who confirmed. */
export function planSizeWords(p: Pick<RoofCarePlan, "roof_sqft" | "size">): string {
  const s = p.size;
  if (!s) return "";
  const size = `${sqftWords(p.roof_sqft)} sq ft`;
  if (s.unchecked)
    return `Roof size ${size}: typed by hand, not checked against the map. A manager or an admin confirms it.`;
  if (s.confirmed)
    return `Roof size ${size}, confirmed by ${s.confirmed.by_name || "a manager"} on ${longDay(s.confirmed.on)}${s.map_sqft != null ? ` (the map showed about ${sqftWords(Math.round(s.map_sqft / 100) * 100)} sq ft)` : ""}.`;
  return "";
}

/** Why a shown price is an estimate, when it is. */
export type PriceEstimate = "rough" | "just-now" | null;

// ── A technician's plans (owner, Nov 20) ────────────────────────────────────────────────────
//
// "A technician reads a plan only with the money left out." The database no longer answers a
// technician from the plan tables. Their screens get the plan from roof_care_field_plans():
// its state and dates, what it includes, and each inspection with the stage of its ticket,
// whoever that ticket is with, so "2 of 2 done" is counted from every ticket and not only from
// the ones that technician can open. No price, drive, refund, credit or billed amount is in
// that answer, so none is here: the amounts read 0 or null, as for anyone who does not see
// invoices.

/**
 * Who the plan tables answer: the office. The twin of the row rule of roof_care_plans
 * (20261120650000): Customers or Estimate access, or Service access for someone who is not a
 * technician. Anyone else is given the plan by the database's functions that leave the money
 * out.
 */
export const readsPlanTables = (p: AccessLike | null | undefined): boolean =>
  canAccess(p, "customers") ||
  canAccess(p, "estimate") ||
  (canAccess(p, "service") && !isFieldOnly(p));

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const flag = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
// One owed from last plan year leads: it is the one with the clock on it.
const VISIT_ORDER: Record<VisitKind, number> = { carried: -1, visit1: 0, visit2: 1, storm: 2 };

function readFieldVisit(raw: unknown): PlanVisit | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const kind = (VISIT_KINDS as readonly string[]).includes(String(v["kind"]))
    ? (v["kind"] as VisitKind)
    : null;
  const id = text(v["id"]);
  const from = text(v["due_from"]);
  const by = text(v["due_by"]);
  if (!kind || !id || !from || !by) return null;
  const t =
    v["ticket"] && typeof v["ticket"] === "object"
      ? (v["ticket"] as Record<string, unknown>)
      : null;
  const ticketId = t ? text(t["id"]) : null;
  const ticket: VisitTicket | null =
    t && ticketId && typeof t["stage"] === "string"
      ? {
          id: ticketId,
          number: Number(t["number"]) || 0,
          stage: t["stage"],
          scheduled_date: text(t["scheduled_date"]),
          completed_at: text(t["completed_at"]),
          invoice_id: null,
          mine: t["mine"] === true,
        }
      : null;
  return {
    id,
    kind,
    due_from: from,
    due_by: by,
    first_due_by: text(v["first_due_by"]) ?? by,
    amount: 0,
    extra: v["extra"] === true,
    push_reason: text(v["push_reason"]),
    pushed_by_name: text(v["pushed_by_name"]),
    customer_asked: v["customer_asked"] === true,
    lost_on: text(v["lost_on"]),
    skipped_on: text(v["skipped_on"]),
    skip_reason: text(v["skip_reason"]),
    skipped_by_name: text(v["skipped_by_name"]),
    ticket,
    billed: null,
    drains_cleaned: flag(v["drains_cleaned"]),
    gutters_cleaned: flag(v["gutters_cleaned"]),
    cleaning_note: text(v["cleaning_note"]),
    cleaning_by_name: text(v["cleaning_by_name"]),
    cleaning_at: text(v["cleaning_at"]),
  };
}

/**
 * The storm inspections a plan includes in its year (owner, Nov 20, break test 31): the number
 * kept on the plan when it was signed, so a change of the setting reaches new plans only.
 * `fromSettings` is used only for a plan from before the number was kept.
 */
export function ownStormCount(own: unknown, fromSettings: number | null | undefined): number {
  const n =
    typeof own === "number" ? own : typeof own === "string" && own.trim() ? Number(own) : NaN;
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  return Math.max(0, Math.round(fromSettings ?? 0));
}

/**
 * The database's answer for a technician as plans. Anything that is not a plan is left out,
 * never guessed. `stormIncluded`: the storm inspections a year each plan includes (the plan
 * settings).
 */
export function readFieldPlans(
  x: unknown,
  stormIncluded: Partial<Record<PlanKey, number>> = {},
): RoofCarePlan[] {
  if (!Array.isArray(x)) return [];
  const out: RoofCarePlan[] = [];
  for (const raw of x) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const plan = asPlanKey(p["plan"]);
    const id = text(p["id"]);
    const account = text(p["account_id"]);
    const site = text(p["site_id"]);
    const signed = text(p["signed_on"]);
    const renews = text(p["renews_on"]);
    if (!plan || !id || !account || !site || !signed || !renews) continue;
    const visits = (Array.isArray(p["visits"]) ? p["visits"] : [])
      .map(readFieldVisit)
      .filter((v): v is PlanVisit => !!v)
      .sort(
        (a, b) => VISIT_ORDER[a.kind] - VISIT_ORDER[b.kind] || a.due_from.localeCompare(b.due_from),
      );
    const closedOn = text(p["closed_out_on"]);
    out.push({
      id,
      account_id: account,
      site_id: site,
      plan,
      status: asPlanStatus(p["status"]),
      pay_first: p["pay_first"] === true,
      plan_number: typeof p["plan_number"] === "number" ? p["plan_number"] : null,
      first_visit: (FIRST_VISIT_CHOICES as readonly string[]).includes(String(p["first_visit"]))
        ? (p["first_visit"] as FirstVisit)
        : "window",
      first_days: typeof p["first_days"] === "number" ? p["first_days"] : null,
      starts_on: text(p["starts_on"]),
      invoice: null,
      pay_method: asPayMethod(p["pay_method"]),
      pay_note: null,
      free_travel_calls: Number(p["free_travel_calls"]) || 0,
      free_travel_used: null,
      refund: null,
      closed_out: closedOn
        ? { on: closedOn, reason: (text(p["closed_out_reason"]) ?? "").trim() }
        : null,
      renewed_from: text(p["renewed_from"]),
      renewal_choice: null,
      renewal_credit: 0,
      signed_on: signed,
      renews_on: renews,
      roof_sqft: Number(p["roof_sqft"]) || 0,
      price: 0,
      price_estimated: p["price_estimated"] === true,
      repair_allowance: Number(p["repair_allowance"]) || 0,
      allowance_used: null,
      allowance_uses: [],
      agreed_by: text(p["agreed_by"]) ?? "",
      sold_by_name: text(p["sold_by_name"]) ?? "",
      notes: "",
      ended_on: text(p["ended_on"]),
      ended_reason: text(p["ended_reason"]),
      visits,
      storm_included: ownStormCount(p["storm_included"], stormIncluded[plan]),
      no_access: null,
      forecast_sent_on: text(p["forecast_sent_on"]),
      card_paid: null,
      size: { unchecked: p["size_unchecked"] === true, map_sqft: null, confirmed: null },
    });
  }
  return out;
}

// ── One press at a time (owner, Nov 20) ─────────────────────────────────────────────────────
//
// "two presses at the same instant show one message, the success". A button is greyed once its
// work has started, but two presses in the same instant both land before the screen has drawn
// that. This lets the first through and drops the others until the first is over.

/** Wraps a press: while one run is going, another press does nothing and returns false. */
export function onePressAtATime(): (run: () => Promise<unknown>) => boolean {
  let busy = false;
  return (run) => {
    if (busy) return false;
    busy = true;
    void run()
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
    return true;
  };
}
