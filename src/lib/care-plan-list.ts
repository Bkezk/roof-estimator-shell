/**
 * The Care plans tab of the Customers page (owner, Nov 23: "add a care plan tab that shows the
 * customers that have a plan, which plan they have, their reference number they get when they
 * sign up, their price, and any other pertinent details").
 *
 * One row for each plan: whose it is, at which property, which plan, its number, its yearly
 * price, where it stands, when it renews and when the next inspection is due. Pure: the server
 * read is care-plan-list.functions.ts and the screen is components/crm/care-plans-section.tsx.
 *
 * The Customers page is not a technician's page, so nobody in the field reads this list.
 */
import { daysBetween, longDay } from "@/lib/followup-rules";
import {
  dueWords,
  isExpired,
  planName,
  planNumberLabel,
  visitState,
  visitsDone,
  type PayMethod,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import type { PlanKey } from "@/lib/roof-care-price";

/** Where a plan stands, as the list says it. */
export type CarePlanState = "active" | "waiting" | "expired" | "ended";
export const CARE_PLAN_STATE_WORDS: Record<CarePlanState, string> = {
  active: "Active",
  waiting: "Waiting for payment",
  expired: "Expired",
  ended: "Ended",
};

export interface CarePlanRow {
  id: string;
  account_id: string;
  /** The customer's name; "" when the customer could not be read. */
  account_name: string;
  site_id: string;
  /** The property's name, or its street when it has no name. */
  site_name: string;
  /** "London, KY". */
  site_place: string;
  plan: PlanKey;
  /** "RC-1001"; "" for a plan signed before plans were numbered. */
  number: string;
  state: CarePlanState;
  /** The yearly price. */
  price: number;
  /** The price was worked on a drive we could only estimate. */
  price_estimated: boolean;
  roof_sqft: number;
  signed_on: string;
  /** The first day of the plan year: the day it was paid. Null while it waits for payment. */
  starts_on: string | null;
  renews_on: string;
  ended_on: string | null;
  ended_reason: string | null;
  pay_method: PayMethod | null;
  /** Who signed the customer up, and who the customer said referred them. */
  sold_by_name: string;
  referred_by: string;
  /** The minor repairs the plan includes each year, in dollars; 0 when it includes none. */
  repair_allowance: number;
  /** How many of this year's two inspections are done. */
  inspections_done: number;
  /** The next inspection not done yet, in words: "Due Mar 15 to May 15, 2027". "" when none. */
  next_inspection: string;
  /** That inspection is past its last day. */
  next_late: boolean;
  /** This plan is a renewal of last year's. */
  renewal: boolean;
}

export const carePlanState = (
  p: Pick<RoofCarePlan, "status"> & { ended_reason?: string | null },
): CarePlanState =>
  p.status === "awaiting_payment"
    ? "waiting"
    : p.status === "active"
      ? "active"
      : isExpired(p)
        ? "expired"
        : "ended";

/** One plan as a row of the list. */
export function carePlanRow(
  p: RoofCarePlan,
  names: { account_name: string; site_name: string; site_place: string; referred_by: string },
  today: string,
): CarePlanRow {
  const state = carePlanState(p);
  // The next inspection still to do: the earliest one not done, skipped or lost. A plan that is
  // over, or not paid yet, has none to show.
  const open =
    state === "active"
      ? [...p.visits]
          .filter((v) => {
            const s = visitState(v, today);
            return s !== "done" && s !== "skipped" && s !== "lost";
          })
          .sort((a, b) => (a.due_by < b.due_by ? -1 : a.due_by > b.due_by ? 1 : 0))[0]
      : undefined;
  return {
    id: p.id,
    account_id: p.account_id,
    account_name: names.account_name,
    site_id: p.site_id,
    site_name: names.site_name,
    site_place: names.site_place,
    plan: p.plan,
    number: p.plan_number != null ? planNumberLabel(p.plan_number) : "",
    state,
    price: p.price,
    price_estimated: p.price_estimated,
    roof_sqft: p.roof_sqft,
    signed_on: p.signed_on,
    starts_on: p.starts_on,
    renews_on: p.renews_on,
    ended_on: p.ended_on,
    ended_reason: p.ended_reason,
    pay_method: p.pay_method,
    sold_by_name: (p.sold_by_name ?? "").trim(),
    referred_by: names.referred_by.trim(),
    repair_allowance: p.repair_allowance,
    inspections_done: visitsDone(p, today).visits,
    next_inspection: open ? dueWords(open) : "",
    next_late: open ? visitState(open, today) === "late" : false,
    renewal: !!p.renewed_from,
  };
}

// ── What the list shows ──────────────────────────────────────────────────────────────────────

/** The chips over the list. "Current" is every plan not over: active and waiting for payment. */
export const CARE_PLAN_SHOWS = ["current", "active", "waiting", "over", "all"] as const;
export type CarePlanShow = (typeof CARE_PLAN_SHOWS)[number];
export const CARE_PLAN_SHOW_WORDS: Record<CarePlanShow, string> = {
  current: "Current",
  active: "Active",
  waiting: "Waiting for payment",
  over: "Ended or expired",
  all: "All",
};

const shows = (r: Pick<CarePlanRow, "state">, show: CarePlanShow): boolean =>
  show === "all"
    ? true
    : show === "current"
      ? r.state === "active" || r.state === "waiting"
      : show === "over"
        ? r.state === "ended" || r.state === "expired"
        : r.state === show;

/**
 * The rows a chip and a search leave. The search reads the customer, the property, its town,
 * the plan's name and its number; every word typed has to be found.
 */
export function filterCarePlans(
  rows: readonly CarePlanRow[],
  show: CarePlanShow,
  q: string,
): CarePlanRow[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (!shows(r, show)) return false;
    if (!words.length) return true;
    const hay =
      `${r.account_name} ${r.site_name} ${r.site_place} ${planName(r.plan)} ${r.number} ${r.number.replace(/\D/g, "")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const STATE_ORDER: Record<CarePlanState, number> = { waiting: 0, active: 1, expired: 2, ended: 3 };

/**
 * Waiting for payment first (someone is owed a call), then active by the day they renew, soonest
 * first, then the ones that are over, newest first.
 */
export function sortCarePlans(rows: readonly CarePlanRow[]): CarePlanRow[] {
  return [...rows].sort((a, b) => {
    const s = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (s) return s;
    if (a.state === "active" && a.renews_on !== b.renews_on)
      return a.renews_on < b.renews_on ? -1 : 1;
    if (a.state !== "active" && a.signed_on !== b.signed_on)
      return a.signed_on > b.signed_on ? -1 : 1;
    return a.account_name.localeCompare(b.account_name);
  });
}

/** How many plans are in force and waiting, and what the active ones bring in a year. */
export function carePlanTotals(rows: readonly CarePlanRow[]): {
  active: number;
  waiting: number;
  yearly: number;
} {
  let active = 0;
  let waiting = 0;
  let yearly = 0;
  for (const r of rows) {
    if (r.state === "active") {
      active++;
      yearly += r.price;
    } else if (r.state === "waiting") waiting++;
  }
  return { active, waiting, yearly: Math.round(yearly * 100) / 100 };
}

const plans = (n: number) => `${n} ${n === 1 ? "plan" : "plans"}`;
const dollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** "3 active plans, $9,870 a year. 1 waiting for payment." */
export function carePlanTotalsWords(rows: readonly CarePlanRow[]): string {
  const t = carePlanTotals(rows);
  if (!t.active && !t.waiting) return "No plan is active.";
  const a = t.active
    ? `${t.active} active ${t.active === 1 ? "plan" : "plans"}, ${dollars(t.yearly)} a year.`
    : "No plan is active.";
  return t.waiting ? `${a} ${plans(t.waiting)} waiting for payment.` : a;
}

/** A plan in its last days is pointed out: the renewal can be made this many days ahead. */
export const CARE_PLAN_RENEWS_SOON_DAYS = 60;

/**
 * The Renews column: "Nov 23, 2027" for a plan in force, with how close it is when it is near;
 * what happened for one that is over; and that the year has not started for one not paid.
 */
export function carePlanRenewsWords(
  r: Pick<CarePlanRow, "state" | "renews_on" | "ended_on">,
  today: string,
): { text: string; soon: boolean } {
  if (r.state === "waiting") return { text: "Starts when it is paid", soon: false };
  if (r.state === "expired")
    return { text: `Expired ${longDay(r.ended_on || r.renews_on)}`, soon: false };
  if (r.state === "ended")
    return { text: r.ended_on ? `Ended ${longDay(r.ended_on)}` : "Ended", soon: false };
  const n = daysBetween(today, r.renews_on);
  const day = longDay(r.renews_on);
  if (n > CARE_PLAN_RENEWS_SOON_DAYS) return { text: day, soon: false };
  if (n > 1) return { text: `${day}, in ${n} days`, soon: true };
  if (n === 1) return { text: `${day}, tomorrow`, soon: true };
  if (n === 0) return { text: `${day}, today`, soon: true };
  return { text: `${day}, ${-n} ${n === -1 ? "day" : "days"} ago`, soon: true };
}

/** "Signed up by Ann Admin. Referred by Tom Tech." Either, both or neither. */
export function carePlanCreditWords(r: Pick<CarePlanRow, "sold_by_name" | "referred_by">): string {
  const sold = r.sold_by_name ? `Signed up by ${r.sold_by_name}.` : "";
  const ref = r.referred_by ? `Referred by ${r.referred_by}.` : "";
  return [sold, ref].filter(Boolean).join(" ");
}

/** Said in the list's place while no customer has a plan. */
export const CARE_PLANS_NONE =
  "No customer has a Roof Care plan yet. A plan is signed from a property's page, with the Care Plan button.";
export const CARE_PLANS_NONE_SHOWN = "No plan matches. Change the search or pick another view.";
export const carePlanListKey = ["care-plan-list"] as const;
