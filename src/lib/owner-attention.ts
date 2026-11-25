/**
 * The Owner page's "Needs attention" list (owner, Nov 15: "one issue we run into on the roofing
 * business is things not getting started or followed up on" … "i more so meant like keep the
 * owner on top of things"). One list at the top of the Owner page, found by rules: nobody adds
 * a row and nobody on the staff can dismiss one. A row leaves when the work is done. The one
 * exception is an inspection a manager or an admin marks "No action needed" (Nov 16): its row
 * leaves, and comes back when that is taken back or the inspection is reopened (Nov 18).
 *
 * The owner approved three groups and these rows ("Those are right"), with tickets waiting on
 * an invoice left out ("Yes noise") and no morning brief ("No morning brief please"):
 *
 *   Not started
 *     - a ticket past its date with nobody on it (no date at all: entered longer ago than
 *       Setup's "needs assignment" limit);
 *     - a ticket past its date that its technician has not started (crm_untouched(), the
 *       "Untouched work" limit, in working days; its days late and its color count working
 *       days too);
 *     - an opportunity with no contact logged N days after it was assigned (the same list's
 *       opportunity half and its limit), and an open one nobody is on at all, past the "needs
 *       assignment" limit;
 *     - a draft bid past its due date (work-counts.ts isOverdueBid).
 *   Not followed up
 *     - a submitted bid with no follow-up date `bidDays` days after it was sent (sent twice:
 *       after the latest time), or whose follow-up date ("Remind me on", bids.reminder_on) has
 *       passed; a follow-up date from before the day the bid was sent does not count;
 *     - an inspection, Authorized or later, that found problems or was graded F and has no live
 *       repair ticket or bid after it: nobody has chosen what happens next (or the repair
 *       ticket or bid that was chosen has been deleted), counted from the day the inspection
 *       was finished. "No action needed" on the ticket takes it off at once (owner, Nov 16;
 *       it used to stay 30 days).
 *   Waiting on the office
 *     - a Done ticket not authorized `authorizeDays` days after the work was finished (an
 *       inspection still at Done has this row only);
 *     - an invoice unpaid past its due date, or, with no due date, late by the Invoices page's
 *       own rule (invoice-list.ts invoiceDue: 30 days after its invoice date).
 *
 * A manager's hold takes a ticket or an opportunity off the list until the hold ends, as it does
 * everywhere else (work-counts.ts heldTicketIds / heldOppIds); the list says how many are held.
 *
 * Amber is past the limit; red is twice the limit or more (`redFrom`). A wait that began today
 * reads "Today", never "0 days". A bid nobody is recorded as having made is filed under "No
 * estimator", apart from "Nobody" (work with nobody on it, which the screen paints red).
 *
 * Owner, Nov 16 (the audit's fixes 11 to 22, each approved): the no-due-date invoice, the
 * finished day as the start of an inspection's and a Done ticket's wait, the deleted repair
 * ticket or bid, working days for the untouched ticket's color, the bid sent twice, the
 * follow-up date from before the bid was sent, one row for a Done inspection, "Today", the F
 * grade, "No estimator", and amber before red for a passed follow-up date. Pinned in
 * owner-attention-nov16.test.ts.
 *
 * Pure: plain rows and the viewer's day in, rows and words out. The server function is
 * owner-attention.functions.ts; components/owner-attention.tsx draws it.
 */
import { bidHref } from "@/lib/bid-kind";
import { asBidStatus } from "@/lib/bid-status";
import { daysBetween, shortDay } from "@/lib/followup-rules";
import { isFlagged, visibleChecklist, type InspectionGrade } from "@/lib/inspection";
import { ON_RECEIPT_LATE_DAYS, invoiceDue } from "@/lib/invoice-list";
import { addDays, isHeldOn } from "@/lib/my-work";
import {
  CARRY_DAYS,
  EXPIRED_LISTED_DAYS,
  RENEW_LABEL,
  RENEWAL_OPEN_DAYS,
  SIZE_CONFIRM_LABEL,
  SIZE_INVOICE_MAKE,
  SIZE_REFUND_RECORD,
  SIZE_UNCHECKED_WORDS,
} from "@/lib/roof-care-plan";
import { requestOpportunityPath } from "@/lib/public-requests";
import { TYPE_LABELS, type ServiceType } from "@/lib/service.functions";
import { CARE_PLAN_BILL_LABEL } from "@/lib/ticket-stage";
import { isFinishedStage } from "@/lib/ticket-stages";
import { bidOverdueDays, isOpenOppStatus } from "@/lib/work-counts";
import { officeDay, workingDaysBetween } from "@/lib/working-days";

export type AttentionGroup = "not_started" | "not_followed_up" | "office";
export const ATTENTION_GROUPS: readonly { key: AttentionGroup; label: string }[] = [
  { key: "not_started", label: "Not started" },
  { key: "not_followed_up", label: "Not followed up" },
  { key: "office", label: "Waiting on the office" },
];

export type AttentionKind =
  | "ticket_nobody"
  | "ticket_untouched"
  | "opp_nobody"
  | "opp_untouched"
  | "bid_draft_late"
  | "bid_sent"
  | "inspection_no_next"
  | "to_authorize"
  | "invoice_unpaid"
  | "care_plan_late"
  | "care_plan_no_day"
  | "care_plan_unbilled"
  | "care_plan_unpaid"
  | "care_plan_refund"
  | "care_plan_no_payment"
  | "care_plan_size"
  | "care_plan_size_refund"
  | "care_plan_size_owed"
  | "care_plan_card_back"
  | "public_request"
  | "care_plan_renewal"
  | "care_plan_carried"
  | "care_plan_expired";

/** Setup › Reminders: the two limits of this list's own, and the three it shares. */
export interface AttentionLimits {
  /** A submitted bid with no follow-up date shows after this many days (attention_bid_days). */
  bidDays: number;
  /** A Done ticket shows after this many days without being authorized (attention_authorize_days). */
  authorizeDays: number;
  /** Work with nobody on it and no date (unassigned_overdue_days). */
  unassignedDays: number;
}
export const ATTENTION_DEFAULTS: Readonly<AttentionLimits> = {
  bidDays: 7,
  authorizeDays: 3,
  unassignedDays: 1,
};
export const ATTENTION_DAYS_MAX = 365;

const wholeDays = (v: unknown, fallback: number): number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= ATTENTION_DAYS_MAX
    ? (v as number)
    : fallback;
/**
 * The limits from the settings row. A column that is not there yet (the migration not applied),
 * no row, or a value out of range: the default.
 */
export function attentionLimits(
  row:
    | {
        attention_bid_days?: unknown;
        attention_authorize_days?: unknown;
        unassigned_overdue_days?: unknown;
      }
    | null
    | undefined,
): AttentionLimits {
  return {
    bidDays: wholeDays(row?.attention_bid_days, ATTENTION_DEFAULTS.bidDays),
    authorizeDays: wholeDays(row?.attention_authorize_days, ATTENTION_DEFAULTS.authorizeDays),
    unassignedDays: wholeDays(row?.unassigned_overdue_days, ATTENTION_DEFAULTS.unassignedDays),
  };
}

export interface AttTicket {
  id: string;
  number: number | string;
  customer_name: string | null;
  service_type: string | null;
  stage: string;
  stage_changed_at: string | null;
  /** When the work was finished (the close-out stamp); cleared when the ticket is reopened. */
  completed_at?: string | null;
  updated_at: string | null;
  created_at: string | null;
  scheduled_date: string | null;
  technician_id: string | null;
  /** The saved inspection (service_jobs.inspection), when the ticket is one. */
  inspection?: unknown;
  inspection_outcome?: string | null;
  inspection_outcome_at?: string | null;
  inspection_outcome_by?: string | null;
}
/** A row of crm_untouched(). */
export interface AttUntouched {
  kind: string;
  item_id: string;
  title: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assigned_at: string | null;
  limit_days: number | null;
}
export interface AttOpp {
  id: string;
  title: string | null;
  status: string;
  assignee_id: string | null;
  created_at: string | null;
  expected_close: string | null;
}
export interface AttBid {
  id: string;
  /** "roof" or "trade" (Nov 16): where the row opens. A trade bid is counted like any bid. */
  kind?: string | null;
  name: string | null;
  status: string | null;
  due_date: string | null;
  submitted_at: string | null;
  status_changed_at: string | null;
  updated_at: string | null;
  reminder_on: string | null;
  grand_total: number | string | null;
  created_by: string | null;
}
export interface AttInvoice {
  id: string;
  number: number | string | null;
  display_number?: string | null;
  status: string;
  total: number | string | null;
  paid_amount: number | string | null;
  due_date: string | null;
  /** The invoice's own date: with no due date, it is late 30 days after this (invoiceDue). */
  invoice_date?: string | null;
  /** The invoice's bill-to block (invoices.bill_to, json): its `name` is the title. */
  bill_to: unknown;
}
/** An open follow-up: its hold, and for a Done ticket's review timer, who authorizes. */
export interface AttFollowup {
  kind: string;
  item_id: string;
  status: string;
  snoozed_until: string | null;
  assignee_id?: string | null;
}

/**
 * A Roof Care plan inspection that is not done (owner, Nov 18; docs/roof-care-plans.md). Listed
 * once it is past its last day, and when a push-back carried the plan past its year.
 */
export interface AttCareVisit {
  visit_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  /** "Inspection 1" / "Inspection 2" / "Storm inspection". */
  label: string;
  due_by: string;
  /** What the visit bills. */
  amount: number;
  /** The plan year ran on to this inspection: the renewal moved with it. */
  pastPlanYear: boolean;
}

/**
 * A Roof Care plan inspection that is done and signed off, with its share of the plan on no
 * invoice (owner, Nov 19: "Go with 6"). The draft is made when the ticket is authorized; this
 * is the one somebody then deleted or voided.
 */
/**
 * A Roof Care plan that is signed and not yet paid (owner, Nov 19: the plan is paid for the year
 * before it starts). Nothing happens for the customer until the office sends the invoice and
 * the payment is marked, so it is listed from the first day.
 */
export interface AttCareUnpaid {
  plan_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  signed_on: string;
  /** The yearly price. */
  price: number;
  /** The plan's invoice; null when none has been made yet. */
  invoice: { id: string; number: string; status: string; paid_amount: number } | null;
  /** "Paying by check (#1042)."; "" when the sign-up did not say. */
  pay?: string;
  /** It is the renewal of a plan in force, not a new sign-up. */
  renewal?: boolean;
}

/**
 * A Roof Care plan in the last 60 days of its year, or past it (owner, Nov 19: "sixty days
 * before the renewal, Needs attention lists a plan with an inspection still owed"). Listed while
 * no renewal has been made, and while an inspection the renewal did not take off is still owed.
 */
export interface AttCareRenewal {
  plan_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  renews_on: string;
  /** How many of the year's two inspections are not done. */
  owed: number;
  /** The renewal has been made and waits for its payment. */
  renewed: boolean;
  /** The yearly price. */
  price: number;
}

/**
 * A Roof Care plan whose twelve months ran out without a renewal (owner, Nov 19: "we need to be
 * notified … when a plan expires so we can reach out to renew"). Listed for 60 days, unless the
 * property has a newer plan or a renewal waiting.
 */
export interface AttCareExpired {
  plan_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  expired_on: string;
  /** How many of the year's two inspections were not done. */
  owed: number;
  /** The yearly price it was sold at. */
  price: number;
}

/**
 * An inspection carried into the renewed year because the customer kept us off the roof (owner,
 * Nov 19): owed for 60 days, then lost. Listed until it is done or lost.
 */
/**
 * A Roof Care plan inspection whose ticket has no day (owner, Nov 23: "1 go with A"). The
 * database makes the ticket two weeks before the inspection's window opens, and gives it no day
 * when the window is a range of days. Nothing told anybody to set one, so it is listed from the
 * day the ticket is made until it has a day.
 */
export interface AttCareNoDay {
  visit_id: string;
  /** The inspection's ticket. */
  job_id: string;
  number: number;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  /** "Inspection 1" / "Inspection 2" / "Storm inspection" / the carried one's words. */
  label: string;
  /** The window the inspection is due in. */
  due_from: string;
  due_by: string;
}

export interface AttCareCarried {
  visit_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  /** The last day it can be done. */
  due_by: string;
}

/**
 * A Roof Care plan ended early with a refund a manager confirmed, not yet marked sent (owner,
 * Nov 19).
 */
export interface AttCareRefund {
  plan_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  ended_on: string | null;
  amount: number;
}

/**
 * A roof size corrected after a Roof Care plan was paid, with the difference not settled
 * (Nov 26). Two cases are listed: money owed back for a smaller roof that is not recorded as
 * sent, on any plan; and a bigger roof's difference still owed on a plan whose year is over,
 * which no screen showed once the plan was ended, renewed or ran out. A bigger roof's
 * difference on a plan in force is on the plan itself and is not listed here.
 */
export interface AttCareSizeBalance {
  plan_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  /** Above 0: the customer owes it. Below 0: it is owed back. */
  owed: number;
  /** The plan year is over. */
  ended: boolean;
  /** The day of the last correction, or the day the plan ended when that is later. */
  since: string | null;
  /** The open invoice for a difference owed to us, when it is made. */
  invoice: { id: string; number: string; status: string } | null;
}

/**
 * Card money that has to go back to a customer and is not marked sent back (owner, Nov 20:
 * "go with ... new issue 1"). A card payment for a plan already paid, for one that had ended,
 * one that did not cover what was owed, or the part of a payment over what was owed. Listed
 * until a manager or an admin marks it sent back on the property.
 */
export interface AttPublicRequest {
  id: string;
  /** "R-4012". */
  reference: string;
  /** Who it is from: the company when one was typed, else the person. */
  from: string;
  /** What they asked for: the plan, "a custom quote for …", or the services ticked. */
  ask: string;
  kind: "care" | "service";
  /** The day it came in. */
  sent_on: string | null;
  /** The opportunity it became (Nov 23), where it is answered. */
  opportunity_id?: string | null;
}

export interface AttCareCardBack {
  payment_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  /** What is owed back. */
  amount: number;
  /** The card processor's reference of the payment. */
  ref: string;
  /** The day the payment came in. */
  paid_on: string | null;
  /** Why it goes back, in a sentence (cardBackWords' middle). */
  why: string;
}

/**
 * A Roof Care plan priced on a roof size typed by hand, where the map had none to check it
 * against (owner, Nov 20: break test, number 4). Listed until a manager or an admin confirms
 * the size on the property.
 */
export interface AttCareSize {
  plan_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  /** The size the plan was priced on. */
  roof_sqft: number;
  /** The day the plan was signed. */
  signed_on: string | null;
}

/**
 * A Roof Care plan in force with nothing recorded as paid toward it (owner, Nov 20: break test,
 * number 1: "a payment taken back must not leave a plan running unseen"). The database refuses
 * the ways a person could get there; this is the row that shows one all the same. A manager's
 * free year, which has nothing to pay, is not listed.
 */
export interface AttCareNoPayment {
  plan_id: string;
  site_id: string;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  /** The first day of the plan year; null when it is not known. */
  starts_on: string | null;
  /** What the plan year costs, less what a renewal took off. */
  price: number;
  /** The plan's invoice; null when it has none. */
  invoice: { id: string; number: string; status: string } | null;
}

/**
 * Is this plan in force with nothing paid toward it? Only a plan that is paid for the year
 * before it starts and has something to pay: no payment on its invoice, and no card payment.
 */
export function planRunsUnpaid(p: {
  status: string;
  pay_first: boolean;
  price: number;
  renewal_credit: number;
  invoice: { paid_amount: number } | null;
  card_paid?: unknown;
}): boolean {
  if (p.status !== "active" || !p.pay_first) return false;
  if (!(p.price - p.renewal_credit > 0.005)) return false;
  if (p.card_paid) return false;
  return !((p.invoice?.paid_amount ?? 0) > 0);
}

export interface AttCareUnbilled {
  visit_id: string;
  job_id: string;
  number: number;
  /** "Roof Guard · Plant 2 (Acme)". */
  title: string;
  /** "Inspection 1" / "Inspection 2". */
  label: string;
  /** What the visit bills. */
  amount: number;
  /** When the inspection was finished (ISO), to age the row; null when unknown. */
  since: string | null;
  /**
   * Not the inspection's share: the return trip charged after a visit with no access (Nov 19,
   * late), which is on no invoice.
   */
  trip?: boolean;
}

export interface AttentionIn {
  /** The viewer's day, YYYY-MM-DD. */
  today: string;
  /** When the rows were read (ISO). */
  now: string;
  limits: AttentionLimits;
  /** Live tickets: Open / Scheduled / Done, and every finished inspection. */
  tickets: readonly AttTicket[];
  /** crm_untouched(); null when the list could not be read (the rows are left out, and said so). */
  untouched: readonly AttUntouched[] | null;
  /** Live opportunities still open. */
  opps: readonly AttOpp[];
  /** Live draft and submitted bids. */
  bids: readonly AttBid[];
  /** Final invoices. */
  invoices: readonly AttInvoice[];
  /** Open follow-ups (holds; the review timer's authorizer). */
  followups: readonly AttFollowup[];
  /** Inspection ticket ids a live repair ticket was made from (service_jobs.from_job_id). */
  repairFrom: readonly string[];
  /** Inspection ticket ids a live bid was started from (bids.from_job_id). */
  bidFrom: readonly string[];
  /** Profile id → name. */
  names: Readonly<Record<string, string>>;
  /** Roof Care plan inspections not yet done, of plans in force (Nov 18). */
  careVisits?: readonly AttCareVisit[];
  /** Roof Care plan inspections whose ticket has no day (Nov 23). */
  careNoDay?: readonly AttCareNoDay[];
  /** Roof Care plan inspections done and on no invoice (Nov 19). */
  careUnbilled?: readonly AttCareUnbilled[];
  /** Roof Care plans signed and not yet paid (Nov 19). */
  careUnpaid?: readonly AttCareUnpaid[];
  /** Roof Care plans ended early whose refund is not yet sent (Nov 19). */
  careRefunds?: readonly AttCareRefund[];
  /** Roof Care plans in force with nothing paid toward them (Nov 20). */
  careNoPayment?: readonly AttCareNoPayment[];
  /** Roof Care plans priced on a size nobody checked against the map (Nov 20). */
  careSizes?: readonly AttCareSize[];
  /** A corrected roof size whose difference is not settled (Nov 26). */
  careSizeBalances?: readonly AttCareSizeBalance[];
  /** Card money still to send back to a customer (Nov 20). */
  careCardBack?: readonly AttCareCardBack[];
  /**
   * Requests from the two public pages that nobody has matched to a customer or dismissed
   * (Nov 21): a person asked for something and is waiting to hear back.
   */
  publicRequests?: readonly AttPublicRequest[];
  /** Roof Care plans in the last 60 days of their year, or past it (Nov 19). */
  careRenewals?: readonly AttCareRenewal[];
  /** Inspections carried into a renewed year, not yet done (Nov 19). */
  careCarried?: readonly AttCareCarried[];
  /** Roof Care plans that expired and were not renewed (Nov 19). */
  careExpired?: readonly AttCareExpired[];
}

export interface AttentionRow {
  key: string;
  group: AttentionGroup;
  kind: AttentionKind;
  /** The small label before the title: Inspection / Repair / Opportunity / Draft bid / Bid sent / Invoice. */
  tag: string;
  title: string;
  /** What is wrong, in a sentence or two. */
  why: string;
  /** Whose it is: a person, "Nobody", "Office" or, for a bid with no maker, "No estimator". */
  who: string;
  /** The filter's key: a profile id, "nobody", "office" or "no_estimator". */
  whoKey: string;
  /** Days it has waited (or is late); working days for a ticket its technician has not started. */
  age: number;
  /** "5 days" / "2 days late" / "2 working days late"; "Today" when the wait began today. */
  ageText: string;
  tone: "amber" | "red";
  /** Dollars riding on it (a bid's total, an invoice's balance); null when none. */
  amount: number | null;
  href: string;
}

export interface AttentionList {
  today: string;
  at: string;
  rows: AttentionRow[];
  /** Tickets and opportunities left out because a manager's hold is running. */
  held: number;
  /** False when crm_untouched() could not be read: the "not started by its person" rows are missing. */
  untouchedRead: boolean;
}

export const WHO_NOBODY = "nobody";
export const WHO_OFFICE = "office";
/**
 * A bid nobody is recorded as having made (owner, Nov 16, audit fix 19): its own key and the
 * words "No estimator", so it is not painted red as work with "Nobody" on it.
 */
export const WHO_NO_ESTIMATOR = "no_estimator";

const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
/** "5 days". A wait that began today reads "Today", never "0 days" (owner, Nov 16, audit fix 17). */
const days = (n: number) => (n === 0 ? "Today" : count(n, "day"));
/** "2 days late", or "2 working days late" for a count of working days; "Today" for none. */
const late = (n: number, unit = "day") => (n === 0 ? "Today" : `${count(n, unit)} late`);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  if (YMD.test(iso)) return iso;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? officeDay(new Date(t)) : null;
};
/** Whole days from a day (or an instant's office day) to `today`, never below 0; null when unknown. */
const since = (iso: string | null | undefined, today: string): number | null => {
  const d = dayOf(iso);
  return d === null ? null : Math.max(0, daysBetween(d, today));
};

/** Amber past the limit, red at twice the limit or more (never before 2 days). */
export const redFrom = (limit: number): number => Math.max(2, 2 * Math.max(0, limit));
export const toneOf = (age: number, limit: number): "amber" | "red" =>
  age >= redFrom(limit) ? "red" : "amber";

/** "Inspection" for an inspection, else the ticket's type ("Repair", "Warranty", "Other"). */
export const ticketTag = (t: Pick<AttTicket, "service_type" | "inspection">): string =>
  t.service_type === "inspection" || t.inspection
    ? "Inspection"
    : (TYPE_LABELS[(t.service_type ?? "") as ServiceType] ?? "Ticket");
export const ticketTitle = (t: Pick<AttTicket, "number" | "customer_name">): string =>
  `#${t.number}${t.customer_name?.trim() ? ` ${t.customer_name.trim()}` : ""}`;

/** How many checklist rows of a saved inspection are flagged as a problem. */
export function inspectionProblems(inspection: unknown): number {
  const saved = inspection as { items?: unknown } | null | undefined;
  const items = Array.isArray(saved?.items) ? saved.items : [];
  const rows = items.filter(
    (i): i is { label: string; status: "ok" | "issue" | "na" | null } =>
      !!i && typeof i === "object" && typeof (i as { label?: unknown }).label === "string",
  );
  return visibleChecklist(rows).filter((i) => isFlagged(i)).length;
}

const problemsText = (n: number) => `${n} problem${n === 1 ? "" : "s"} found`;
/**
 * The failing grade (inspection.ts INSPECTION_GRADES, A to F). An inspection graded F is
 * followed up even with no checklist row flagged (owner, Nov 16, audit fix 18).
 */
const FAILING_GRADE: InspectionGrade = "F";
/**
 * When a ticket's work was finished: the close-out stamp, else the stage stamp, else the last
 * update (owner, Nov 16, audit fixes 12 and 22: the stage stamp alone restarted the wait each
 * time the ticket changed stage).
 */
const finishedAt = (t: Pick<AttTicket, "completed_at" | "stage_changed_at" | "updated_at">) =>
  t.completed_at ?? t.stage_changed_at ?? t.updated_at;

/** The rows, in group order, the longest wait first inside each group. */
export function attentionList(i: AttentionIn): AttentionList {
  const { today, limits } = i;
  const rows: AttentionRow[] = [];
  const name = (id: string | null | undefined) => (id ? (i.names[id] ?? "").trim() : "");
  const person = (id: string | null | undefined, fallbackName?: string | null) => {
    const n = name(id) || (fallbackName ?? "").trim();
    return id && n ? { who: n, whoKey: id } : { who: "Nobody", whoKey: WHO_NOBODY };
  };
  const office = { who: "Office", whoKey: WHO_OFFICE };
  /** A bid's maker; a bid with none (or one no longer known) is "No estimator", not "Nobody". */
  const estimator = (id: string | null | undefined) => {
    const p = person(id);
    return p.whoKey === WHO_NOBODY ? { who: "No estimator", whoKey: WHO_NO_ESTIMATOR } : p;
  };
  const toYmd = (iso: string) => dayOf(iso) ?? iso;
  const heldOf = (kind: string) =>
    new Set(
      i.followups.filter((f) => f.kind === kind && isHeldOn(f, today, toYmd)).map((f) => f.item_id),
    );
  const heldTickets = heldOf("ticket");
  const heldOpps = heldOf("opportunity");
  const heldReviews = heldOf("invoice");
  let held = 0;
  const ticketById = new Map(i.tickets.map((t) => [t.id, t]));
  // A plan inspection's ticket with no day has a row of its own, from the day it is made (Nov
  // 23). One already past its last day is left to the rows that say so.
  const careNoDay = (i.careNoDay ?? []).filter(
    (v) => YMD.test(v.due_from) && YMD.test(v.due_by) && !(v.due_by < today),
  );
  const careNoDayJobs = new Set(careNoDay.map((v) => v.job_id));

  // ── Not started ────────────────────────────────────────────────────────────────────────────
  for (const t of i.tickets) {
    if (t.technician_id || (t.stage !== "open" && t.stage !== "scheduled")) continue;
    const tag = ticketTag(t);
    const base = {
      key: `ticket_nobody:${t.id}`,
      group: "not_started" as const,
      kind: "ticket_nobody" as const,
      tag,
      title: ticketTitle(t),
      who: "Nobody",
      whoKey: WHO_NOBODY,
      amount: null,
      href: `/service?id=${t.id}`,
    };
    if (t.scheduled_date && YMD.test(t.scheduled_date)) {
      if (!(t.scheduled_date < today)) continue;
      const age = daysBetween(t.scheduled_date, today);
      rows.push({
        ...base,
        why: `Nobody is on it. Its date was ${shortDay(t.scheduled_date)}.`,
        age,
        ageText: late(age),
        tone: toneOf(age, 1),
      });
      continue;
    }
    // Said once: the plan inspection's own row says it has no day and nobody on it.
    if (careNoDayJobs.has(t.id)) continue;
    const entered = dayOf(t.created_at);
    if (!entered || addDays(entered, limits.unassignedDays) > today) continue;
    const age = daysBetween(entered, today);
    rows.push({
      ...base,
      why: `Nobody is on it and it has no date. Entered ${shortDay(entered)}.`,
      age,
      ageText: days(age),
      tone: toneOf(age, limits.unassignedDays),
    });
  }

  for (const u of i.untouched ?? []) {
    if (u.kind === "ticket") {
      const t = ticketById.get(u.item_id);
      // Not among the live Open / Scheduled tickets this pass read: left out, never guessed.
      if (!t?.scheduled_date) continue;
      if (heldTickets.has(t.id)) {
        held += 1;
        continue;
      }
      // Owner, Nov 16 (audit fix 14): the limit counts working days (crm_untouched()), so the
      // days late and the color count them too. Counted in calendar days, a ticket was red on
      // the first day it showed.
      const age = workingDaysBetween(t.scheduled_date, today);
      rows.push({
        key: `ticket_untouched:${t.id}`,
        group: "not_started",
        kind: "ticket_untouched",
        tag: ticketTag(t),
        title: ticketTitle(t),
        why: `Not started. Its date was ${shortDay(t.scheduled_date)}.`,
        ...person(u.assignee_id ?? t.technician_id, u.assignee_name),
        age,
        ageText: late(age, "working day"),
        tone: toneOf(age, Math.max(1, u.limit_days ?? 1)),
        amount: null,
        href: `/service?id=${t.id}`,
      });
    } else if (u.kind === "opportunity") {
      const limit = Math.max(0, u.limit_days ?? 0);
      const at = u.assigned_at ? Date.parse(u.assigned_at) : NaN;
      // The reminder pass's own count (notify.server.ts daysSince): whole days since assignment.
      const age = Number.isFinite(at)
        ? Math.max(0, Math.floor((Date.parse(i.now) - at) / 86_400_000))
        : 0;
      if (age < limit) continue;
      if (heldOpps.has(u.item_id)) {
        held += 1;
        continue;
      }
      rows.push({
        key: `opp_untouched:${u.item_id}`,
        group: "not_started",
        kind: "opp_untouched",
        tag: "Opportunity",
        title: (u.title ?? "").trim() || "Opportunity",
        why: "No call, text or email logged since it was assigned.",
        ...person(u.assignee_id, u.assignee_name),
        age,
        ageText: days(age),
        tone: toneOf(age, limit),
        amount: null,
        href: `/opportunities?id=${u.item_id}`,
      });
    }
  }

  for (const o of i.opps) {
    if (o.assignee_id || !isOpenOppStatus(o.status)) continue;
    const entered = dayOf(o.created_at);
    if (!entered) continue;
    const pastClose = !!o.expected_close && o.expected_close < today;
    if (!pastClose && addDays(entered, limits.unassignedDays) > today) continue;
    const age = daysBetween(entered, today);
    rows.push({
      key: `opp_nobody:${o.id}`,
      group: "not_started",
      kind: "opp_nobody",
      tag: "Opportunity",
      title: (o.title ?? "").trim() || "Opportunity",
      why: `Nobody is on it. Entered ${shortDay(entered)}.`,
      who: "Nobody",
      whoKey: WHO_NOBODY,
      age,
      ageText: days(age),
      tone: toneOf(age, limits.unassignedDays),
      amount: null,
      href: `/opportunities?id=${o.id}`,
    });
  }

  for (const b of i.bids) {
    const age = bidOverdueDays(b, today);
    if (age === null) continue;
    rows.push({
      key: `bid_draft_late:${b.id}`,
      group: "not_started",
      kind: "bid_draft_late",
      tag: "Draft bid",
      title: (b.name ?? "").trim() || "Untitled bid",
      why: `Still a draft. It was due ${shortDay(b.due_date!)}.`,
      ...estimator(b.created_by),
      age,
      ageText: late(age),
      tone: toneOf(age, 1),
      amount: num(b.grand_total) || null,
      href: bidHref(b),
    });
  }

  // ── Not followed up ────────────────────────────────────────────────────────────────────────
  for (const b of i.bids) {
    if (asBidStatus(b.status) !== "submitted") continue;
    // Owner, Nov 16 (audit fix 15): a bid sent a second time is aged from the latest time it
    // became submitted. submitted_at keeps the first time (the database keeps the first stamp);
    // on a submitted bid status_changed_at is the latest, so the later of the two days is it.
    const stamps = [dayOf(b.submitted_at), dayOf(b.status_changed_at)]
      .filter((d): d is string => d !== null)
      .sort();
    const sent = stamps[stamps.length - 1] ?? dayOf(b.updated_at);
    if (!sent) continue;
    const age = Math.max(0, daysBetween(sent, today));
    // Owner, Nov 16 (audit fix 16): a follow-up date from before the day the bid was sent (set
    // while it was a draft) is no follow-up on the sent bid: it reads as having none.
    const followUp =
      b.reminder_on && YMD.test(b.reminder_on) && b.reminder_on >= sent ? b.reminder_on : null;
    let why: string;
    let tone: "amber" | "red";
    if (followUp) {
      // A follow-up day today or ahead: someone has it in hand.
      if (followUp >= today) continue;
      why = `Its follow-up date was ${shortDay(followUp)}. No new date is set.`;
      // Owner, Nov 16 (audit fix 20): amber from the first day past it, red at twice the limit,
      // as the other rows are. It used to turn red at one times the limit.
      tone = toneOf(daysBetween(followUp, today), limits.bidDays);
    } else {
      if (age < limits.bidDays) continue;
      why = `No follow-up date. Sent ${shortDay(sent)}.`;
      tone = toneOf(age, limits.bidDays);
    }
    rows.push({
      key: `bid_sent:${b.id}`,
      group: "not_followed_up",
      kind: "bid_sent",
      tag: "Bid sent",
      title: (b.name ?? "").trim() || "Untitled bid",
      why,
      ...estimator(b.created_by),
      age,
      ageText: days(age),
      tone,
      amount: num(b.grand_total) || null,
      href: bidHref(b),
    });
  }

  const hasNext = new Set([...i.repairFrom, ...i.bidFrom]);
  for (const t of i.tickets) {
    // A live repair ticket or bid came of it: the next step exists.
    if (!t.inspection || !isFinishedStage(t.stage) || hasNext.has(t.id)) continue;
    // Owner, Nov 16 (audit fix 17): while the ticket is still Done its one row is the one that
    // waits to be authorized (below); this row starts once it is Authorized or later.
    if (t.stage === "done") continue;
    const problems = inspectionProblems(t.inspection);
    const rawGrade = (t.inspection as { grade?: unknown }).grade;
    const grade = typeof rawGrade === "string" ? rawGrade.trim() : "";
    // Nothing flagged: nothing to follow up, unless it was graded F (audit fix 18).
    if (problems === 0 && grade !== FAILING_GRADE) continue;
    const outcome = t.inspection_outcome ?? null;
    // Owner, Nov 16 (audit fix 13): a repair ticket or a bid was chosen, but none from this
    // inspection is live any more (it was deleted, and deleting does not undo the choice).
    const gone =
      outcome === "repair_ticket"
        ? "Its repair ticket was deleted. "
        : outcome === "bid"
          ? "Its bid was deleted. "
          : "";
    // "No action needed" was chosen (owner, Nov 16: "make it leave after no action needed is
    // pressed"): the choice is made, so the row leaves at once. Until then it stayed 30 days as
    // "Closed with no repair ticket or bid". A choice this list does not know is left out too,
    // never guessed.
    if (outcome !== null && !gone) continue;
    const found = !problems
      ? `Graded ${grade}.`
      : grade
        ? `Graded ${grade} with ${problemsText(problems)}.`
        : `${problemsText(problems)[0]!.toUpperCase()}${problemsText(problems).slice(1)}.`;
    // From the day the inspection was finished (audit fix 12): authorizing the ticket used to
    // restart the wait at 1 day.
    const age = since(finishedAt(t), today) ?? 0;
    const why = `${found} ${gone}Nobody has chosen what happens next.`;
    const owner = office;
    rows.push({
      key: `inspection_no_next:${t.id}`,
      group: "not_followed_up",
      kind: "inspection_no_next",
      tag: "Inspection",
      title: ticketTitle(t),
      why,
      ...owner,
      age,
      ageText: days(age),
      tone: toneOf(age, 7),
      amount: null,
      href: `/service?id=${t.id}`,
    });
  }

  // ── Waiting on the office ──────────────────────────────────────────────────────────────────
  const authorizer = new Map(
    i.followups
      .filter((f) => f.kind === "invoice" && f.status === "open" && f.assignee_id)
      .map((f) => [f.item_id, f.assignee_id!]),
  );
  for (const t of i.tickets) {
    if (t.stage !== "done") continue;
    const age = since(finishedAt(t), today);
    if (age === null || age < limits.authorizeDays) continue;
    if (heldReviews.has(t.id)) {
      held += 1;
      continue;
    }
    const by = person(authorizer.get(t.id));
    rows.push({
      key: `to_authorize:${t.id}`,
      group: "office",
      kind: "to_authorize",
      tag: ticketTag(t),
      title: ticketTitle(t),
      why: "Done. Waiting to be authorized.",
      ...(by.whoKey === WHO_NOBODY ? office : by),
      age,
      ageText: days(age),
      tone: toneOf(age, limits.authorizeDays),
      amount: null,
      href: `/service?id=${t.id}`,
    });
  }

  for (const v of i.invoices) {
    if (v.status !== "final") continue;
    const due = v.due_date && YMD.test(v.due_date) ? v.due_date : null;
    const invoiced = (v.invoice_date ?? "").slice(0, 10);
    // Owner, Nov 16 (audit fix 11): an invoice with no due date was never listed. The Invoices
    // page's own rule decides when it is late (invoice-list.ts invoiceDue: owed on receipt,
    // late ON_RECEIPT_LATE_DAYS after its invoice date), and it is aged from that day.
    if (!due && !YMD.test(invoiced)) continue;
    const age = invoiceDue(
      { status: v.status, invoice_date: invoiced, due_date: due },
      today,
    ).lateDays;
    if (age <= 0) continue;
    const balance = Math.round((num(v.total) - num(v.paid_amount)) * 100) / 100;
    if (balance <= 0) continue;
    const billName = (v.bill_to as { name?: unknown } | null | undefined)?.name;
    const billTo = typeof billName === "string" ? billName.trim() : "";
    const no = (v.display_number ?? "").trim() || (v.number !== null ? String(v.number) : "");
    rows.push({
      key: `invoice_unpaid:${v.id}`,
      group: "office",
      kind: "invoice_unpaid",
      tag: "Invoice",
      title: [no ? `#${no}` : "", billTo].filter(Boolean).join(" ") || "Invoice",
      why: due
        ? `Unpaid. It was due ${shortDay(due)}.`
        : `Unpaid. No due date. Invoiced ${shortDay(invoiced)}, over ${ON_RECEIPT_LATE_DAYS} days ago.`,
      ...office,
      age,
      ageText: late(age),
      tone: toneOf(age, 15),
      amount: balance,
      href: `/service/invoices?id=${v.id}`,
    });
  }

  // A Roof Care plan inspection past its last day, or pushed past the plan year (Nov 18).
  for (const v of i.careVisits ?? []) {
    const lateBy = YMD.test(v.due_by) ? Math.max(0, daysBetween(v.due_by, today)) : 0;
    if (lateBy <= 0 && !v.pastPlanYear) continue;
    const dueWords = `${v.label} was due by ${shortDay(v.due_by)} and is not done.`;
    rows.push({
      key: `care_plan_late:${v.visit_id}`,
      group: "office",
      kind: "care_plan_late",
      tag: "Roof Care",
      title: v.title,
      why:
        lateBy > 0
          ? v.pastPlanYear
            ? `${dueWords} It was pushed past the plan year, so the renewal moved.`
            : dueWords
          : `${v.label} was pushed past the plan year, so the renewal moved. It is due by ${shortDay(v.due_by)}.`,
      ...office,
      age: lateBy,
      ageText: lateBy > 0 ? late(lateBy) : "Running late",
      tone: lateBy > 14 ? "red" : "amber",
      amount: v.amount > 0 ? v.amount : null,
      href: `/properties/${v.site_id}`,
    });
  }

  // A Roof Care plan inspection whose ticket has no day (Nov 23). Amber while its window has not
  // opened, red once it has: the inspection can be done now and nobody has been sent.
  for (const v of careNoDay) {
    const t = ticketById.get(v.job_id);
    const made = t?.created_at ? dayOf(t.created_at) : null;
    const age = made ? Math.max(0, daysBetween(made, today)) : 0;
    const opened = !(v.due_from > today);
    const when =
      v.due_from === v.due_by
        ? `on ${shortDay(v.due_by)}`
        : opened
          ? `by ${shortDay(v.due_by)}`
          : `between ${shortDay(v.due_from)} and ${shortDay(v.due_by)}`;
    rows.push({
      key: `care_plan_no_day:${v.visit_id}`,
      group: "office",
      kind: "care_plan_no_day",
      tag: "Roof Care",
      title: v.title,
      why: `${v.label} is due ${when}. Ticket #${v.number} has no day${t && !t.technician_id ? " and nobody on it" : ""}. Open the ticket and set its day.`,
      ...office,
      age,
      ageText: days(age),
      tone: opened ? "red" : "amber",
      amount: null,
      href: `/service?id=${v.job_id}`,
    });
  }

  // A Roof Care plan inspection done and signed off, with its half of the plan on no invoice
  // (Nov 19): the draft made at Authorized is gone. Shown from the first day.
  for (const v of i.careUnbilled ?? []) {
    const age = since(v.since, today) ?? 0;
    rows.push({
      key: `care_plan_unbilled:${v.visit_id}`,
      group: "office",
      kind: "care_plan_unbilled",
      tag: "Roof Care",
      title: v.title,
      why: v.trip
        ? `A return trip was charged after a visit with no access, and it is on no invoice. Open ticket #${v.number}: press ${CARE_PLAN_BILL_LABEL}, or use Rebuild from ticket on its draft invoice.`
        : `${v.label} is done and has no invoice. Open ticket #${v.number} and press ${CARE_PLAN_BILL_LABEL}.`,
      ...office,
      age,
      ageText: days(age),
      tone: age > 14 ? "red" : "amber",
      amount: v.amount > 0 ? v.amount : null,
      href: `/service?id=${v.job_id}`,
    });
  }

  // A Roof Care plan signed and waiting for its payment (Nov 19). It says what the office does
  // next: make the invoice, send the draft, or mark the payment.
  for (const v of i.careUnpaid ?? []) {
    const age = YMD.test(v.signed_on) ? Math.max(0, daysBetween(v.signed_on, today)) : 0;
    const signed = v.renewal
      ? `The renewal was made ${shortDay(v.signed_on)} and is not paid, so the new plan year has not started.`
      : `Signed ${shortDay(v.signed_on)} and not paid, so the plan has not started.`;
    const next = !v.invoice
      ? "No invoice has been made. Open the property and press Make the invoice."
      : v.invoice.status === "draft"
        ? `Invoice #${v.invoice.number} is a draft. Finalise it and send it.`
        : v.invoice.paid_amount > 0
          ? `Invoice #${v.invoice.number} is part paid. The plan starts when it is paid in full.`
          : `Invoice #${v.invoice.number} is waiting to be paid. Mark it paid when the payment arrives.`;
    rows.push({
      key: `care_plan_unpaid:${v.plan_id}`,
      group: "office",
      kind: "care_plan_unpaid",
      tag: "Roof Care",
      title: v.title,
      why: [signed, v.pay, next].filter(Boolean).join(" "),
      ...office,
      age,
      ageText: days(age),
      tone: age > 14 ? "red" : "amber",
      amount: v.price > 0 ? v.price : null,
      href: v.invoice ? `/service/invoices?id=${v.invoice.id}` : `/properties/${v.site_id}`,
    });
  }

  // A Roof Care plan in force with nothing paid toward it (Nov 20): the inspections are being
  // done for a plan nobody has paid for. Red from the first day.
  for (const v of i.careNoPayment ?? []) {
    const age =
      v.starts_on && YMD.test(v.starts_on) ? Math.max(0, daysBetween(v.starts_on, today)) : 0;
    const next = !v.invoice
      ? "It has no invoice. Open the property: make the invoice and record the payment, or end the plan."
      : `Find the payment and mark invoice #${v.invoice.number} paid, or end the plan on the property.`;
    rows.push({
      key: `care_plan_no_payment:${v.plan_id}`,
      group: "office",
      kind: "care_plan_no_payment",
      tag: "Roof Care",
      title: v.title,
      why: `The plan is in force and nothing is recorded as paid toward it. Its inspections are still being done. ${next}`,
      ...office,
      age,
      ageText: days(age),
      tone: "red",
      amount: v.price > 0 ? v.price : null,
      href: v.invoice ? `/service/invoices?id=${v.invoice.id}` : `/properties/${v.site_id}`,
    });
  }

  // A Roof Care plan priced on a roof size typed by hand, with no map size to check it against
  // (Nov 20). The price follows the size, so a manager or an admin looks at it once.
  for (const v of i.careSizes ?? []) {
    const age =
      v.signed_on && YMD.test(v.signed_on) ? Math.max(0, daysBetween(v.signed_on, today)) : 0;
    rows.push({
      key: `care_plan_size:${v.plan_id}`,
      group: "office",
      kind: "care_plan_size",
      tag: "Roof Care",
      title: v.title,
      why: `${SIZE_UNCHECKED_WORDS}: ${Math.round(v.roof_sqft).toLocaleString("en-US")} sq ft. The plan's price follows the size. A manager or an admin opens the property, checks the size and presses ${SIZE_CONFIRM_LABEL}.`,
      ...office,
      age,
      ageText: days(age),
      tone: age > 14 ? "red" : "amber",
      amount: null,
      href: `/properties/${v.site_id}`,
    });
  }

  // A refund owed on a Roof Care plan that was ended early (Nov 19), until it is marked sent.
  for (const v of i.careRefunds ?? []) {
    if (!(v.amount > 0)) continue;
    const age =
      v.ended_on && YMD.test(v.ended_on) ? Math.max(0, daysBetween(v.ended_on, today)) : 0;
    rows.push({
      key: `care_plan_refund:${v.plan_id}`,
      group: "office",
      kind: "care_plan_refund",
      tag: "Roof Care",
      title: v.title,
      why: `The plan was ended${v.ended_on ? ` ${shortDay(v.ended_on)}` : ""} and a refund is owed. Send it, then mark it sent on the property.`,
      ...office,
      age,
      ageText: days(age),
      tone: age > 14 ? "red" : "amber",
      amount: v.amount,
      href: `/properties/${v.site_id}`,
    });
  }

  // A corrected roof size not settled (Nov 26). Money owed back for a smaller roof, until it is
  // recorded as sent; and a bigger roof's difference still owed once the plan year is over,
  // until its invoice is paid.
  for (const v of i.careSizeBalances ?? []) {
    const age = v.since && YMD.test(v.since) ? Math.max(0, daysBetween(v.since, today)) : 0;
    if (v.owed < 0) {
      rows.push({
        key: `care_plan_size_refund:${v.plan_id}`,
        group: "office",
        kind: "care_plan_size_refund",
        tag: "Roof Care",
        title: v.title,
        why: `The roof was found smaller after the plan was paid, and the difference is owed back to the customer. Send it, then open the property and press ${SIZE_REFUND_RECORD}.`,
        ...office,
        age,
        ageText: days(age),
        tone: age > 14 ? "red" : "amber",
        amount: -v.owed,
        href: `/properties/${v.site_id}`,
      });
      continue;
    }
    if (!(v.owed > 0) || !v.ended) continue;
    const next = !v.invoice
      ? `No invoice is made for it: open the property and press ${SIZE_INVOICE_MAKE}.`
      : v.invoice.status === "draft"
        ? `Invoice #${v.invoice.number} for it is a draft: finalise it and send it.`
        : `Invoice #${v.invoice.number} for it is sent and not paid yet.`;
    rows.push({
      key: `care_plan_size_owed:${v.plan_id}`,
      group: "office",
      kind: "care_plan_size_owed",
      tag: "Roof Care",
      title: v.title,
      why: `The plan year is over, and the difference for the bigger roof is still owed. ${next}`,
      ...office,
      age,
      ageText: days(age),
      tone: age > 14 ? "red" : "amber",
      amount: v.owed,
      href: v.invoice ? `/service/invoices?id=${v.invoice.id}` : `/properties/${v.site_id}`,
    });
  }

  // Card money that has to go back to a customer (Nov 20), until it is marked sent back. It is
  // somebody else's money: red from the first day.
  for (const v of i.careCardBack ?? []) {
    if (!(v.amount > 0)) continue;
    const age = v.paid_on && YMD.test(v.paid_on) ? Math.max(0, daysBetween(v.paid_on, today)) : 0;
    rows.push({
      key: `care_plan_card_back:${v.payment_id}`,
      group: "office",
      kind: "care_plan_card_back",
      tag: "Roof Care",
      title: v.title,
      why: `A card payment has to go back to the customer. ${v.why} Reference ${v.ref}. Send it back, then a manager or an admin marks it sent back on the property.`,
      ...office,
      age,
      ageText: days(age),
      tone: "red",
      amount: v.amount,
      href: `/properties/${v.site_id}`,
    });
  }

  // A request from a public page (Nov 21) that nobody has said whose it is. A person is waiting
  // to hear back: amber from the first day, red after two. Since Nov 23 it is an opportunity
  // from the start, and the row opens that opportunity.
  for (const v of i.publicRequests ?? []) {
    const age = v.sent_on && YMD.test(v.sent_on) ? Math.max(0, daysBetween(v.sent_on, today)) : 0;
    rows.push({
      key: `public_request:${v.id}`,
      group: "office",
      kind: "public_request",
      tag:
        v.kind !== "care"
          ? "Service request"
          : v.ask.startsWith("a custom quote")
            ? "Custom quote request"
            : "Roof Care request",
      title: v.from,
      why: `Sent from the public ${v.kind === "care" ? "Roof Care plans" : "Request service"} page, asking for ${v.ask}. Nobody has answered it. Open its opportunity, say whose it is, and call them. Reference ${v.reference}.`,
      ...office,
      age,
      ageText: days(age),
      tone: age > 2 ? "red" : "amber",
      amount: null,
      href: requestOpportunityPath(v.opportunity_id),
    });
  }

  // A Roof Care plan in the last 60 days of its year, or past it (Nov 19): the inspection still
  // owed, and the renewal not yet made.
  for (const v of i.careRenewals ?? []) {
    if (!YMD.test(v.renews_on)) continue;
    const left = daysBetween(today, v.renews_on);
    if (left > RENEWAL_OPEN_DAYS) continue;
    if (v.renewed && v.owed <= 0) continue;
    const when =
      left > 0
        ? `Renews ${shortDay(v.renews_on)}, in ${count(left, "day")}.`
        : left === 0
          ? `Renews today, ${shortDay(v.renews_on)}.`
          : `Was due to renew ${shortDay(v.renews_on)}.`;
    const owed =
      v.owed <= 0
        ? ""
        : `${v.owed === 1 ? "1 inspection is" : "Both inspections are"} still owed${v.renewed ? ", and the renewal was charged in full" : ""}. Get ${v.owed === 1 ? "it" : "them"} done.`;
    const next = v.renewed
      ? ""
      : `No renewal has been made. Open the property and press ${RENEW_LABEL}.`;
    rows.push({
      key: `care_plan_renewal:${v.plan_id}`,
      group: "office",
      kind: "care_plan_renewal",
      tag: "Roof Care",
      title: v.title,
      why: [when, owed, next].filter(Boolean).join(" "),
      ...office,
      age: Math.max(0, RENEWAL_OPEN_DAYS - left),
      ageText: left > 0 ? `${count(left, "day")} left` : left === 0 ? "Today" : late(-left),
      tone: left <= 14 ? "red" : "amber",
      amount: !v.renewed && v.price > 0 ? v.price : null,
      href: `/properties/${v.site_id}`,
    });
  }

  // An inspection carried into the renewed year (Nov 19): 60 days, then it is lost.
  for (const v of i.careCarried ?? []) {
    if (!YMD.test(v.due_by)) continue;
    const left = daysBetween(today, v.due_by);
    rows.push({
      key: `care_plan_carried:${v.visit_id}`,
      group: "office",
      kind: "care_plan_carried",
      tag: "Roof Care",
      title: v.title,
      why:
        left >= 0
          ? `An inspection owed from last plan year is not done. It is lost after ${shortDay(v.due_by)}.`
          : `An inspection owed from last plan year was not done by ${shortDay(v.due_by)}. It is lost at the next morning run.`,
      ...office,
      age: Math.max(0, CARRY_DAYS - left),
      ageText: left > 0 ? `${count(left, "day")} left` : left === 0 ? "Last day" : late(-left),
      tone: left <= 14 ? "red" : "amber",
      amount: null,
      href: `/properties/${v.site_id}`,
    });
  }

  // A Roof Care plan that expired and was not renewed (Nov 19): reach out to renew.
  for (const v of i.careExpired ?? []) {
    if (!YMD.test(v.expired_on)) continue;
    const age = Math.max(0, daysBetween(v.expired_on, today));
    if (age > EXPIRED_LISTED_DAYS) continue;
    const owed =
      v.owed <= 0
        ? ""
        : ` ${v.owed === 1 ? "1 inspection was" : "Both inspections were"} not done and ${v.owed === 1 ? "is" : "are"} still owed.`;
    rows.push({
      key: `care_plan_expired:${v.plan_id}`,
      group: "office",
      kind: "care_plan_expired",
      tag: "Roof Care",
      title: v.title,
      why: `The plan year ended ${shortDay(v.expired_on)} and the plan was not renewed. What it included has stopped. Reach out to renew it: open the property and press ${RENEW_LABEL}.${owed}`,
      ...office,
      age,
      ageText: days(age),
      tone: age > 14 ? "red" : "amber",
      amount: v.price > 0 ? v.price : null,
      href: `/properties/${v.site_id}`,
    });
  }

  const order = new Map(ATTENTION_GROUPS.map((g, n) => [g.key, n]));
  rows.sort(
    (a, b) =>
      order.get(a.group)! - order.get(b.group)! ||
      b.age - a.age ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key),
  );
  return { today, at: i.now, rows, held, untouchedRead: i.untouched !== null };
}

/** The rows of one group. */
export const groupRows = (rows: readonly AttentionRow[], g: AttentionGroup): AttentionRow[] =>
  rows.filter((r) => r.group === g);

/**
 * Folding a group shut (owner, Nov 15: "make the … headers collapsable … and a bit more
 * noticable"). A press on a group's header folds or opens it; this browser remembers which are
 * shut (localStorage, `ATTENTION_FOLD_KEY`) so the page opens the way it was left. Nothing about
 * the list itself changes: the count badge, the summary line and the header's own count still
 * count a folded group's rows.
 */
export const ATTENTION_FOLD_KEY = "owner-attention-folded";
const GROUP_KEYS = ATTENTION_GROUPS.map((g) => g.key);
/** The remembered value as a list of groups; anything unreadable is "nothing folded". */
export function parseFolded(raw: string | null | undefined): AttentionGroup[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return GROUP_KEYS.filter((k) => v.includes(k));
  } catch {
    return [];
  }
}
/** Fold a group that is open, open one that is folded; always in the groups' own order. */
export const toggleFolded = (
  folded: readonly AttentionGroup[],
  g: AttentionGroup,
): AttentionGroup[] =>
  GROUP_KEYS.filter((k) => (k === g ? !folded.includes(k) : folded.includes(k)));
/**
 * What a group's header says beside its count: the longest wait in it and how many are red —
 * "longest 33 days · 4 red" — so a folded group still tells the owner how bad it is. When every
 * wait in it began today it reads "all today" (Nov 16, audit fix 17: no "0 days").
 */
export function groupNote(rows: readonly AttentionRow[]): string {
  if (!rows.length) return "";
  const longest = rows.reduce((a, b) => (b.age > a.age ? b : a));
  const red = rows.filter((r) => r.tone === "red").length;
  const head = longest.age === 0 ? "all today" : `longest ${longest.ageText}`;
  return `${head}${red ? ` · ${red} red` : ""}`;
}

/** Dollars in submitted bids nobody has a follow-up date on. */
export const bidsWaiting = (rows: readonly AttentionRow[]): number =>
  rows.filter((r) => r.kind === "bid_sent").reduce((s, r) => s + (r.amount ?? 0), 0);

const WHOLE_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
export const attentionMoney = (n: number): string => WHOLE_USD.format(n);

/**
 * The line under the heading: "3 not started · 7 not followed up · 3 waiting on the office ·
 * $811,716 in bids with no follow-up". A group with nothing is left out; nothing at all reads
 * "Nothing needs attention."
 */
export function attentionSummary(rows: readonly AttentionRow[]): string {
  if (!rows.length) return "Nothing needs attention.";
  const parts: string[] = [];
  const n = (g: AttentionGroup) => groupRows(rows, g).length;
  if (n("not_started")) parts.push(`${n("not_started")} not started`);
  if (n("not_followed_up")) parts.push(`${n("not_followed_up")} not followed up`);
  if (n("office")) parts.push(`${n("office")} waiting on the office`);
  const money = bidsWaiting(rows);
  if (money > 0) parts.push(`${attentionMoney(money)} in bids with no follow-up`);
  return parts.join(" · ");
}

export interface AttentionPerson {
  key: string;
  label: string;
  count: number;
}
/**
 * The filter's choices, from the rows: each person by first name (the full name when two share
 * one), the busiest first, then Office, then No estimator (bids with no maker; Nov 16, audit fix
 * 19), then Nobody.
 */
export function attentionPeople(rows: readonly AttentionRow[]): AttentionPerson[] {
  const by = new Map<string, { who: string; count: number }>();
  for (const r of rows) {
    const p = by.get(r.whoKey);
    if (p) p.count += 1;
    else by.set(r.whoKey, { who: r.who, count: 1 });
  }
  const first = (s: string) => s.split(/\s+/)[0] ?? s;
  const fixed = [
    [WHO_OFFICE, "Office"],
    [WHO_NO_ESTIMATOR, "No estimator"],
    [WHO_NOBODY, "Nobody"],
  ] as const;
  const people = [...by].filter(([k]) => !fixed.some(([f]) => f === k));
  const firsts = new Map<string, number>();
  for (const [, p] of people) firsts.set(first(p.who), (firsts.get(first(p.who)) ?? 0) + 1);
  const out: AttentionPerson[] = people
    .map(([key, p]) => ({
      key,
      label: (firsts.get(first(p.who)) ?? 0) > 1 ? p.who : first(p.who),
      count: p.count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  for (const [key, label] of fixed) {
    const p = by.get(key);
    if (p) out.push({ key, label, count: p.count });
  }
  return out;
}

/** The rows of one person (`who` = a filter key), or all of them (null). */
export const rowsFor = (rows: readonly AttentionRow[], who: string | null): AttentionRow[] =>
  who === null ? [...rows] : rows.filter((r) => r.whoKey === who);
