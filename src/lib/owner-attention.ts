/**
 * The Owner page's "Needs attention" list (owner, Nov 15: "one issue we run into on the roofing
 * business is things not getting started or followed up on" … "i more so meant like keep the
 * owner on top of things"). One list at the top of the Owner page, found by rules: nobody adds
 * a row and nobody on the staff can dismiss one. A row leaves when the work is done.
 *
 * The owner approved three groups and these rows ("Those are right"), with tickets waiting on
 * an invoice left out ("Yes noise") and no morning brief ("No morning brief please"):
 *
 *   Not started
 *     - a ticket past its date with nobody on it (no date at all: entered longer ago than
 *       Setup's "needs assignment" limit);
 *     - a ticket past its date that its technician has not started (crm_untouched(), the
 *       "Untouched work" limit, in working days);
 *     - an opportunity with no contact logged N days after it was assigned (the same list's
 *       opportunity half and its limit), and an open one nobody is on at all, past the "needs
 *       assignment" limit;
 *     - a draft bid past its due date (work-counts.ts isOverdueBid).
 *   Not followed up
 *     - a submitted bid with no follow-up date `bidDays` days after it was sent, or whose
 *       follow-up date ("Remind me on", bids.reminder_on) has passed;
 *     - an inspection that found problems and has no repair ticket or bid after it: nobody has
 *       chosen what happens next, or "No action needed" was chosen in the last 30 days.
 *   Waiting on the office
 *     - a Done ticket not authorized after `authorizeDays` days;
 *     - an invoice unpaid past its due date.
 *
 * A manager's hold takes a ticket or an opportunity off the list until the hold ends, as it does
 * everywhere else (work-counts.ts heldTicketIds / heldOppIds); the list says how many are held.
 *
 * Amber is past the limit; red is twice the limit or more (`redFrom`).
 *
 * Pure: plain rows and the viewer's day in, rows and words out. The server function is
 * owner-attention.functions.ts; components/owner-attention.tsx draws it.
 */
import { asBidStatus } from "@/lib/bid-status";
import { daysBetween, shortDay } from "@/lib/followup-rules";
import { isFlagged, visibleChecklist } from "@/lib/inspection";
import { addDays, isHeldOn } from "@/lib/my-work";
import { TYPE_LABELS, type ServiceType } from "@/lib/service.functions";
import { isFinishedStage } from "@/lib/ticket-stages";
import { bidOverdueDays, isOpenOppStatus } from "@/lib/work-counts";
import { officeDay } from "@/lib/working-days";

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
  | "invoice_unpaid";

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
/** "No action needed" on an inspection with problems stays on the list this long. */
export const INSPECTION_WINDOW_DAYS = 30;

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
  /** Whose it is: a person, "Nobody" or "Office". */
  who: string;
  /** The filter's key: a profile id, "nobody" or "office". */
  whoKey: string;
  /** Days it has waited (or is late). */
  age: number;
  /** "5 days" / "2 days late". */
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

const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const late = (n: number) => `${days(n)} late`;
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
      const age = Math.max(0, daysBetween(t.scheduled_date, today));
      rows.push({
        key: `ticket_untouched:${t.id}`,
        group: "not_started",
        kind: "ticket_untouched",
        tag: ticketTag(t),
        title: ticketTitle(t),
        why: `Not started. Its date was ${shortDay(t.scheduled_date)}.`,
        ...person(u.assignee_id ?? t.technician_id, u.assignee_name),
        age,
        ageText: late(age),
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
      ...person(b.created_by),
      age,
      ageText: late(age),
      tone: toneOf(age, 1),
      amount: num(b.grand_total) || null,
      href: `/estimate?bid=${b.id}`,
    });
  }

  // ── Not followed up ────────────────────────────────────────────────────────────────────────
  for (const b of i.bids) {
    if (asBidStatus(b.status) !== "submitted") continue;
    const sent = dayOf(b.submitted_at ?? b.status_changed_at ?? b.updated_at);
    if (!sent) continue;
    const age = Math.max(0, daysBetween(sent, today));
    const followUp = b.reminder_on && YMD.test(b.reminder_on) ? b.reminder_on : null;
    let why: string;
    let tone: "amber" | "red";
    if (followUp) {
      // A follow-up day today or ahead: someone has it in hand.
      if (followUp >= today) continue;
      why = `Its follow-up date was ${shortDay(followUp)}. No new date is set.`;
      tone = daysBetween(followUp, today) >= Math.max(1, limits.bidDays) ? "red" : "amber";
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
      ...person(b.created_by),
      age,
      ageText: days(age),
      tone,
      amount: num(b.grand_total) || null,
      href: `/estimate?bid=${b.id}`,
    });
  }

  const hasNext = new Set([...i.repairFrom, ...i.bidFrom]);
  for (const t of i.tickets) {
    if (!t.inspection || !isFinishedStage(t.stage) || hasNext.has(t.id)) continue;
    const problems = inspectionProblems(t.inspection);
    if (problems === 0) continue;
    const outcome = t.inspection_outcome ?? null;
    // A repair ticket or a bid was chosen: the next step exists (or its own row covers it).
    if (outcome && outcome !== "none") continue;
    const rawGrade = (t.inspection as { grade?: unknown }).grade;
    const grade = typeof rawGrade === "string" ? rawGrade.trim() : "";
    const found = grade
      ? `Graded ${grade} with ${problemsText(problems)}.`
      : `${problemsText(problems)[0]!.toUpperCase()}${problemsText(problems).slice(1)}.`;
    let age: number;
    let why: string;
    let owner: { who: string; whoKey: string };
    if (outcome === "none") {
      const chosen = since(t.inspection_outcome_at ?? t.stage_changed_at, today);
      if (chosen === null || chosen > INSPECTION_WINDOW_DAYS) continue;
      age = chosen;
      why = `${found} Closed with no repair ticket or bid.`;
      const by = person(t.inspection_outcome_by);
      owner = by.whoKey === WHO_NOBODY ? office : by;
    } else {
      age = since(t.stage_changed_at ?? t.updated_at, today) ?? 0;
      why = `${found} Nobody has chosen what happens next.`;
      owner = office;
    }
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
    const age = since(t.stage_changed_at ?? t.updated_at, today);
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
    if (v.status !== "final" || !v.due_date || !YMD.test(v.due_date) || !(v.due_date < today))
      continue;
    const balance = Math.round((num(v.total) - num(v.paid_amount)) * 100) / 100;
    if (balance <= 0) continue;
    const age = daysBetween(v.due_date, today);
    const billName = (v.bill_to as { name?: unknown } | null | undefined)?.name;
    const billTo = typeof billName === "string" ? billName.trim() : "";
    const no = (v.display_number ?? "").trim() || (v.number !== null ? String(v.number) : "");
    rows.push({
      key: `invoice_unpaid:${v.id}`,
      group: "office",
      kind: "invoice_unpaid",
      tag: "Invoice",
      title: [no ? `#${no}` : "", billTo].filter(Boolean).join(" ") || "Invoice",
      why: `Unpaid. It was due ${shortDay(v.due_date)}.`,
      ...office,
      age,
      ageText: late(age),
      tone: toneOf(age, 15),
      amount: balance,
      href: `/service/invoices?id=${v.id}`,
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
 * "longest 33 days · 4 red" — so a folded group still tells the owner how bad it is.
 */
export function groupNote(rows: readonly AttentionRow[]): string {
  if (!rows.length) return "";
  const longest = rows.reduce((a, b) => (b.age > a.age ? b : a));
  const red = rows.filter((r) => r.tone === "red").length;
  return `longest ${longest.ageText}${red ? ` · ${red} red` : ""}`;
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
 * one), the busiest first, then Office, then Nobody.
 */
export function attentionPeople(rows: readonly AttentionRow[]): AttentionPerson[] {
  const by = new Map<string, { who: string; count: number }>();
  for (const r of rows) {
    const p = by.get(r.whoKey);
    if (p) p.count += 1;
    else by.set(r.whoKey, { who: r.who, count: 1 });
  }
  const first = (s: string) => s.split(/\s+/)[0] ?? s;
  const people = [...by].filter(([k]) => k !== WHO_NOBODY && k !== WHO_OFFICE);
  const firsts = new Map<string, number>();
  for (const [, p] of people) firsts.set(first(p.who), (firsts.get(first(p.who)) ?? 0) + 1);
  const out: AttentionPerson[] = people
    .map(([key, p]) => ({
      key,
      label: (firsts.get(first(p.who)) ?? 0) > 1 ? p.who : first(p.who),
      count: p.count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  for (const [key, label] of [
    [WHO_OFFICE, "Office"],
    [WHO_NOBODY, "Nobody"],
  ] as const) {
    const p = by.get(key);
    if (p) out.push({ key, label, count: p.count });
  }
  return out;
}

/** The rows of one person (`who` = a filter key), or all of them (null). */
export const rowsFor = (rows: readonly AttentionRow[], who: string | null): AttentionRow[] =>
  who === null ? [...rows] : rows.filter((r) => r.whoKey === who);
