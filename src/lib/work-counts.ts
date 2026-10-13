/**
 * Work counts (owner, Oct 1): "something above the current customer page that shows total open
 * service tickets and overdue ones, same with opportunities, and you can click each number to
 * take you to a list of those things." Pure rules only (no I/O): the server function in
 * work-counts.functions.ts counts the rows, components/work-counts-strip.tsx shows the tiles, and
 * the Service / Opportunities lists use the same predicates when a tile's link presets them, so a
 * tile's number and the list it opens agree.
 *
 *   Tickets in progress    live, stage open / scheduled / done / authorized — everything not yet
 *                          invoiced or closed (owner, Oct 12, item 6: Work Overview lists Open /
 *                          Scheduled as work, Done under Needs authorization and Authorized under
 *                          To invoice; the tile counts all of it, so it is labelled honestly)
 *   Overdue tickets        Open / Scheduled tickets WITH a technician whose scheduled_date is
 *                          before today — never a Done ticket (owner, Oct 12, item 11: Done is
 *                          finished work waiting to be authorized and invoiced; it is "waiting",
 *                          not overdue), never a ticket with no technician (item 6: that is
 *                          Unassigned on Work Overview, not overdue), and not one whose follow-up
 *                          is on hold (snoozed_until on a later day: Work Overview files it under
 *                          Waiting). One rule for the tiles, the red Overdue tag, the Tickets
 *                          list's Overdue filter, the Owner view's Past due and Work Overview's
 *                          Overdue group.
 *   Open opportunities     live, status not closing (not won / lost / no response)
 *   Overdue opportunities  open opportunities whose expected_close is before today
 *   Overdue bids           DRAFT bids whose due_date is before today (owner, Oct 12): the Bids
 *                          page's red "Overdue N days" and Work Overview's Overdue group; a
 *                          submitted / won / lost bid is never overdue
 *
 * "Today" is the viewer's calendar day, sent by the browser (lib/my-work.ts localYmd, the day My
 * Work uses), as YYYY-MM-DD; without one, the office's day (America/New_York, lib/tasks.ts
 * localYmd). Audit, Oct 2: the counts, the Owner view and the Opportunities list used the
 * Eastern day while Work Overview used the browser's, so at 23:30 in Chicago they disagreed.
 */
import { asBidStatus } from "@/lib/bid-status";
import { isHeldOn } from "@/lib/my-work";
import { localYmd as easternYmd } from "@/lib/tasks";

/**
 * The day to count against: the viewer's (`sent`, YYYY-MM-DD) when it is a real date within a
 * day of the office's — every US zone is — else the office's day (America/New_York).
 */
export function viewerToday(sent: string | null | undefined, now: Date = new Date()): string {
  const eastern = easternYmd(now);
  if (!sent || !YMD.test(sent)) return eastern;
  const t = Date.parse(`${sent}T00:00:00Z`);
  const e = Date.parse(`${eastern}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== sent) return eastern;
  return Math.abs(t - e) <= 86400000 ? sent : eastern;
}

/** The server functions' input: the viewer's day, optional (viewerToday). */
export const parseTodayInput = (d: unknown): { today?: string } => {
  const v = (d as { today?: unknown } | null | undefined)?.today;
  return typeof v === "string" && YMD.test(v) ? { today: v } : {};
};

/**
 * Ticket stages still in progress — everything not yet invoiced or closed (owner, Oct 12, item 6).
 * Work Overview shows the same set across its groups: Open / Scheduled as work (my-work.ts
 * WORK_TICKET_STAGES), Done under Needs authorization and Authorized under To invoice. The same
 * four stages keep a customer from being deleted (crm-account.ts OPEN_TICKET_STAGES).
 */
export const OPEN_TICKET_STAGES = ["open", "scheduled", "done", "authorized"] as const;
/**
 * The stages a ticket can be overdue at (owner, Oct 12): its day has passed and the work has
 * not been done. Done, Authorized, Invoiced and Closed are never overdue.
 */
export const OVERDUE_TICKET_STAGES = ["open", "scheduled"] as const;
/** Opportunity statuses that are not closing (OPP_CLOSING: won / lost / no_response). */
export const OPEN_OPP_STATUSES = ["open", "contacted", "quoted"] as const;

export const isOpenTicketStage = (stage: string): boolean =>
  (OPEN_TICKET_STAGES as readonly string[]).includes(stage);
export const isOverdueTicketStage = (stage: string): boolean =>
  (OVERDUE_TICKET_STAGES as readonly string[]).includes(stage);
export const isOpenOppStatus = (status: string): boolean =>
  (OPEN_OPP_STATUSES as readonly string[]).includes(status);

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A date (YYYY-MM-DD) strictly before today is overdue; today itself, or no date, is not. */
export function isOverdue(dateYmd: string | null | undefined, todayYmd: string): boolean {
  return !!dateYmd && YMD.test(dateYmd) && dateYmd < todayYmd;
}

/**
 * An Open / Scheduled ticket whose day has passed (the Overdue tickets tile, the red tag, the
 * list's Overdue filter, the Owner view's Past due). A Done ticket is never overdue (Oct 12).
 * A ticket with no technician (`technician_id` null) is never overdue either (owner, Oct 12,
 * item 6): Work Overview files it under Unassigned, where it carries its own flag — the fix is a
 * person, not a date. A caller that does not know the technician leaves the field out and the
 * date alone decides.
 */
export const isOverdueTicket = (
  j: { stage: string; scheduled_date: string | null; technician_id?: string | null },
  todayYmd: string,
): boolean =>
  j.technician_id !== null &&
  isOverdueTicketStage(j.stage) &&
  isOverdue(j.scheduled_date, todayYmd);

/** What `heldTicketIds` reads of an open follow-up row. */
export interface HeldFollowupIn {
  kind: string;
  item_id: string;
  status: string;
  snoozed_until: string | null;
}

/**
 * The tickets whose follow-up is on hold on `today` (owner, Oct 12, item 6): an open ticket
 * follow-up whose snoozed_until falls on a later day — my-work.ts isHeldOn, the rule that files
 * the item under Waiting on Work Overview. Such a ticket is not counted overdue by the Overdue
 * tickets tile or the Owner view's Past due while it waits. The day of the hold is the office's
 * (America/New_York) unless the caller says otherwise, as the Owner view reads it.
 */
export function heldTicketIds(
  followups: readonly HeldFollowupIn[],
  todayYmd: string,
  toYmd: (iso: string) => string = (iso) => easternYmd(new Date(iso)),
): Set<string> {
  const out = new Set<string>();
  for (const f of followups)
    if (f.kind === "ticket" && isHeldOn(f, todayYmd, toYmd)) out.add(f.item_id);
  return out;
}

/**
 * The Overdue tickets tile's rule, whole (owner, Oct 12, item 6): `isOverdueTicket` (Open /
 * Scheduled, past its day, with a technician) and the ticket's follow-up not on hold. The same
 * for the Owner view's Past due.
 */
export const countsAsOverdueTicket = (
  j: { id: string; stage: string; scheduled_date: string | null; technician_id?: string | null },
  todayYmd: string,
  held: ReadonlySet<string>,
): boolean => isOverdueTicket(j, todayYmd) && !held.has(j.id);

/**
 * The opportunities whose follow-up is on hold on `today` (the twin of heldTicketIds; owner,
 * Oct 13: "I put Corbin middle on snooze with a date … it still says overdue"): an open
 * opportunity follow-up whose snoozed_until falls on a later day.
 */
export function heldOppIds(
  followups: readonly HeldFollowupIn[],
  todayYmd: string,
  toYmd: (iso: string) => string = (iso) => easternYmd(new Date(iso)),
): Set<string> {
  const out = new Set<string>();
  for (const f of followups)
    if (f.kind === "opportunity" && isHeldOn(f, todayYmd, toYmd)) out.add(f.item_id);
  return out;
}

/**
 * Is the opportunity on hold on `today`? Its row carries `hold_until`, the open follow-up's
 * snoozed_until (opportunities.functions.ts withNames); a hold on a later day means "come back
 * then", so the row is not overdue, wherever it is shown, until that day.
 */
export const isOppHeld = (
  o: { hold_until?: string | null },
  todayYmd: string,
  toYmd: (iso: string) => string = (iso) => easternYmd(new Date(iso)),
): boolean => isHeldOn({ status: "open", snoozed_until: o.hold_until ?? null }, todayYmd, toYmd);

/**
 * An open opportunity past its expected close (the tile and the list's Overdue filter) — unless
 * its follow-up is on hold (`held`): a snooze means "not overdue until that day" everywhere the
 * red tag is shown, as Work Overview already files it under Waiting (owner, Oct 13).
 */
export const isOverdueOpp = (
  o: { status: string; expected_close: string | null },
  todayYmd: string,
  held = false,
): boolean => !held && isOpenOppStatus(o.status) && isOverdue(o.expected_close, todayYmd);

export interface WorkCounts {
  openTickets: number;
  overdueTickets: number;
  openOpps: number;
  overdueOpps: number;
}

export type TileKind = keyof WorkCounts;

/** The Service list's "Open work" chip (OPEN_TICKET_STAGES) as a URL value: ?stage=openwork. */
export const SERVICE_OPEN_WORK = "openwork";
/** The Opportunities list's "All open" chip (every non-closing status): ?status=allopen. */
export const OPP_ALL_OPEN = "allopen";

export type TileHref =
  | { to: "/service"; search: { stage: typeof SERVICE_OPEN_WORK; overdue?: 1 } }
  | { to: "/opportunities"; search: { status: typeof OPP_ALL_OPEN; overdue?: 1 } };

/** Where a tile links: the list with the matching filter preset. */
export function tileHref(kind: TileKind): TileHref {
  switch (kind) {
    case "openTickets":
      return { to: "/service", search: { stage: SERVICE_OPEN_WORK } };
    case "overdueTickets":
      return { to: "/service", search: { stage: SERVICE_OPEN_WORK, overdue: 1 } };
    case "openOpps":
      return { to: "/opportunities", search: { status: OPP_ALL_OPEN } };
    case "overdueOpps":
      return { to: "/opportunities", search: { status: OPP_ALL_OPEN, overdue: 1 } };
  }
}

/** The strip's four tiles, in order. Overdue tiles are tinted red when above zero. */
export const WORK_TILES: readonly { kind: TileKind; label: string; overdue: boolean }[] = [
  // "Tickets in progress", not "Open tickets" (owner, Oct 12, item 6): the count takes in Done
  // and Authorized tickets too — everything not yet invoiced or closed.
  { kind: "openTickets", label: "Tickets in progress", overdue: false },
  { kind: "overdueTickets", label: "Overdue tickets", overdue: true },
  { kind: "openOpps", label: "Open opportunities", overdue: false },
  { kind: "overdueOpps", label: "Overdue opportunities", overdue: true },
];

/** Whole days from one YYYY-MM-DD to a later one (calendar arithmetic, no time zone). */
function daysBetween(fromYmd: string, toYmd: string): number {
  const ms = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((ms(toYmd) - ms(fromYmd)) / 86400000);
}

/**
 * The red "Overdue" tag on a ticket (owner, Oct 2): how many days past its day an Open / Scheduled
 * ticket is, or null when it is not overdue — exactly the rule of the Overdue filter and tile
 * (isOverdueTicket; a Done ticket shows no tag, nor does a ticket with no technician — the list
 * shows its Unassigned flag instead; owner, Oct 12, item 6). The days are the ticket's own.
 */
export function ticketOverdueDays(
  j: { stage: string; scheduled_date: string | null; technician_id?: string | null },
  todayYmd: string,
): number | null {
  return isOverdueTicket(j, todayYmd) ? daysBetween(j.scheduled_date!, todayYmd) : null;
}

/** The same for an opportunity: days past its expected close while it is still open. */
export function oppOverdueDays(
  o: { status: string; expected_close: string | null },
  todayYmd: string,
  held = false,
): number | null {
  return isOverdueOpp(o, todayYmd, held) ? daysBetween(o.expected_close!, todayYmd) : null;
}

/**
 * A draft bid past its due date (owner, Oct 12). Only a draft: a submitted bid is with the
 * customer, a won / lost one is finished — none of them is late, whatever the day says.
 */
export const isOverdueBid = (
  b: { status: string | null; due_date: string | null | undefined },
  todayYmd: string,
): boolean => asBidStatus(b.status) === "draft" && isOverdue(b.due_date, todayYmd);

/** Days a draft bid is past its due date (the Bids page's red tag), or null when it is not. */
export function bidOverdueDays(
  b: { status: string | null; due_date: string | null | undefined },
  todayYmd: string,
): number | null {
  return isOverdueBid(b, todayYmd) ? daysBetween(b.due_date!, todayYmd) : null;
}
