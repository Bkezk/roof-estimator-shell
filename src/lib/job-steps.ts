/**
 * One job, one row (owner, Nov 25, 2026: "2. go i like this setup").
 *
 * Things made from one another are one job: an opportunity, the inspection ticket made from it,
 * and the repair ticket or the bid that came from that. The owner: "if there is an opportunity
 * then an inspection ticket gets generated from that then the opportunity becomes overdue even
 * though someone is going to do the inspection thats a bit confusing", and "id also like for
 * only 1 thing to appear on the work overview at a time … but i also dont want to miss things".
 *
 * The rule is the step that is waiting now:
 *
 *   - While a step made from an opportunity is open and somebody has it, the opportunity WAITS
 *     on it. It is not on Work Overview, is not overdue, counts nowhere as overdue and sends no
 *     reminder. The pages say what it waits on: "Waiting on inspection #6090, Dec 4, Garry".
 *   - An open step is a ticket that is Open or Scheduled WITH a technician, or a draft bid with
 *     its estimator. A ticket nobody is on holds nothing back: the opportunity stays in sight.
 *   - The moment no step is open any more (done, deleted, nobody on it, the bid submitted), the
 *     opportunity is back by itself. Nothing is stored, so nothing can go stale: every screen
 *     and the reminder run ask this one function.
 *   - When the last open step is finished, the opportunity's person is told and given two
 *     working days to follow up (`followUpBy`, `stepDoneNotice`).
 *   - A step that runs late tells the opportunity's person on the first working day after its
 *     date and again every third working day while it is still late (`lateTellDue`,
 *     `stepLateNotice`). The late step is the one overdue row. Nov 26, 2026 (the audit's 22): it
 *     was said on one calendar day only, never for a step with no date, and never when the
 *     opportunity's person held the step themselves, so a draft bid nobody finished kept its
 *     opportunity quiet for good.
 *   - A step with no date counts as due ten working days after it was made (`stepDueDay`).
 *   - A bid holds an opportunity only while the person who started it still has a login, and a
 *     bid made from a ticket reaches that ticket's opportunity only when it is for the same
 *     customer: a copy made for somebody else is not part of the job.
 *   - Two steps from one inspection, a repair and a bid, are different work for different
 *     people: both show, and the opportunity waits on both.
 *
 * Rows are joined only by a real link (from_opportunity_id, from_job_id, a bid's
 * opportunity_id), never by an address. Two tickets at one property that were not made from one
 * another both show, each with "Also open at this property: …" (`alsoOpenHere`).
 *
 * Pure: no database, no React. job-steps.server.ts reads the rows.
 */
import { addWorkingDays, isWorkingDay, officeDay, workingDaysBetween } from "@/lib/working-days";

export interface StepTicket {
  id: string;
  number: number;
  service_type: string;
  stage: string;
  scheduled_date: string | null;
  technician_id: string | null;
  from_opportunity_id: string | null;
  from_job_id: string | null;
  deleted_at?: string | null;
  /** The ticket's customer: a bid made from it must be for the same one to be of its job. */
  account_id?: string | null;
  /** When it was made: a ticket with no date counts as due ten working days after. */
  created_at?: string | null;
}
export interface StepBid {
  id: string;
  name: string;
  status: string;
  due_date: string | null;
  created_by: string | null;
  opportunity_id: string | null;
  from_job_id: string | null;
  deleted_at?: string | null;
  account_id?: string | null;
  created_at?: string | null;
}

/** One open step an opportunity waits on. */
export interface OpenStep {
  kind: "ticket" | "bid";
  id: string;
  /** "inspection #6090", "repair #6091", "ticket #6092", "bid Dock re-roof". */
  label: string;
  /** Its day (YYYY-MM-DD): the ticket's date, the bid's due date. */
  date: string | null;
  personId: string | null;
  /**
   * The day it counts as due: its own day, or ten working days after it was made when it has
   * none (`stepDueDay`). Null only when neither is known: such a step is never late.
   */
  due: string | null;
  /** The office day it was made, when known. */
  made: string | null;
}

/** A step with no date counts as due this many working days after it was made (Nov 26). */
export const UNDATED_STEP_WORKING_DAYS = 10;

/** The day a step counts as due: its own, else ten working days after the day it was made. */
export const stepDueDay = (date: string | null, made: string | null): string | null =>
  date ?? (made ? addWorkingDays(made, UNDATED_STEP_WORKING_DAYS) : null);

/** The stages a ticket is still to be done in (Work Overview's own list). */
const OPEN_TICKET_STAGES = new Set(["open", "scheduled"]);

/** A ticket that holds its opportunity back: still to be done, and somebody has it. */
export const ticketIsOpenStep = (t: StepTicket): boolean =>
  !t.deleted_at && OPEN_TICKET_STAGES.has(t.stage) && !!t.technician_id;

/**
 * A bid that holds its opportunity back: a draft with its estimator. `people` is everybody who
 * still has a login (Nov 26, the audit's 22: `bids.created_by` is not tied to a person in the
 * database, so the bid of somebody who has left still counted as "with its estimator" and held
 * its opportunity for good). Null or left out: not known, and every estimator counts.
 */
export const bidIsOpenStep = (b: StepBid, people?: ReadonlySet<string> | null): boolean =>
  !b.deleted_at && b.status === "draft" && !!b.created_by && (!people || people.has(b.created_by));

/**
 * Is a bid made from this ticket part of the ticket's job? Only when it is for the ticket's
 * customer, or has no customer yet (Nov 26, the audit's 22: a copy of a bid keeps the ticket it
 * was started from, duplicate-bid.ts, and a copy made for ANOTHER customer held the first
 * customer's opportunity quiet). A bid tied to the opportunity itself is not asked this.
 */
export const bidIsOfTicketsJob = (
  b: Pick<StepBid, "account_id">,
  ticket: Pick<StepTicket, "account_id">,
): boolean => !b.account_id || b.account_id === (ticket.account_id ?? null);

export const ticketStepLabel = (t: Pick<StepTicket, "number" | "service_type">): string =>
  `${t.service_type === "inspection" ? "inspection" : t.service_type === "repair" ? "repair" : "ticket"} #${t.number}`;
export const bidStepLabel = (b: Pick<StepBid, "name">): string =>
  `bid ${(b.name ?? "").trim() || "(no name)"}`;

/**
 * The opportunity a ticket belongs to: its own, or the one of the ticket it was made from (a
 * repair made from an inspection). Null when it belongs to none.
 */
export function opportunityOfTicket(
  t: StepTicket,
  byId: ReadonlyMap<string, StepTicket>,
): string | null {
  if (t.from_opportunity_id) return t.from_opportunity_id;
  const parent = t.from_job_id ? byId.get(t.from_job_id) : undefined;
  return parent?.from_opportunity_id ?? null;
}

/** Every open step, by the opportunity that waits on it. Tickets first, then bids, by day. */
export function openStepsByOpportunity(input: {
  tickets: readonly StepTicket[];
  bids: readonly StepBid[];
  /** Everybody who still has a login, when known (`bidIsOpenStep`). */
  people?: ReadonlySet<string> | null;
}): Map<string, OpenStep[]> {
  const byId = new Map(input.tickets.map((t) => [t.id, t]));
  const out = new Map<string, OpenStep[]>();
  const madeDay = (at: string | null | undefined) => (at ? officeDay(at) : null);
  const add = (opp: string | null, step: OpenStep) => {
    if (!opp) return;
    const list = out.get(opp) ?? [];
    list.push(step);
    out.set(opp, list);
  };
  for (const t of input.tickets)
    if (ticketIsOpenStep(t))
      add(opportunityOfTicket(t, byId), {
        kind: "ticket",
        id: t.id,
        label: ticketStepLabel(t),
        date: t.scheduled_date,
        personId: t.technician_id,
        due: stepDueDay(t.scheduled_date, madeDay(t.created_at)),
        made: madeDay(t.created_at),
      });
  for (const b of input.bids)
    if (bidIsOpenStep(b, input.people)) {
      const parent = b.from_job_id ? byId.get(b.from_job_id) : undefined;
      const throughTicket =
        parent && bidIsOfTicketsJob(b, parent) ? opportunityOfTicket(parent, byId) : null;
      add(b.opportunity_id ?? throughTicket, {
        kind: "bid",
        id: b.id,
        label: bidStepLabel(b),
        date: b.due_date,
        personId: b.created_by,
        due: stepDueDay(b.due_date, madeDay(b.created_at)),
        made: madeDay(b.created_at),
      });
    }
  const order = (s: OpenStep) => `${s.kind === "ticket" ? 0 : 1}${s.date ?? "9999-99-99"}`;
  for (const list of out.values()) list.sort((a, b) => order(a).localeCompare(order(b)));
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Dec 4" from 2026-12-04. */
export const stepDay = (ymd: string): string =>
  `${MONTHS[Number(ymd.slice(5, 7)) - 1] ?? ""} ${Number(ymd.slice(8, 10))}`.trim();

/** What is said where a step's day would be when it has none (Nov 26). */
export const STEP_NO_DATE = "no date set";

/** What a waiting step needs to be said. */
export type StepSaid = Pick<OpenStep, "label" | "date" | "personId">;

/**
 * "inspection #6090, Dec 4, Garry Peters": the label, its day and who has it. A step with no
 * day says so, "bid Dock re-roof, no date set, Ro" (Nov 26: the day was simply left out, and a
 * step with no day is the one that can sit unseen).
 */
export function stepWords(s: StepSaid, names: Readonly<Record<string, string>> = {}): string {
  const who = s.personId ? (names[s.personId] ?? "").trim() : "";
  return [s.label, s.date ? stepDay(s.date) : STEP_NO_DATE, who].filter(Boolean).join(", ");
}

/**
 * "Waiting on inspection #6090, Dec 4, Garry Peters." One step is said in full; several are
 * named and joined, each still with its day.
 */
export function waitingWords(
  steps: readonly StepSaid[],
  names: Readonly<Record<string, string>> = {},
): string {
  if (!steps.length) return "";
  if (steps.length === 1) return `Waiting on ${stepWords(steps[0]!, names)}`;
  const parts = steps.map((s) => `${s.label}, ${s.date ? stepDay(s.date) : STEP_NO_DATE}`);
  return `Waiting on ${parts.slice(0, -1).join("; ")} and ${parts[parts.length - 1]}`;
}

/** The working days the opportunity's person gets once the last open step is finished. */
export const FOLLOW_UP_WORKING_DAYS = 2;

/** The day to follow up by: two working days after the step was finished. */
export const followUpBy = (doneDay: string): string =>
  addWorkingDays(doneDay, FOLLOW_UP_WORKING_DAYS);

/**
 * The opportunity's new follow-up day when its last step is finished: never earlier than it
 * already was. A date that is already further out is left alone.
 */
export function followUpAfterStep(doneDay: string, current: string | null): string {
  const by = followUpBy(doneDay);
  return current && current > by ? current : by;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * How a step ended (Nov 26, the audit's 24). A bid's was always said "submitted", even when it
 * was marked Won or Lost; a ticket sent straight to Authorized, Invoiced or Closed, and a step
 * that was deleted, said nothing at all.
 */
export type StepOutcome =
  "done" | "authorized" | "invoiced" | "closed" | "submitted" | "won" | "lost" | "deleted";

/** "is done", "is marked Won", "was deleted". */
export const stepOutcomeWords = (o: StepOutcome): string =>
  o === "deleted" ? "was deleted" : o === "won" || o === "lost" ? `is marked ${cap(o)}` : `is ${o}`;

/** A bid's outcome from the status it left Draft for. Anything unknown reads "submitted". */
export const bidOutcome = (status: string | null | undefined): StepOutcome =>
  status === "won" || status === "lost" ? status : "submitted";

/** A ticket's outcome from the stage it left Open / Scheduled for. */
export const ticketOutcome = (stage: string | null | undefined): StepOutcome =>
  stage === "authorized" || stage === "invoiced" || stage === "closed" ? stage : "done";

/** Did this change of stage take a ticket out of the stages it is still to be done in? */
export const ticketLeftOpen = (prev: string | null | undefined, now: string): boolean =>
  !!prev && OPEN_TICKET_STAGES.has(prev) && !OPEN_TICKET_STAGES.has(now);

/** What the opportunity's person is told when the step it waited on is finished. */
export function stepDoneNotice(input: {
  /** "inspection #6090", "bid Dock re-roof". */
  label: string;
  outcome: StepOutcome;
  opportunity: string;
  /** The day to follow up by, as it is said ("Monday 12/8/2026"). */
  by: string;
  /**
   * The opportunity is on hold until this day, later than `by` (Nov 26): its follow-up day and
   * the hold are left as they are, and the notice says so.
   */
  heldUntil?: string | null;
}): { title: string; body: string } {
  return {
    title: `${cap(input.label)} ${stepOutcomeWords(input.outcome)}: follow up on ${input.opportunity}`,
    body: input.heldUntil
      ? `Your opportunity was waiting on it. It is on hold until ${input.heldUntil}, so its follow-up day was not changed.`
      : `Your opportunity was waiting on it. Follow up by ${input.by}.`,
  };
}

/** The one line the hand-back leaves in the opportunity's log. */
export const stepDoneLogLine = (input: {
  label: string;
  outcome: StepOutcome;
  by: string;
  heldUntil?: string | null;
}): string =>
  `${cap(input.label)} ${stepOutcomeWords(input.outcome)}. ${
    input.heldUntil
      ? `On hold until ${input.heldUntil}: the follow-up day was not changed.`
      : `Follow up by ${input.by}.`
  }`;

/**
 * Is a hold on the opportunity left alone by the hand-back? A hold that is still running and
 * ends after the two working days (Nov 26, the audit's 24: the hand-back moved the follow-up
 * day, and the database ends a hold whenever that day moves. An opportunity on hold until Dec 15
 * at the customer's asking lost its hold, with no word, when its inspection was marked Done on
 * Dec 1). `heldUntilDay` is the office day the hold ends.
 */
export const holdOutlasts = (heldUntilDay: string | null | undefined, by: string): boolean =>
  !!heldUntilDay && heldUntilDay > by;

/** Is this step late today? Its due day has passed (`stepDueDay`). */
export const stepIsLate = (s: Pick<OpenStep, "due">, today: string): boolean =>
  !!s.due && s.due < today;

/** A late step is said again every this many working days while it is still late (Nov 26). */
export const LATE_AGAIN_WORKING_DAYS = 3;

/**
 * Is it time to say these late steps? `lastTold` is the office day the opportunity's last late
 * notice went (null: never). Only on a working day, and:
 *   - never told: now, which is the first working day after the step's date when the run goes
 *     every morning, and the first run after it when a morning was missed;
 *   - a step has run late since the last notice (it was not late that day): now;
 *   - else every third working day while one is still late.
 * Nov 26, 2026 (the audit's 22): it was "the first working day after its date, and only that
 * day", so a missed run lost the notice for good and nothing was ever said twice.
 */
export function lateTellDue(
  late: readonly Pick<OpenStep, "due">[],
  lastTold: string | null,
  today: string,
): boolean {
  if (!late.length || !isWorkingDay(today)) return false;
  if (!lastTold) return true;
  if (late.some((s) => !!s.due && s.due >= lastTold)) return true;
  return workingDaysBetween(lastTold, today) >= LATE_AGAIN_WORKING_DAYS;
}

/** One late step, as the notice says it. */
export interface LateStepSaid {
  /** "inspection #6090", "bid Dock re-roof". */
  label: string;
  /** Its own day as it is said ("Thursday 12/4/2026"), or null when it has none. */
  was: string | null;
  /** The day it was made, as it is said: for a step with no day of its own. */
  made: string | null;
  /** Who has it: a name, "you", or null when not known. */
  who: string | null;
}

const lateSentence = (s: LateStepSaid, subject: string): string =>
  s.was
    ? `${subject} was set for ${s.was}${s.who ? ` with ${s.who}` : ""}.`
    : `${subject} has no date set${s.made ? ` and was made on ${s.made}` : ""}${
        s.who ? (s.who === "you" ? ", and you have it" : `, and ${s.who} has it`) : ""
      }.`;

/**
 * What is said when the steps an opportunity waits on run late. Every late step is named (Nov
 * 26: only the first was). `nobody`: the opportunity has nobody on it, and the people on the
 * "Nobody is on it" line are the ones told.
 */
export function stepLateNotice(input: {
  steps: readonly LateStepSaid[];
  opportunity: string;
  nobody?: boolean;
}): { title: string; body: string } {
  const labels = input.steps.map((s) => s.label);
  const named =
    labels.length <= 1
      ? (labels[0] ?? "")
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const one = input.steps.length === 1;
  const waits = input.nobody
    ? `The opportunity is waiting on ${one ? "it" : "them"}, and nobody is on the opportunity.`
    : `Your opportunity is waiting on ${one ? "it" : "them"}.`;
  return {
    title: `${cap(named)} ${one ? "is" : "are"} late: ${input.opportunity}`,
    body: `${input.steps.map((s) => lateSentence(s, one ? "It" : cap(s.label))).join(" ")} ${waits}`,
  };
}

/** A ticket at a property, for the "also open here" note. */
export interface PlaceTicket {
  id: string;
  number: number;
  service_type: string;
  stage: string;
  site_id: string | null;
  from_opportunity_id: string | null;
  from_job_id: string | null;
  deleted_at?: string | null;
}

/**
 * "Also open at this property: repair #6070, inspection #6071" for each open ticket that shares
 * its property with another open ticket NOT of the same job. Tickets joined by a link are one
 * job and say nothing of each other. Never merges rows: it only adds the note.
 */
export function alsoOpenHere(tickets: readonly PlaceTicket[]): Map<string, string> {
  const open = tickets.filter((t) => !t.deleted_at && OPEN_TICKET_STAGES.has(t.stage) && t.site_id);
  const byId = new Map(open.map((t) => [t.id, t]));
  // The job a ticket is part of: its opportunity, else the top of its from_job_id chain.
  const jobOf = (t: PlaceTicket): string => {
    let cur = t;
    for (let i = 0; i < 5; i++) {
      if (cur.from_opportunity_id) return `opp:${cur.from_opportunity_id}`;
      const parent = cur.from_job_id ? byId.get(cur.from_job_id) : undefined;
      if (!parent) return cur.from_job_id ? `job:${cur.from_job_id}` : `job:${cur.id}`;
      cur = parent;
    }
    return `job:${cur.id}`;
  };
  const bySite = new Map<string, PlaceTicket[]>();
  for (const t of open) bySite.set(t.site_id!, [...(bySite.get(t.site_id!) ?? []), t]);
  const out = new Map<string, string>();
  for (const here of bySite.values()) {
    if (here.length < 2) continue;
    for (const t of here) {
      const job = jobOf(t);
      const others = here
        .filter((o) => o.id !== t.id && jobOf(o) !== job)
        .sort((a, b) => a.number - b.number)
        .map((o) => ticketStepLabel(o));
      if (others.length) out.set(t.id, `Also open at this property: ${others.join(", ")}`);
    }
  }
  return out;
}

// ── Link an existing ticket (owner, Nov 25) ─────────────────────────────────────────────────────
// A ticket that was made on its own, and not with "Start a ticket", is not part of its
// opportunity's job until somebody says so. The opportunity offers the customer's open tickets
// that belong to no opportunity yet; one press joins one, one press takes it off again.

/** A ticket as the link rule sees it. */
export interface LinkTicketIn {
  id: string;
  number: number;
  service_type: string;
  stage: string;
  scheduled_date: string | null;
  account_id: string | null;
  from_opportunity_id: string | null;
  from_job_id: string | null;
  deleted_at?: string | null;
  site_name?: string | null;
}
/** One row of the link window. */
export interface LinkTicketRow {
  id: string;
  number: number;
  /** "Inspection #6071". */
  label: string;
  /** "Dec 4", or "No date". */
  day: string;
  place: string | null;
  linked: boolean;
  /**
   * Linking it would mark the opportunity Won (Nov 26): the window asks before it does. Null
   * for a linked row and for a ticket that moves nothing or only makes it Contacted.
   */
  ask: string | null;
}

export const LINK_TICKET_BUTTON = "Link an existing ticket";
export const LINK_TICKET_LEAD =
  "A ticket made on its own is not part of this opportunity until it is linked. While a linked ticket is open and somebody has it, this opportunity waits on it and is not overdue.";
/**
 * The second line of the window (Nov 26, the audit's 21): what a link does to the status was
 * said nowhere before the press, and one press marked the opportunity Won.
 */
export const LINK_MOVES_LEAD =
  "Linking an inspection makes an Open opportunity Contacted. Linking a repair marks it Won. Unlink puts the status back when nothing else has changed it since.";
/** The same line for an opportunity that came from a Roof Care request. */
export const LINK_MOVES_LEAD_CARE =
  "Linking an inspection makes an Open opportunity Contacted. A link never marks this one Won: it came from a Roof Care request and turns Won when its plan is paid.";

/**
 * Would linking a ticket of this type mark the opportunity Won? The twin of the database's
 * rule (move_opportunity_from_ticket; ticket-moves.ts oppStatusFromTicket, and a test holds
 * the two together): anything that is not an inspection or a warranty visit wins an
 * opportunity that is not closed. Never for one that came from a Roof Care request: that one
 * turns Won when its plan is paid (20261123300000), and a link does not move it there.
 */
export const linkWouldWin = (
  serviceType: string,
  opp: { status?: string | null; care?: boolean },
): boolean =>
  !opp.care &&
  !["inspection", "warranty"].includes(serviceType) &&
  !["won", "lost", "no_response"].includes(opp.status ?? "");

/** The question asked before a link that marks the opportunity Won. */
export const linkWinsAsk = (serviceType: string): string =>
  `Linking ${serviceType === "repair" ? "a repair" : "this ticket"} marks this opportunity Won. Link it?`;
export const LINK_WINS_YES = "Link it";
export const LINK_WINS_NO = "Cancel";
/** Why a repair linked to a Roof Care request's opportunity left it where it was. */
export const LINK_CARE_NOT_WON =
  "The opportunity was not marked Won: it came from a Roof Care request and turns Won when its plan is paid.";
/** The site could not ask whether it came from a Roof Care request: it moves nothing. */
export const LINK_WON_NOT_CHECKED =
  "The opportunity was not marked Won: the site could not check whether it came from a Roof Care request. Mark it Won on the opportunity if it should be.";
export const LINK_NONE_TO_LINK = "This customer has no other open ticket to link.";
export const LINK_NO_CUSTOMER = "Pick this opportunity's customer first, then link a ticket.";
export const LINK_OTHER_CUSTOMER =
  "That ticket is for another customer, so it was not linked. Nothing was changed.";
export const LINK_ALREADY =
  "That ticket already belongs to another opportunity, so it was not linked. Nothing was changed.";
export const LINK_NOT_OPEN =
  "Only a ticket that is still Open or Scheduled can be linked. Nothing was changed.";
export const LINK_NOT_HERE = "That ticket is not linked to this opportunity. Nothing was changed.";
export const LINK_NOT_ALLOWED =
  "Only someone who creates tickets can link a ticket to an opportunity.";
export const LINK_CLOSED =
  "This opportunity is closed or deleted, so no ticket can be linked to it.";

/**
 * Why this ticket cannot be linked to this opportunity, or null. `parentOpportunity` is the
 * opportunity of the ticket it was made from (a repair made from an inspection is already part
 * of that inspection's job).
 */
export function linkProblem(
  opp: { id: string; account_id: string | null },
  t: LinkTicketIn,
  parentOpportunity: string | null = null,
): string | null {
  if (!opp.account_id) return LINK_NO_CUSTOMER;
  if (t.account_id !== opp.account_id) return LINK_OTHER_CUSTOMER;
  if (t.from_opportunity_id === opp.id) return null;
  if (t.from_opportunity_id || parentOpportunity) return LINK_ALREADY;
  if (t.deleted_at || !OPEN_TICKET_STAGES.has(t.stage)) return LINK_NOT_OPEN;
  return null;
}

/**
 * The rows of the link window: the tickets already linked to this opportunity first, then the
 * customer's open tickets that belong to no opportunity, each by number.
 */
export function linkRows(
  opp: { id: string; account_id: string | null; status?: string | null; care?: boolean },
  tickets: readonly LinkTicketIn[],
): LinkTicketRow[] {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const parentOpp = (t: LinkTicketIn) =>
    (t.from_job_id ? byId.get(t.from_job_id)?.from_opportunity_id : null) ?? null;
  const row = (t: LinkTicketIn, linked: boolean): LinkTicketRow => ({
    id: t.id,
    number: t.number,
    label: cap(ticketStepLabel(t)),
    day: t.scheduled_date ? stepDay(t.scheduled_date) : "No date",
    place: (t.site_name ?? "").trim() || null,
    linked,
    ask: !linked && linkWouldWin(t.service_type, opp) ? linkWinsAsk(t.service_type) : null,
  });
  const live = tickets.filter((t) => !t.deleted_at);
  const linked = live.filter((t) => t.from_opportunity_id === opp.id);
  const free = live.filter(
    (t) =>
      t.from_opportunity_id !== opp.id &&
      // A repair made from one of this opportunity's tickets is already in the job.
      parentOpp(t) !== opp.id &&
      linkProblem(opp, t, parentOpp(t)) === null,
  );
  const byNumber = (a: LinkTicketIn, b: LinkTicketIn) => a.number - b.number;
  return [
    ...linked.sort(byNumber).map((t) => row(t, true)),
    ...free.sort(byNumber).map((t) => row(t, false)),
  ];
}

/** Unlink is done, and the opportunity's status could not be looked at: said out loud. */
export const unlinkNotChecked = (why: string): string =>
  `The site could not check the opportunity's status, so open the opportunity and look at it (${why}).`;

/** What is said after a press. */
export const linkedWords = (label: string, moved?: { to: string } | null): string =>
  `${label} is linked to this opportunity.${moved ? ` The opportunity is now ${moved.to}.` : ""}`;
/**
 * After Unlink (Nov 26, the audit's 21). `back`: the link was what moved the opportunity and
 * nothing has moved it since, so its status went back ("The opportunity is Quoted again.").
 * `still`: something else has moved it since, or the link never moved it, and it is closed, so
 * it is left and the message says where it stands ("The opportunity is still Won.").
 */
export const unlinkedWords = (
  label: string,
  after?: { back?: string | null; still?: string | null } | null,
): string =>
  `${label} is no longer linked to this opportunity.${
    after?.back
      ? ` The opportunity is ${after.back} again.`
      : after?.still
        ? ` The opportunity is still ${after.still}.`
        : ""
  }`;
