/**
 * /service's search params (src/routes/service.tsx validateSearch). Pure, so the parsing is
 * tested without the route.
 *
 *   ?id=<uuid>[&closeout=1][&from=board&week=YYYY-MM-DD|&from=invoices]
 *                             open that ticket (closeout=1, from Today: at its close-out). `from`
 *                             (owner, Oct 9): where the ticket was opened from, so its Back link
 *                             returns there — the Tech Board at that week, or the Awaiting
 *                             invoice queue; without it, the Tickets list (whose own filters
 *                             live in the URL, so the browser's Back restores them).
 *   ?new=1[&tech&date|&from|&account[&site]|&opportunity]
 *                             a blank ticket, optionally prefilled (Tech Board "+", "New ticket
 *                             for this site", the Customers page, an opportunity's "Start a
 *                             ticket")
 *   ?stage=<filter>[&overdue=1][&q=…][&tech=<id|unassigned>][&type=<service type>]
 *                             the list with its filters — the stage chip (a single stage or
 *                             `openwork` = open + scheduled + done), overdue=1 (only open tickets
 *                             whose day has passed; the Customers page counts strip), the search
 *                             text, the Technician select and the Type select (owner, Oct 9: the
 *                             list keeps its filters and Back returns to them)
 */
import { SERVICE_OPEN_WORK } from "@/lib/work-counts";

/** The ticket stages (SERVICE_STAGES in service.functions.ts; the test checks they agree). */
export const STAGE_VALUES = [
  "open",
  "scheduled",
  "done",
  "authorized",
  "invoiced",
  "closed",
] as const;
export type StageValue = (typeof STAGE_VALUES)[number];
/** The service types (SERVICE_TYPES in service.functions.ts; the test checks they agree). */
export const TYPE_VALUES = ["leak", "scope", "warranty", "inspection", "other"] as const;
export type TypeValue = (typeof TYPE_VALUES)[number];
/** The list's stage chip: everything, "Open work", or one stage. */
export type StageFilter = "all" | typeof SERVICE_OPEN_WORK | StageValue;

/** Where a ticket was opened from (its Back link): the Tech Board or the Awaiting invoice queue. */
export const TICKET_FROM = ["board", "invoices"] as const;
export type TicketFrom = (typeof TICKET_FROM)[number];

export interface ServiceSearch {
  id?: string;
  closeout?: 1;
  new?: 1;
  /** New ticket: the technician to prefill (the Board's "+"). List: the Technician select. */
  tech?: string;
  date?: string;
  /**
   * New ticket: the earlier ticket to copy (a uuid). Ticket (`id`): where it was opened from
   * (`TicketFrom`), for the Back link.
   */
  from?: string;
  /** Ticket opened from the Board: the week shown there (its Monday, or any day of it). */
  week?: string;
  account?: string;
  site?: string;
  /** New ticket: from this opportunity (customer, site, description; from_opportunity_id). */
  opportunity?: string;
  /** List only: the stage chip to preset. */
  stage?: Exclude<StageFilter, "all">;
  /** List only: show only overdue open tickets. */
  overdue?: 1;
  /** List only: the search box. */
  q?: string;
  /** List only: the Type select (one service type). */
  type?: TypeValue;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : undefined);
const isOne = (v: unknown) => v === 1 || v === "1" || v === true;
/** The list's search text: a non-empty string, trimmed, capped (a URL is not a document). */
const Q_MAX = 200;
const qParam = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, Q_MAX);
  return t ? t : undefined;
};
const typeParam = (v: unknown): TypeValue | undefined =>
  typeof v === "string" && (TYPE_VALUES as readonly string[]).includes(v)
    ? (v as TypeValue)
    : undefined;
const fromParam = (v: unknown): TicketFrom | undefined =>
  typeof v === "string" && (TICKET_FROM as readonly string[]).includes(v)
    ? (v as TicketFrom)
    : undefined;

export function parseStageFilter(v: unknown): Exclude<StageFilter, "all"> | undefined {
  if (v === SERVICE_OPEN_WORK) return SERVICE_OPEN_WORK;
  return typeof v === "string" && (STAGE_VALUES as readonly string[]).includes(v)
    ? (v as StageValue)
    : undefined;
}

export function parseServiceSearch(s: Record<string, unknown>): ServiceSearch {
  const id = s["id"];
  if (typeof id === "string" && id) {
    const from = fromParam(s["from"]);
    const week = s["week"];
    return {
      id,
      ...(isOne(s["closeout"]) ? { closeout: 1 as const } : {}),
      ...(from ? { from } : {}),
      // A week only means something on the way back to the Board.
      ...(from === "board" && typeof week === "string" && YMD.test(week) ? { week } : {}),
    };
  }
  if (!isOne(s["new"])) {
    // The list: its filters (each left out when at its default).
    const stage = parseStageFilter(s["stage"]);
    const q = qParam(s["q"]);
    const tech = s["tech"];
    const type = typeParam(s["type"]);
    return {
      ...(stage ? { stage } : {}),
      ...(isOne(s["overdue"]) ? { overdue: 1 as const } : {}),
      ...(q ? { q } : {}),
      ...(typeof tech === "string" && tech && tech !== "all" ? { tech } : {}),
      ...(type ? { type } : {}),
    };
  }
  const tech = s["tech"];
  const date = s["date"];
  const from = uuidParam(s["from"]);
  const account = uuidParam(s["account"]);
  // A site only means something with its account.
  const site = account ? uuidParam(s["site"]) : undefined;
  const opportunity = uuidParam(s["opportunity"]);
  return {
    new: 1,
    ...(typeof tech === "string" && tech ? { tech } : {}),
    ...(typeof date === "string" && YMD.test(date) ? { date } : {}),
    ...(from ? { from } : {}),
    ...(account ? { account } : {}),
    ...(site ? { site } : {}),
    ...(opportunity ? { opportunity } : {}),
  };
}
