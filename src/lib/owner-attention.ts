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
import { TYPE_LABELS, type ServiceType } from "@/lib/service.functions";
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
  | "care_plan_late";

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
