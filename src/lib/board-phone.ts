/**
 * The Tech Board on a phone (owner, Nov 17: "the tech board and service tickets need to be
 * optimized for mobile, it needs to be easy to drag and move tickets onto the tech board and
 * click tickets to see their details").
 *
 * On a desk the board is a week grid of technicians × days. On a phone that grid showed a day and
 * a half, and its drag and drop is the mouse's, so a finger could not move a ticket at all. The
 * owner chose, from two drawings: ONE DAY AT A TIME (seven day buttons across the top, every
 * technician a full-width row for the chosen day, the unassigned tickets in a tray at the
 * bottom), and a DETAILS POP-UP on a tap (the ticket's main details, with Open ticket, Move, Call
 * and Directions) instead of leaving the board for the whole ticket page.
 *
 * This file is the rules, with no screen in it: which screens get the phone board, what a drop on
 * each target does, the day strip's counts and the words. The finger's hold-and-drag is
 * hold-drag.ts; the screen is components/service/board-phone.tsx.
 */
import { boardDay, shiftDays } from "@/lib/service-schedule";

/**
 * Which screens get the phone board: anything narrower than a tablet, and a touch screen up to a
 * tablet held upright (a phone on its side, a small tablet). A desk window keeps the week grid.
 */
export const PHONE_BOARD_QUERY = "(max-width: 767px), (pointer: coarse) and (max-width: 1023px)";

// ---- Drop targets ------------------------------------------------------------------------------
// The key a target carries on the page (data-drop). A technician's day is "<tech id>|<day>", the
// same key the desk grid highlights by.
export const RAIL_KEY = "rail";
export const PREV_WEEK_KEY = "prev-week";
export const NEXT_WEEK_KEY = "next-week";
export const cellKey = (techId: string, ymd: string): string => `${techId}|${ymd}`;
export const dayKey = (ymd: string): string => `day:${ymd}`;

export type DropTarget =
  | { kind: "cell"; techId: string; ymd: string }
  | { kind: "rail" }
  | { kind: "day"; ymd: string }
  | { kind: "week"; weeks: -1 | 1 };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The target a key names, or null for anything else (a finger let go over nothing). */
export function parseDropKey(key: string | null | undefined): DropTarget | null {
  if (!key) return null;
  if (key === RAIL_KEY) return { kind: "rail" };
  if (key === PREV_WEEK_KEY) return { kind: "week", weeks: -1 };
  if (key === NEXT_WEEK_KEY) return { kind: "week", weeks: 1 };
  if (key.startsWith("day:")) {
    const ymd = key.slice(4);
    return YMD.test(ymd) ? { kind: "day", ymd } : null;
  }
  const bar = key.lastIndexOf("|");
  if (bar <= 0) return null;
  const techId = key.slice(0, bar);
  const ymd = key.slice(bar + 1);
  return YMD.test(ymd) ? { kind: "cell", techId, ymd } : null;
}

/** Is this key a day button? A ticket held over one for a moment switches the board to that day. */
export const isDayKey = (key: string | null | undefined): boolean =>
  parseDropKey(key)?.kind === "day";

export interface MoveJob {
  stage: string;
  technician_id: string | null;
  scheduled_date: string | null;
}
export interface MovePlan {
  technician_id: string | null;
  scheduled_date: string | null;
}

/** Only Open and Scheduled tickets move on the board (the server's rule too). */
export const movableOnBoard = (j: Pick<MoveJob, "stage">): boolean =>
  j.stage === "open" || j.stage === "scheduled";

/**
 * What a drop does; null when it does nothing (a ticket that cannot move, or a drop that changes
 * nothing). One write each, the same ones the desk grid makes:
 *   - a technician's day: that technician, that day;
 *   - the Unassigned tray: no technician, the day kept (every ticket has a date);
 *   - a day button: that day, the technician kept (an unassigned ticket only gets the day);
 *   - Prev / Next: the same technician and weekday, a week earlier or later. Only a ticket that
 *     has a technician and a day can move a week.
 */
export function planDrop(job: MoveJob, target: DropTarget | null): MovePlan | null {
  if (!target || !movableOnBoard(job)) return null;
  const tech = job.technician_id ?? null;
  const day = job.scheduled_date ?? null;
  let plan: MovePlan;
  if (target.kind === "cell") plan = { technician_id: target.techId, scheduled_date: target.ymd };
  else if (target.kind === "rail") plan = { technician_id: null, scheduled_date: day };
  else if (target.kind === "day") plan = { technician_id: tech, scheduled_date: target.ymd };
  else {
    if (!tech || !day) return null;
    plan = { technician_id: tech, scheduled_date: shiftDays(day, target.weeks * 7) };
  }
  if (plan.technician_id === tech && plan.scheduled_date === day) return null;
  return plan;
}

// ---- The day strip -----------------------------------------------------------------------------
interface CountJob {
  technician_id: string | null;
  stage: string;
  scheduled_date: string | null;
  completed_at: string | null;
}

/** How many tickets sit on each day of the week (the day a ticket is filed under: boardDay). */
export function dayCounts(jobs: readonly CountJob[], days: readonly string[]): number[] {
  const at = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const j of jobs) {
    if (!j.technician_id) continue;
    const d = boardDay(j);
    const i = d ? at.get(d) : undefined;
    if (i !== undefined) out[i] = (out[i] ?? 0) + 1;
  }
  return out;
}

/**
 * The day the board opens on: the day last looked at when it is in this week (so Back from a
 * ticket returns to it), else today when this is today's week, else Monday.
 */
export function startDayIndex(
  days: readonly string[],
  today: string,
  remembered?: string | null,
): number {
  const r = remembered ? days.indexOf(remembered) : -1;
  if (r >= 0) return r;
  const t = days.indexOf(today);
  return t >= 0 ? t : 0;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
};
/** The day of the month, for a day button: 17. */
export const dayNumber = (ymd: string): number => parts(ymd)[2];
/** "Tuesday, Nov 17", no time zone involved. */
export function dayTitle(ymd: string): string {
  const [y, m, d] = parts(ymd);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1]} ${d}`;
}
/** "Tue, Nov 17" */
export function dayShort(ymd: string): string {
  const [y, m, d] = parts(ymd);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]!.slice(0, 3)}, ${MONTHS[m - 1]} ${d}`;
}

// ---- The technician dock -----------------------------------------------------------------------
// Owner, Nov 19: "assigning service to the tech via the tech board on mobile isnt great think of
// ways to improve it to drag and drop assigning better". On a phone about four technicians fit
// between the day buttons and the tray, so a ticket bound for anyone further down had to be held
// at the edge of the list until the page scrolled to them. Now the technicians come to the
// finger: while a ticket is held, every technician is a small target in a block that sits right
// above the tray, all on the screen at once. A target there is a technician's day like any row
// (the same key, cellKey), so a drop on it is the same single write with the same rules.

/**
 * Which lifted ticket gets the dock: one from the Unassigned tray (no technician, or no day
 * yet). The tray is under the dock, so the dock never opens under the finger. A ticket lifted
 * from a technician's row is somewhere in the list, which is where the dock opens: a finger let
 * go without moving would then land on whoever's name came up under it. That ticket keeps the
 * rows, as before.
 */
export const dockFor = (
  job: Pick<MoveJob, "technician_id" | "scheduled_date"> | null | undefined,
): boolean => !!job && (!job.technician_id || !job.scheduled_date);

/** A dock target's height, and the gap between two. A thumb's 44 pixels and a little more. */
export const DOCK_ROW_PX = 48;
export const DOCK_GAP_PX = 6;
/** The dock's own line of words and padding. */
export const DOCK_HEAD_PX = 44;

/** The room the dock has: from the day buttons down to the tray (never less than nothing). */
export function dockRoom(trayTop: number, listTop: number): number {
  return Math.max(0, Math.round(trayTop - listTop));
}

/**
 * How far the page scrolls when a ticket lifts, to make room for the dock. Until the page is
 * scrolled its own heading sits above the day buttons, and on a short phone that leaves less
 * room than the technicians need. Scrolling brings the day buttons to the top of the screen
 * (where they stay) and frees that room. Only as far as is needed (`need` − `room`), as the day
 * buttons can still rise (`slack`), and as the page can still scroll (`left`).
 */
export function dockScroll(need: number, room: number, slack: number, left: number): number {
  return Math.max(0, Math.round(Math.min(need - room, slack, left)));
}

/** How tall the dock is with `count` technicians in `columns`. */
export function dockHeight(count: number, columns: number): number {
  const rows = Math.ceil(count / Math.max(1, columns));
  return DOCK_HEAD_PX + rows * DOCK_ROW_PX + Math.max(0, rows - 1) * DOCK_GAP_PX;
}

/**
 * Two technicians across, so a name reads whole; three when two would not fit the room (a long
 * crew list, or a short phone). Every technician is on the screen either way.
 */
export function dockColumns(count: number, room: number): 2 | 3 {
  return dockHeight(count, 2) <= room ? 2 : 3;
}

/** The dock's line: "Drop on a technician · Thu, Nov 19". */
export const dockTitle = (ymd: string): string => `Drop on a technician · ${dayShort(ymd)}`;

/**
 * What a dock target says under the name: who has the ticket now (a drop there changes nothing
 * unless the day differs), else how many tickets that technician has that day.
 */
export function dockNote(count: number, hasIt: boolean): string {
  if (hasIt) return "has it now";
  return count === 0 ? "free" : `${count} ${count === 1 ? "ticket" : "tickets"}`;
}

// ---- Words -------------------------------------------------------------------------------------
export const PHONE_BOARD_HINT =
  "Hold a ticket, then drag it onto a technician. Tap a ticket for its details.";
export const PHONE_BOARD_HINT_READ = "Who is where this week. Tap a ticket for its details.";

/** What a move did, said once it is saved: "Ticket #6071: Garry Peters, Tue, Nov 17." */
export function moveSummary(number: number, techName: string | null, plan: MovePlan): string {
  const day = plan.scheduled_date ? dayShort(plan.scheduled_date) : null;
  if (!plan.technician_id)
    return `Ticket #${number} is unassigned${day ? `, still set for ${day}` : ""}.`;
  const who = techName ?? "a technician";
  return day ? `Ticket #${number}: ${who}, ${day}.` : `Ticket #${number}: ${who}, no day yet.`;
}

// ---- The details pop-up ------------------------------------------------------------------------
export interface PeekPlace {
  customer_name: string;
  site_name: string | null;
  site_address: string | null;
  site_city?: string | null;
  site_state?: string | null;
}
const clean = (v: string | null | undefined): string => (v ?? "").trim();

/** The address as lines: the street, then "City, ST" unless the street line already names the city. */
export function peekAddressLines(j: PeekPlace): string[] {
  const street = clean(j.site_address);
  const city = clean(j.site_city);
  const town = [city, clean(j.site_state)].filter(Boolean).join(", ");
  const out: string[] = [];
  if (street) out.push(street);
  if (town && !(city && street.toLowerCase().includes(city.toLowerCase()))) out.push(town);
  return out;
}

/** What Directions searches for: the address, else the property and customer by name; null when neither. */
export function peekMapQuery(j: PeekPlace): string | null {
  const address = peekAddressLines(j).join(", ");
  if (address) return address;
  const names = [clean(j.site_name), clean(j.customer_name)].filter(Boolean).join(", ");
  return names || null;
}
export const mapsUrl = (q: string): string => `https://maps.google.com/?q=${encodeURIComponent(q)}`;

/** The number Call dials: the property contact's, else the customer's. */
export function peekPhone(p: {
  contact_phone: string | null;
  account_phone: string | null;
}): string | null {
  return clean(p.contact_phone) || clean(p.account_phone) || null;
}
