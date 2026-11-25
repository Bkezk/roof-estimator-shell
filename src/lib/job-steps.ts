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
 *   - A step that runs late tells the opportunity's person once, on the first working day after
 *     its date (`stepLateOn`, `stepLateNotice`). The late step is the one overdue row.
 *   - Two steps from one inspection, a repair and a bid, are different work for different
 *     people: both show, and the opportunity waits on both.
 *
 * Rows are joined only by a real link (from_opportunity_id, from_job_id, a bid's
 * opportunity_id), never by an address. Two tickets at one property that were not made from one
 * another both show, each with "Also open at this property: …" (`alsoOpenHere`).
 *
 * Pure: no database, no React. job-steps.server.ts reads the rows.
 */
import { addWorkingDays, isWorkingDay, workingDayBefore } from "@/lib/working-days";

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
}

/** The stages a ticket is still to be done in (Work Overview's own list). */
const OPEN_TICKET_STAGES = new Set(["open", "scheduled"]);

/** A ticket that holds its opportunity back: still to be done, and somebody has it. */
export const ticketIsOpenStep = (t: StepTicket): boolean =>
  !t.deleted_at && OPEN_TICKET_STAGES.has(t.stage) && !!t.technician_id;

/** A bid that holds its opportunity back: a draft with its estimator. */
export const bidIsOpenStep = (b: StepBid): boolean =>
  !b.deleted_at && b.status === "draft" && !!b.created_by;

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
}): Map<string, OpenStep[]> {
  const byId = new Map(input.tickets.map((t) => [t.id, t]));
  const out = new Map<string, OpenStep[]>();
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
      });
  for (const b of input.bids)
    if (bidIsOpenStep(b)) {
      const parent = b.from_job_id ? byId.get(b.from_job_id) : undefined;
      add(b.opportunity_id ?? (parent ? opportunityOfTicket(parent, byId) : null), {
        kind: "bid",
        id: b.id,
        label: bidStepLabel(b),
        date: b.due_date,
        personId: b.created_by,
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

/** "inspection #6090, Dec 4, Garry Peters": the label, its day and who has it, what is known. */
export function stepWords(s: OpenStep, names: Readonly<Record<string, string>> = {}): string {
  const who = s.personId ? (names[s.personId] ?? "").trim() : "";
  return [s.label, s.date ? stepDay(s.date) : "", who].filter(Boolean).join(", ");
}

/**
 * "Waiting on inspection #6090, Dec 4, Garry Peters." One step is said in full; several are
 * named and joined, each still with its day.
 */
export function waitingWords(
  steps: readonly OpenStep[],
  names: Readonly<Record<string, string>> = {},
): string {
  if (!steps.length) return "";
  if (steps.length === 1) return `Waiting on ${stepWords(steps[0]!, names)}`;
  const parts = steps.map((s) => (s.date ? `${s.label}, ${stepDay(s.date)}` : s.label));
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

/** What the opportunity's person is told when the step it waited on is finished. */
export function stepDoneNotice(input: {
  /** "inspection #6090", "bid Dock re-roof". */
  label: string;
  /** "done" for a ticket, "submitted" for a bid. */
  outcome: "done" | "submitted";
  opportunity: string;
  /** The day to follow up by, as it is said ("Monday 12/8/2026"). */
  by: string;
}): { title: string; body: string } {
  return {
    title: `${cap(input.label)} is ${input.outcome}: follow up on ${input.opportunity}`,
    body: `Your opportunity was waiting on it. Follow up by ${input.by}.`,
  };
}

/**
 * Is this the day to say a step is late? The first working day after its date, and only that
 * day: the run that sends it goes once a morning, so it is said once. A step moved to a new
 * date that is missed again is said again.
 */
export function stepLateOn(stepDate: string | null, today: string): boolean {
  if (!stepDate || !isWorkingDay(today) || stepDate >= today) return false;
  return workingDayBefore(today) <= stepDate;
}

/** What the opportunity's person is told, once, when the step it waits on runs late. */
export function stepLateNotice(input: {
  label: string;
  opportunity: string;
  /** The step's day, as it is said ("Thursday 12/4/2026"). */
  was: string;
  who: string | null;
}): { title: string; body: string } {
  return {
    title: `${cap(input.label)} is late: ${input.opportunity}`,
    body: `It was set for ${input.was}${input.who ? ` with ${input.who}` : ""}. Your opportunity is waiting on it.`,
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
}

export const LINK_TICKET_BUTTON = "Link an existing ticket";
export const LINK_TICKET_LEAD =
  "A ticket made on its own is not part of this opportunity until it is linked. While a linked ticket is open and somebody has it, this opportunity waits on it and is not overdue.";
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
  opp: { id: string; account_id: string | null },
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

/** What is said after a press. */
export const linkedWords = (label: string, moved?: { to: string } | null): string =>
  `${label} is linked to this opportunity.${moved ? ` The opportunity is now ${moved.to}.` : ""}`;
export const unlinkedWords = (label: string): string =>
  `${label} is no longer linked to this opportunity.`;
