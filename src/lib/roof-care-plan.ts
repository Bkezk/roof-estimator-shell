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

export const VISIT_KINDS = ["visit1", "visit2", "storm"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];
export const FIRST_VISIT_CHOICES = ["now", "days", "window"] as const;
export type FirstVisit = (typeof FIRST_VISIT_CHOICES)[number];

/** A push-back of more than this many days past the first date needs a manager and a reason. */
export const PUSH_LIMIT_DAYS = 30;
/** The second inspection is at least this long after the first. */
export const SECOND_VISIT_GAP_DAYS = 120;
/** A ticket is made this many days before its inspection is due. */
export const TICKET_LEAD_DAYS = 14;

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
  ticket: VisitTicket | null;
}

export interface RoofCarePlan {
  id: string;
  account_id: string;
  site_id: string;
  plan: PlanKey;
  status: "active" | "ended";
  signed_on: string;
  renews_on: string;
  roof_sqft: number;
  price: number;
  list_price: number;
  travel_price: number;
  price_estimated: boolean;
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
  const w = windowsFrom(earliest)[0]!;
  const year = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  // Feb 29 has no day a year on; the database lands on Feb 28.
  let renews = /^\d{4}-02-29$/.test(year) ? `${year.slice(0, 4)}-02-28` : year;
  const from = w.from > earliest ? w.from : earliest;
  let to = w.to;
  if (from <= renews) to = to < renews ? to : renews;
  else renews = to;
  return { first: v1, second: { from, to }, renews };
}

// ── What a visit is doing ───────────────────────────────────────────────────────────────────

/** Stages at which the inspection has been done on the roof. */
const DONE_STAGES = ["done", "authorized", "invoiced", "closed"];

export type VisitState = "done" | "late" | "ticket" | "waiting";

/**
 * Done (the ticket is Done or further), late (not done and past its last day), a ticket is out
 * for it, or it is waiting for its time.
 */
export function visitState(v: PlanVisit, today: string): VisitState {
  if (v.ticket && DONE_STAGES.includes(v.ticket.stage)) return "done";
  if (today > v.due_by) return "late";
  return v.ticket ? "ticket" : "waiting";
}

export const VISIT_LABEL: Record<VisitKind, string> = {
  visit1: "Inspection 1",
  visit2: "Inspection 2",
  storm: "Storm inspection",
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
    else visits++;
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

/** The plan year ran on because an inspection was pushed past it. */
export function runsLate(p: Pick<RoofCarePlan, "signed_on" | "renews_on">): boolean {
  const year = `${Number(p.signed_on.slice(0, 4)) + 1}${p.signed_on.slice(4)}`;
  return p.renews_on > year;
}

/** The badge on a property: "Roof Guard", and "ended" for a plan that is over. */
export function planBadge(p: Pick<RoofCarePlan, "plan" | "status">): string {
  return p.status === "ended" ? `${planName(p.plan)} (ended)` : planName(p.plan);
}

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

/** "Roof Guard plan: inspection 1 of 2 (half of the yearly price)". */
export function carePlanLineWords(plan: unknown, kind: VisitKind): string {
  const name = planName(plan);
  if (kind === "storm") return `${name} plan: storm inspection (included in the plan)`;
  return `${name} plan: inspection ${kind === "visit1" ? 1 : 2} of 2 (half of the yearly price)`;
}

/** The note on the ticket's own lines of a visit's invoice: they are covered by the plan. */
export const CARE_PLAN_COVERED = "Included in the Roof Care plan";
