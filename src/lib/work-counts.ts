/**
 * Work counts (owner, Oct 1): "something above the current customer page that shows total open
 * service tickets and overdue ones, same with opportunities, and you can click each number to
 * take you to a list of those things." Pure rules only (no I/O): the server function in
 * work-counts.functions.ts counts the rows, components/work-counts-strip.tsx shows the tiles, and
 * the Service / Opportunities lists use the same predicates when a tile's link presets them, so a
 * tile's number and the list it opens agree.
 *
 *   Open tickets           live, stage open / scheduled / done (not invoiced / closed)
 *   Overdue tickets        open tickets whose scheduled_date is before today
 *   Open opportunities     live, status not closing (not won / lost / no response)
 *   Overdue opportunities  open opportunities whose expected_close is before today
 *
 * "Today" is the office's calendar day (America/New_York, lib/tasks.ts localYmd), as YYYY-MM-DD.
 */

/** Ticket stages that are still work (the same three as My Work and the Tech Board load). */
export const OPEN_TICKET_STAGES = ["open", "scheduled", "done"] as const;
/** Opportunity statuses that are not closing (OPP_CLOSING: won / lost / no_response). */
export const OPEN_OPP_STATUSES = ["open", "contacted", "quoted"] as const;

export const isOpenTicketStage = (stage: string): boolean =>
  (OPEN_TICKET_STAGES as readonly string[]).includes(stage);
export const isOpenOppStatus = (status: string): boolean =>
  (OPEN_OPP_STATUSES as readonly string[]).includes(status);

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A date (YYYY-MM-DD) strictly before today is overdue; today itself, or no date, is not. */
export function isOverdue(dateYmd: string | null | undefined, todayYmd: string): boolean {
  return !!dateYmd && YMD.test(dateYmd) && dateYmd < todayYmd;
}

/** An open ticket whose day has passed (the Overdue tickets tile and the list's Overdue filter). */
export const isOverdueTicket = (
  j: { stage: string; scheduled_date: string | null },
  todayYmd: string,
): boolean => isOpenTicketStage(j.stage) && isOverdue(j.scheduled_date, todayYmd);

/** An open opportunity past its expected close (the tile and the list's Overdue filter). */
export const isOverdueOpp = (
  o: { status: string; expected_close: string | null },
  todayYmd: string,
): boolean => isOpenOppStatus(o.status) && isOverdue(o.expected_close, todayYmd);

export interface WorkCounts {
  openTickets: number;
  overdueTickets: number;
  openOpps: number;
  overdueOpps: number;
}

export type TileKind = keyof WorkCounts;

/** The Service list's "Open work" chip (open + scheduled + done) as a URL value: ?stage=openwork. */
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
  { kind: "openTickets", label: "Open tickets", overdue: false },
  { kind: "overdueTickets", label: "Overdue tickets", overdue: true },
  { kind: "openOpps", label: "Open opportunities", overdue: false },
  { kind: "overdueOpps", label: "Overdue opportunities", overdue: true },
];
