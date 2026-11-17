/**
 * Every step of every ticket, for the admins and the managers (owner, Nov 17: "managers and owner
 * should get all notifications, like when a ticket is opened then when scheduled, done etc.").
 *
 * Until then a ticket told only the people it was FOR: the technician it was given to, the
 * reviewers when it was done, the office when it was ready to invoice. A ticket that was opened
 * and given to somebody else told the owner nothing.
 *
 * One notice per change, in the words below. A person the same change already tells another way
 * is left out (`skip`), so nobody hears one change twice: the technician who gets "Assigned to
 * you", the one who gets "Ticket #N was reassigned" or "moved to <day>". Done is not here: every
 * admin and manager already gets "is done, ready for your review" (ticket-events.server.ts).
 *
 * Pure: the words and who is left out. Who the admins and managers are, and the sending, is
 * ticket-events.server.ts (tellWatchers).
 */
import { longDay } from "@/lib/followup-rules";

/** The notice kind. A service notice (notice-categories.ts): the Service notices switch covers it. */
export const TICKET_WATCH_KIND = "ticket_watch";

export interface WatchTicket {
  number: number;
  customer_name: string;
  description: string;
  stage: string;
  technician_id: string | null;
  scheduled_date?: string | null | undefined;
}

export interface WatchNotice {
  title: string;
  body: string;
  /** People this same change already tells another way. */
  skip: string[];
}

const LABELS: Readonly<Record<string, string>> = {
  open: "Open",
  scheduled: "Scheduled",
  done: "Done",
  authorized: "Authorized",
  invoiced: "Invoiced",
  closed: "Closed",
};
const ORDER = ["open", "scheduled", "done", "authorized", "invoiced", "closed"];
const label = (stage: string) => LABELS[stage] ?? stage;

const ticketTitle = (t: WatchTicket) =>
  `Ticket #${t.number} ${t.customer_name}${t.description ? ` — ${t.description}` : ""}`;

const ids = (...list: (string | null | undefined)[]) =>
  list.filter((x): x is string => typeof x === "string" && !!x);

/** Who has it and for when: "Assigned to Garry Peters for Nov 18, 2026." */
export function assignedLine(t: WatchTicket, techName: string | null): string {
  const who = t.technician_id ? (techName ?? "a technician") : null;
  const day = t.scheduled_date ? longDay(t.scheduled_date) : null;
  if (who && day) return `Assigned to ${who} for ${day}.`;
  if (who) return `Assigned to ${who}, no date yet.`;
  if (day) return `Set for ${day}, nobody assigned yet.`;
  return "Nobody is assigned yet.";
}

/**
 * The notice for a ticket that was opened, deleted, or moved to another stage; null when the
 * step has none (the stage did not move, or it became Done).
 * `prevStage` null: the ticket is new.
 */
export function stageWatchNotice(input: {
  row: WatchTicket;
  prevStage: string | null;
  deleted: boolean;
  who: string;
  techName: string | null;
  /** An inspection that ends at Authorized: there is no invoice to come. */
  endsHere?: boolean | undefined;
}): WatchNotice | null {
  const { row, prevStage, who } = input;
  const t = ticketTitle(row);
  const tech = ids(row.technician_id);
  if (input.deleted)
    return {
      title: `Deleted: ${t}`,
      body: `${who} deleted it. A manager can put it back from Recently deleted on the Service page.`,
      skip: [],
    };
  const assigned = assignedLine(row, input.techName);
  if (prevStage === null)
    return { title: `Opened: ${t}`, body: `${who} opened it. ${assigned}`, skip: tech };
  if (prevStage === row.stage) return null;
  const to = ORDER.indexOf(row.stage);
  const from = ORDER.indexOf(prevStage);
  if (row.stage === "done") return null;
  if (row.stage === "open" || row.stage === "scheduled") {
    // Back from Done or an office stage: the technician hears "Reopened" from the follow-up.
    if (from > ORDER.indexOf("scheduled"))
      return {
        title: `Reopened: ${t}`,
        body: `${who} moved it back to ${label(row.stage)} from ${label(prevStage)}. ${assigned}`,
        skip: tech,
      };
    if (row.stage === "scheduled")
      return { title: `Scheduled: ${t}`, body: `${who} scheduled it. ${assigned}`, skip: tech };
    return {
      title: `Back to Open: ${t}`,
      body: `${who} took it off the schedule. ${assigned}`,
      skip: [],
    };
  }
  if (from > to)
    return {
      title: `Back to ${label(row.stage)}: ${t}`,
      body: `${who} moved it back to ${label(row.stage)} from ${label(prevStage)}.`,
      skip: [],
    };
  if (row.stage === "authorized")
    return {
      title: `Authorized: ${t}`,
      body: input.endsHere
        ? `${who} authorized it. That completes the inspection.`
        : `${who} authorized it.`,
      skip: [],
    };
  if (row.stage === "invoiced")
    return { title: `Invoiced: ${t}`, body: `${who} moved it to Invoiced.`, skip: [] };
  if (row.stage === "closed") return { title: `Closed: ${t}`, body: `${who} closed it.`, skip: [] };
  return {
    title: `${label(row.stage)}: ${t}`,
    body: `${who} moved it to ${label(row.stage)} from ${label(prevStage)}.`,
    skip: [],
  };
}

/**
 * The notice for a ticket whose technician or day changed while its stage stayed; null when
 * neither did. (A change that also moved the stage is told by stageWatchNotice, once.)
 */
export function dispatchWatchNotice(input: {
  row: WatchTicket;
  before: { technician_id: string | null; scheduled_date: string | null };
  who: string;
  techName: string | null;
  oldTechName: string | null;
}): WatchNotice | null {
  const { row, before, who } = input;
  const t = ticketTitle(row);
  const oldTech = before.technician_id ?? null;
  const newTech = row.technician_id ?? null;
  const oldDay = before.scheduled_date ?? null;
  const newDay = row.scheduled_date ?? null;
  const dayMoved = oldDay !== newDay && !!newDay;
  if (oldTech !== newTech) {
    const a = input.oldTechName ?? "a technician";
    const b = input.techName ?? "a technician";
    const day = dayMoved ? ` It is set for ${longDay(newDay)}.` : "";
    if (oldTech && newTech)
      return {
        title: `Reassigned: ${t}`,
        body: `${who} moved it from ${a} to ${b}.${day}`,
        skip: ids(oldTech, newTech),
      };
    if (newTech)
      return {
        title: `Assigned: ${t}`,
        body: `${who} assigned it to ${b}${newDay ? ` for ${longDay(newDay)}` : ", no date yet"}.`,
        skip: ids(newTech),
      };
    return {
      title: `Unassigned: ${t}`,
      body: `${who} took it off ${a}. Nobody is assigned now.`,
      skip: [],
    };
  }
  if (!dayMoved) return null;
  if (!oldDay)
    return {
      title: `Date set: ${t}`,
      body: `${who} set it for ${longDay(newDay)}.`,
      skip: ids(newTech),
    };
  return {
    title: `Date moved: ${t}`,
    body: `${who} moved it from ${longDay(oldDay)} to ${longDay(newDay)}.`,
    skip: ids(newTech),
  };
}
