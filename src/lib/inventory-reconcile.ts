/**
 * Inventory › Reconcile (owner, Oct 9: "we probably also need a weekly reconciliation report so
 * we can figure out where negative stock came from" … "a menu for managers/admins on the
 * inventory tab so they can go in and manually reconcile things rather than just an email").
 *
 * Why a count goes below zero: material on a service ticket may be logged although the app shows
 * none of it at the chosen place (inventory.functions.ts addMovement, `short_ok`); the entry's
 * note then starts with "Short: the app had N <unit> on <place>; count needs fixing". Stock on
 * hand per cell per location is the plain sum of inventory_movements.qty, so the ledger itself
 * says where a negative came from: walk one cell's entries at one location in time order and the
 * entry that pushed the running sum below zero — and every taking entry after it — is the list of
 * who took what on which ticket. The negatives are current state (whatever week is picked); the
 * "Short:" entries and the fixes follow the picked Monday–Sunday week. Pure: the server function
 * (inventory-reconcile.functions.ts) feeds it rows and the Inventory page's Reconcile tab renders
 * what it returns. The only way off the list is a corrected count (reconcileAdjustment → the
 * existing addMovement); there is no dismiss.
 */
import { FIELD_DAY_TZ } from "@/lib/field-day";
import { variantOf } from "@/lib/stock-units";

/** The columns of inventory_movements the report reads (a MovementRow qualifies). */
export interface ReconcileMovement {
  id: number;
  location_id: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  qty: number | string;
  unit: string;
  reason: string;
  service_job_id: string | null;
  service_job_name: string | null;
  bid_id?: string | null;
  bid_name?: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
  /** The service material name for the cell when there is one (listStock's `label`). */
  label?: string | null;
}

export interface ReconcileLocation {
  id: string;
  name: string;
}

/** One taking entry on a cell that is below zero: who, which ticket, when, how much. */
export interface Contributor {
  at: string;
  qty: number;
  reason: string;
  by_name: string | null;
  service_job_name: string | null;
  service_job_id: string | null;
  note: string | null;
  /** The entry was logged short (its note says the app had too little). */
  short: boolean;
}

export interface NegativeCell {
  location_id: string;
  location_name: string;
  screen_id: string;
  row_label: string;
  price_col: string;
  /** "Row · colour" (the Inventory page's product label), or the row alone for one price. */
  name: string;
  unit: string;
  on_hand: number;
  /** When the running sum last went from zero or above to below zero. */
  firstBelowZeroAt: string;
  /** Oldest first: the entry that crossed zero, then every later taking entry (up to 10). */
  contributors: Contributor[];
  /** Taking entries after the tenth, not listed ("+N more"). */
  more: number;
}

export interface ShortEntry {
  at: string;
  location_name: string;
  name: string;
  qty: number;
  unit: string;
  by_name: string | null;
  service_job_name: string | null;
  service_job_id: string | null;
  note: string | null;
}

/** A cell that was below zero at some point in the week and is zero or above now. */
export interface FixedCell {
  location_name: string;
  name: string;
  unit: string;
  wentBelowAt: string;
  fixedAt: string;
  on_hand: number;
}

export interface Reconciliation {
  /** The picked week's Monday (YYYY-MM-DD, office time). */
  weekStart: string;
  since: string;
  until: string;
  /** "Oct 5 – Oct 11", the picked week in the office's time zone. */
  weekLabel: string;
  negatives: NegativeCell[];
  shortEntries: ShortEntry[];
  fixed: FixedCell[];
  totals: { negatives: number; short: number; fixed: number; movements: number };
}

/** Taking entries listed per negative cell; the rest is "+N more". */
export const CONTRIBUTOR_CAP = 10;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86400000;
const ymdOf = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: FIELD_DAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
/** Midnight of a calendar day in the office's time zone, as an instant (DST-safe). */
function easternMidnight(ymd: string): Date {
  const m = YMD.exec(ymd);
  if (!m) throw new Error(`Not a day: ${ymd}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Noon UTC is inside the same Eastern day; the offset there is the day's offset at midnight
  // too (New York changes clocks at 2 am, never at midnight).
  const noon = Date.UTC(y, mo - 1, d, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FIELD_DAY_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(noon));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  const offset = local - noon;
  return new Date(Date.UTC(y, mo - 1, d) - offset);
}
/** The Monday (YYYY-MM-DD, office time) of the week a day or instant falls in. */
export function weekStartOf(dayOrNow: string | Date): string {
  const ymd = typeof dayOrNow === "string" ? dayOrNow : ymdOf(dayOrNow);
  const m = YMD.exec(ymd);
  if (!m) throw new Error(`Not a day: ${ymd}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}
/** The Monday `weeks` weeks away (−1 = previous week, +1 = next). */
export function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  return new Date(d.getTime() + weeks * 7 * DAY).toISOString().slice(0, 10);
}
/**
 * The report window for a week: its Monday 00:00 to the next Monday 00:00, office time. Whatever
 * day is passed, the week it falls in is used; nothing passed = the current week.
 */
export function reconcileWindow(
  weekStart?: string | null,
  now: Date = new Date(),
): { weekStart: string; since: string; until: string } {
  const start = weekStartOf(weekStart ?? now);
  return {
    weekStart: start,
    since: easternMidnight(start).toISOString(),
    until: easternMidnight(shiftWeek(start, 1)).toISOString(),
  };
}

/**
 * The note addMovement writes when a ticket's material is logged short. The user's own note, when
 * there is one, comes first and the short note follows " — ", so both spellings count.
 */
export const isShortNote = (note: string | null | undefined): boolean =>
  !!note && (/^Short: /.test(note) || / — Short: /.test(note));

export const SINGLE_PRICE = "price";
/**
 * What a cell is called on the Inventory page, in History and here (owner, Oct 9: the same name
 * as the close-out): the service material's name when there is one, else the catalog row with
 * its colour / size — "Membrane · White" — and the row alone when the column is only a price
 * ("price", "Price/Box"; stock-units.ts variantOf).
 */
export const cellName = (m: {
  label?: string | null;
  row_label: string;
  price_col: string;
}): string => {
  if (m.label) return m.label;
  const variant = variantOf(m.price_col);
  return variant ? `${m.row_label} · ${variant}` : m.row_label;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const byTime = (a: ReconcileMovement, b: ReconcileMovement) =>
  a.created_at.localeCompare(b.created_at) || a.id - b.id;

const monthDay = new Intl.DateTimeFormat("en-US", {
  timeZone: FIELD_DAY_TZ,
  month: "short",
  day: "numeric",
});
const dayTime = new Intl.DateTimeFormat("en-US", {
  timeZone: FIELD_DAY_TZ,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
/** "Oct 5" in the office's time zone. */
export const fmtMonthDay = (iso: string): string => monthDay.format(new Date(iso));
/** "Oct 5, 3:14 PM" in the office's time zone. */
export const fmtWhen = (iso: string): string => dayTime.format(new Date(iso));
/** A signed quantity as the ledger shows it: "−120", "+3.5" (three decimals at most). */
export const fmtQty = (n: number): string => {
  const r = round3(n);
  const abs = String(Math.abs(r));
  return r < 0 ? `−${abs}` : `+${abs}`;
};

export function buildReconciliation(input: {
  movements: readonly ReconcileMovement[];
  locations: readonly ReconcileLocation[];
  since: string;
  until: string;
  weekStart?: string;
}): Reconciliation {
  const { since, until } = input;
  const locName = new Map(input.locations.map((l) => [l.id, l.name]));
  const nameOf = (id: string) => locName.get(id) ?? (id === "shop" ? "Shop" : id);

  // One cell at one location = one ledger to walk.
  const cells = new Map<string, ReconcileMovement[]>();
  for (const m of input.movements) {
    const key = `${m.location_id}\u0000${m.screen_id}\u0000${m.row_label}\u0000${m.price_col}`;
    const list = cells.get(key);
    if (list) list.push(m);
    else cells.set(key, [m]);
  }

  const negatives: NegativeCell[] = [];
  const fixed: FixedCell[] = [];
  for (const list of cells.values()) {
    list.sort(byTime);
    let sum = 0;
    // The start of the CURRENT below-zero stretch: a cell that went negative, was fixed, and
    // went negative again is explained by the later stretch, not the one already corrected.
    let crossedAt: number | null = null;
    // For "Fixed this week": was the cell below zero at any moment inside the window?
    let belowInWeek: string | null = null;
    let fixedAt: string | null = null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!;
      const before = sum;
      sum += Number(m.qty);
      if (before >= -1e-9 && sum < -1e-9) crossedAt = i;
      if (sum >= -1e-9 && crossedAt !== null) {
        fixedAt = m.created_at;
        crossedAt = null;
      }
      if (sum < -1e-9 && !belowInWeek) {
        const inWindow = m.created_at >= since && m.created_at < until;
        // The last entry before the window opened: its sum is the count the week started on.
        const lastBefore =
          m.created_at < since && (i === list.length - 1 || list[i + 1]!.created_at >= since);
        if (inWindow) belowInWeek = m.created_at;
        else if (lastBefore) belowInWeek = since;
      }
    }
    const first = list[0]!;
    const on_hand = round3(sum);
    const base = {
      location_name: nameOf(first.location_id),
      name: cellName(first),
      unit: list[list.length - 1]!.unit,
    };
    if (on_hand < 0 && crossedAt !== null) {
      const takes = list
        .slice(crossedAt)
        .filter((m, i) => i === 0 || Number(m.qty) < 0)
        .map((m): Contributor => ({
          at: m.created_at,
          qty: round3(Number(m.qty)),
          reason: m.reason,
          by_name: m.created_by_name,
          service_job_name: m.service_job_name,
          service_job_id: m.service_job_id,
          note: m.note,
          short: isShortNote(m.note),
        }));
      negatives.push({
        ...base,
        location_id: first.location_id,
        screen_id: first.screen_id,
        row_label: first.row_label,
        price_col: first.price_col,
        on_hand,
        firstBelowZeroAt: list[crossedAt]!.created_at,
        contributors: takes.slice(0, CONTRIBUTOR_CAP),
        more: Math.max(0, takes.length - CONTRIBUTOR_CAP),
      });
    } else if (on_hand >= 0 && belowInWeek && fixedAt && fixedAt >= since && fixedAt < until) {
      fixed.push({ ...base, wentBelowAt: belowInWeek, fixedAt, on_hand });
    }
  }
  negatives.sort(
    (a, b) => a.location_name.localeCompare(b.location_name) || a.name.localeCompare(b.name),
  );
  fixed.sort((a, b) => a.fixedAt.localeCompare(b.fixedAt));

  const shortEntries: ShortEntry[] = [...input.movements]
    .filter((m) => isShortNote(m.note) && m.created_at >= since && m.created_at < until)
    .sort(byTime)
    .map((m) => ({
      at: m.created_at,
      location_name: nameOf(m.location_id),
      name: cellName(m),
      qty: round3(Number(m.qty)),
      unit: m.unit,
      by_name: m.created_by_name,
      service_job_name: m.service_job_name,
      service_job_id: m.service_job_id,
      note: m.note,
    }));

  const inWeek = input.movements.filter((m) => m.created_at >= since && m.created_at < until);
  return {
    weekStart: input.weekStart ?? since.slice(0, 10),
    since,
    until,
    weekLabel: `${fmtMonthDay(since)} – ${fmtMonthDay(new Date(Date.parse(until) - DAY).toISOString())}`,
    negatives,
    shortEntries,
    fixed,
    totals: {
      negatives: negatives.length,
      short: shortEntries.length,
      fixed: fixed.length,
      movements: inWeek.length,
    },
  };
}

export const CLEAN_LINE = "Nothing is below zero and no short entries this week.";

/** The report in one line (tests and callers; the tab shows each block's own empty line). */
export function reconciliationSummary(r: Reconciliation): string {
  if (!r.negatives.length && !r.shortEntries.length) return CLEAN_LINE;
  const parts = [
    `${r.negatives.length} cell${r.negatives.length === 1 ? "" : "s"} below zero`,
    `${r.shortEntries.length} short entr${r.shortEntries.length === 1 ? "y" : "ies"} this week`,
  ];
  if (r.fixed.length) parts.push(`${r.fixed.length} fixed this week`);
  return `${parts.join(", ")}.`;
}

/**
 * Where a count is really taken (owner, Oct 9: "Really on the shelf now" / "Really on the truck
 * now"): the shop is a shelf, every other location is a service vehicle.
 */
export const placeWord = (locationId: string): "shelf" | "truck" =>
  locationId === "shop" ? "shelf" : "truck";

/** The note the Reconcile tab's Save count writes on its adjustment entry. */
export const RECONCILE_NOTE = "Reconciled on Inventory › Reconcile";
/** The note the stock table's per-row Set count writes (owner, Oct 9: counting a shelf down). */
export const COUNT_NOTE = "Counted on Inventory";

/**
 * The Counted box's text as a count: null while nothing usable is typed. The box tracks its TEXT
 * (owner, Oct 9: a NumberField reports 0 for "", so Set count was enabled on a blank box); "0" is
 * a real count — a shelf can be empty.
 */
export function parseCounted(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Set count: ONE `adjustment` entry through the existing addMovement so the cell's on-hand at that
 * location becomes what was counted (adjustments carry their sign and are in the stock unit —
 * packs, not pieces — like every adjustment the server accepts). Null when the typed count is not
 * a change (the server refuses a zero quantity) or not a number. The Reconcile tab and the stock
 * table's per-row Set count (owner, Oct 9) share it; only the note differs.
 */
export function reconcileAdjustment(
  cell: {
    location_id: string;
    screen_id: string;
    row_label: string;
    price_col: string;
    on_hand: number;
  },
  counted: number,
  note: string = RECONCILE_NOTE,
): {
  screen_id: string;
  row_label: string;
  price_col: string;
  location_id: string;
  qty: number;
  reason: "adjustment";
  note: string;
} | null {
  if (!Number.isFinite(counted) || counted < 0) return null;
  const qty = round3(counted - cell.on_hand);
  if (qty === 0) return null;
  return {
    screen_id: cell.screen_id,
    row_label: cell.row_label,
    price_col: cell.price_col,
    location_id: cell.location_id,
    qty,
    reason: "adjustment",
    note,
  };
}
