/**
 * /service's search params (src/routes/service.tsx validateSearch). Pure, so the parsing is
 * tested without the route.
 *
 *   ?id=<uuid>[&closeout=1]   open that ticket (closeout=1, from Today: at its close-out)
 *   ?new=1[&tech&date|&from|&account[&site]|&opportunity]
 *                             a blank ticket, optionally prefilled (Tech Board "+", "New ticket
 *                             for this site", the Customers page, an opportunity's "Start a
 *                             ticket")
 *   ?stage=<filter>[&overdue=1]
 *                             the list with its stage chip preset — a single stage or
 *                             `openwork` (open + scheduled + done) — and, with overdue=1, only
 *                             open tickets whose day has passed (the Customers page counts strip)
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
/** The list's stage chip: everything, "Open work", or one stage. */
export type StageFilter = "all" | typeof SERVICE_OPEN_WORK | StageValue;

export interface ServiceSearch {
  id?: string;
  closeout?: 1;
  new?: 1;
  tech?: string;
  date?: string;
  from?: string;
  account?: string;
  site?: string;
  /** New ticket: from this opportunity (customer, site, description; from_opportunity_id). */
  opportunity?: string;
  /** List only: the stage chip to preset. */
  stage?: Exclude<StageFilter, "all">;
  /** List only: show only overdue open tickets. */
  overdue?: 1;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : undefined);
const isOne = (v: unknown) => v === 1 || v === "1" || v === true;

export function parseStageFilter(v: unknown): Exclude<StageFilter, "all"> | undefined {
  if (v === SERVICE_OPEN_WORK) return SERVICE_OPEN_WORK;
  return typeof v === "string" && (STAGE_VALUES as readonly string[]).includes(v)
    ? (v as StageValue)
    : undefined;
}

export function parseServiceSearch(s: Record<string, unknown>): ServiceSearch {
  const id = s["id"];
  if (typeof id === "string" && id) {
    return isOne(s["closeout"]) ? { id, closeout: 1 } : { id };
  }
  if (!isOne(s["new"])) {
    // The list: an optional stage chip and Overdue filter.
    const stage = parseStageFilter(s["stage"]);
    return {
      ...(stage ? { stage } : {}),
      ...(isOne(s["overdue"]) ? { overdue: 1 as const } : {}),
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
