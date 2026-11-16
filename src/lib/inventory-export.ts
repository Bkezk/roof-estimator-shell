/**
 * Inventory › Export (owner, Oct 15): three CSV reports for admins and managers, from one Export
 * button on the Inventory page. The owner's decisions, in his words: "include the value in dollars
 * for managers and admins only, same for export. no on reorders, do the from and too picker, zero
 * rows included yes." So:
 *
 *  1. "Stock on hand" — one row per item per location, every location, zero rows included
 *     (anything that has ever had a ledger entry), negatives included; no date range.
 *  2. "Movements" — one row per ledger entry whose created_at falls in From..To, inclusive, in the
 *     office's time zone (field-day.ts FIELD_DAY_TZ; the window is built from
 *     inventory-reconcile.ts easternMidnight, so it is DST-safe), oldest first. "What happened" is
 *     movementLabel's words, the same as the History tab.
 *  3. "Usage by ticket" — material used on tickets in From..To: `consumed` entries with a ticket,
 *     NET per ticket + item (a `released` put-back on the same ticket and item cancels a take);
 *     rows that net to zero are dropped.
 *
 * Value in dollars (only when ticked). Since Nov 16 (owner: "How does it handle a situation where
 * there's stock bought for x amount of dollars then the same material bought later for more/less
 * money?") every dollar here comes from the cost rules (inventory-cost.ts), not from today's
 * Setup price: stock is valued at the item's AVERAGE cost on the day asked for, a movement at
 * the cost it was entered or taken at, and a ticket's usage at the average on the day it took
 * the material. Until then the unit cost was the service material's Setup cost times the pack,
 * so a price changed in March changed December's value with it. A "Cost note" column says when
 * a number is an estimate (an entry came in with no price typed) or no cost is known; where no
 * cost is known the money columns are blank, never 0. There is no reorder report (owner: "no on
 * reorders").
 *
 *  1. "Stock on hand" takes an "as of" day (today when none is given): what inventory held at
 *     the end of that day, so December 31 can be run again in January.
 *  4. "Year summary" (Nov 16) — inventory-year-end.ts buildYearRows: opening, received, put in
 *     from jobs, used, damaged, count corrections and closing per item for From..To.
 *
 * Pure: the server function (inventory-export.functions.ts) feeds these builders rows and turns
 * the result into a file with review-export.ts toCsv; the dialog (inventory-export-dialog.tsx)
 * only picks the report and the range. No internal id goes into a CSV: a ticket is its stored
 * name (service_job_name), a location its name, an item its label.
 */
import { easternYmd, FIELD_DAY_TZ } from "@/lib/field-day";
import { easternMidnight } from "@/lib/inventory-reconcile";
import { movementLabel } from "@/lib/inventory.functions";
import { cents, type EntryCost } from "@/lib/inventory-cost";
import type { Cell } from "@/lib/service-materials";
import { variantOf, type PieceDef } from "@/lib/stock-units";

export type ExportReport = "stock" | "movements" | "usage" | "year";
export const EXPORT_REPORTS: readonly ExportReport[] = ["stock", "movements", "usage", "year"];

/** What the dialog shows for each report: its name and, in plain words, what the file holds. */
export const EXPORT_REPORT_INFO: Record<
  ExportReport,
  { title: string; blurb: string; dated: boolean; asOf?: boolean; alwaysValue?: boolean }
> = {
  stock: {
    title: "Stock on hand",
    blurb:
      "What inventory held at the end of a day: one row per item at each place (the shop and every vehicle), including items at zero and below zero. Value is at the average cost on that day.",
    dated: false,
    asOf: true,
  },
  movements: {
    title: "Movements",
    blurb:
      "Every inventory entry in the date range, oldest first: what was taken or put back, where, on which ticket or bid, and by whom.",
    dated: true,
  },
  usage: {
    title: "Usage by ticket",
    blurb:
      "Material used on tickets in the date range, one row per ticket and item, with what was put back taken off.",
    dated: true,
  },
  year: {
    title: "Year summary",
    blurb:
      "For each item: opening stock, received, put in from jobs, used, damaged, count corrections and closing, in units and in dollars. The file to hand your accountant at year end.",
    dated: true,
    alwaysValue: true,
  },
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY = 86400000;
export const isYmd = (s: string | null | undefined): s is string => !!s && YMD.test(s);

/** The day after a YYYY-MM-DD. */
const nextDay = (ymd: string): string =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/**
 * From..To as instants, inclusive of both days in the office's time zone: From 00:00 Eastern up
 * to (not including) the midnight after To. Refused when either is not a day or From is after To.
 */
export function exportWindow(from: string, to: string): { since: string; until: string } {
  if (!isYmd(from) || !isYmd(to)) throw new Error("Pick a from and to date");
  if (from > to) throw new Error("From must be on or before To");
  return {
    since: easternMidnight(from).toISOString(),
    until: easternMidnight(nextDay(to)).toISOString(),
  };
}

/** Is the instant inside the window (since inclusive, until exclusive)? */
export const inWindow = (iso: string, w: { since: string; until: string }): boolean =>
  iso >= w.since && iso < w.until;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** A quantity as the ledger stores it: three decimals at most, no trailing zeros, "-2.5". */
export const fmtExportQty = (n: number): string => String(round3(n));
/** Money to the cent; blank when unknown. */
export const fmtMoney = (n: number | null): string => (n == null ? "" : cents(n).toFixed(2));

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: FIELD_DAY_TZ,
  hour: "numeric",
  minute: "2-digit",
});
/** "3:14 PM" in the office's time zone (a plain space before AM/PM, whatever ICU emits). */
export const fmtExportTime = (iso: string): string =>
  timeFmt.format(new Date(iso)).replace(/\u202f/g, " ");
/** "2026-10-15 3:14 PM" in the office's time zone; blank for nothing. */
export const fmtExportWhen = (iso: string | null): string =>
  iso ? `${easternYmd(new Date(iso))} ${fmtExportTime(iso)}` : "";

/** A cell as named on the page: Item = the service material's name, else the row; Colour = the price column unless it is only a price. */
export function itemColumns(m: { label?: string | null; row_label: string; price_col: string }): {
  item: string;
  colour: string;
} {
  return { item: m.label ?? m.row_label, colour: variantOf(m.price_col) ?? "" };
}

export interface ExportLocation {
  id: string;
  name: string;
  sort: number;
}

/** A stock row as listStock / readStock returns it (inventory.functions.ts StockRow qualifies). */
export interface ExportStockRow extends Cell {
  location_id: string;
  category: string;
  unit: string;
  on_hand: number;
  last_at: string | null;
  item_nos: string[];
  piece: PieceDef | null;
  label: string | null;
}

/**
 * An item's average cost per stock unit on the day asked for (inventory-cost.ts ItemCost), or
 * nothing when the item has no cost history. Only given when "Include value in dollars" is ticked.
 */
export type AvgLookup = (cell: Cell) => { avg: number | null; estimated: boolean } | undefined;

/** A unit cost in a file: four decimals at most, to the cent at least ("98.75", "0.0915"). */
export const fmtUnitCost = (n: number | null): string =>
  n == null ? "" : (Math.round((n + 1e-12) * 10000) / 10000).toFixed(4).replace(/0{1,2}$/, "");

/** The "Cost note" of a number: blank when it rests on prices that were typed. */
export const costNoteOf = (c: { known: boolean; estimated: boolean }): string =>
  !c.known ? "No cost known" : c.estimated ? "Estimate: an entry has no price" : "";

/** Where an entry's cost came from, in the History tab's kind of words. */
export const COST_FROM: Record<EntryCost["source"], string> = {
  paid: "Price paid",
  putback: "The cost it was taken at",
  average: "Average cost",
  setup: "Setup cost (no price typed)",
  none: "No cost known",
};

const byLocation = (locations: readonly ExportLocation[]) => {
  const order = new Map(locations.map((l) => [l.id, l.sort]));
  const name = new Map(locations.map((l) => [l.id, l.name]));
  return {
    nameOf: (id: string) => name.get(id) ?? (id === "shop" ? "Shop" : id),
    rank: (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER,
  };
};
const cmp = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** Report 1, "Stock on hand": header + one row per item per location, in location sort order. */
export function buildStockRows(input: {
  stock: readonly ExportStockRow[];
  locations: readonly ExportLocation[];
  avgFor?: AvgLookup | null;
  withValue: boolean;
}): string[][] {
  const { nameOf, rank } = byLocation(input.locations);
  const header = [
    "Location",
    "Category",
    "Item",
    "Colour",
    "Unit",
    "On hand",
    "Pieces per pack",
    "Last movement",
    "Item numbers",
  ];
  if (input.withValue) header.push("Average cost", "Value", "Cost note");
  const rows = [...input.stock]
    .map((r) => ({ r, ...itemColumns(r), location: nameOf(r.location_id) }))
    .sort(
      (a, b) =>
        rank(a.r.location_id) - rank(b.r.location_id) ||
        cmp(a.location, b.location) ||
        cmp(a.r.category, b.r.category) ||
        cmp(a.item, b.item) ||
        cmp(a.colour, b.colour),
    )
    .map(({ r, item, colour, location }) => {
      const out = [
        location,
        r.category,
        item,
        colour,
        r.unit,
        fmtExportQty(r.on_hand),
        r.piece && r.piece.perPack > 0 ? fmtExportQty(r.piece.perPack) : "",
        fmtExportWhen(r.last_at),
        r.item_nos.join(" "),
      ];
      if (input.withValue) {
        const cost = input.avgFor?.(r);
        const avg = cost?.avg ?? null;
        out.push(
          fmtUnitCost(avg),
          fmtMoney(avg == null ? null : avg * r.on_hand),
          costNoteOf({ known: avg != null, estimated: cost?.estimated ?? false }),
        );
      }
      return out;
    });
  return [header, ...rows];
}

/** A ledger entry as readAllMovements returns it, with its category (inventory.functions.ts categories). */
export interface ExportMovement extends Cell {
  id: number;
  location_id: string;
  category: string;
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
  label?: string | null;
}

const byTime = (a: ExportMovement, b: ExportMovement) =>
  a.created_at.localeCompare(b.created_at) || a.id - b.id;

/** "Ticket or bid": the ticket's stored name, else the bid's; blank for neither. */
export const ticketOrBid = (m: {
  service_job_name: string | null;
  bid_name?: string | null;
}): string => m.service_job_name ?? m.bid_name ?? "";

/** Report 2, "Movements": header + one row per entry in the window, oldest first. */
export function buildMovementRows(input: {
  movements: readonly ExportMovement[];
  locations: readonly ExportLocation[];
  since: string;
  until: string;
  /** Each entry's cost (inventory-cost.ts replayLedger), when value in dollars is ticked. */
  costs?: ReadonlyMap<number, EntryCost> | null;
}): string[][] {
  const { nameOf } = byLocation(input.locations);
  const header = [
    "Date",
    "Time",
    "Location",
    "Category",
    "Item",
    "Colour",
    "Change",
    "Unit",
    "What happened",
    "Ticket or bid",
    "Who",
    "Note",
  ];
  if (input.costs) header.push("Unit cost", "Amount", "Cost from");
  const rows = input.movements
    .filter((m) => inWindow(m.created_at, input))
    .sort(byTime)
    .map((m) => {
      const { item, colour } = itemColumns(m);
      const cost = input.costs?.get(m.id);
      const money = input.costs
        ? [
            fmtUnitCost(cost?.unit_cost ?? null),
            fmtMoney(cost?.amount ?? null),
            cost ? COST_FROM[cost.source] + (cost.needsPrice ? " — needs a price" : "") : "",
          ]
        : [];
      return [
        easternYmd(new Date(m.created_at)),
        fmtExportTime(m.created_at),
        nameOf(m.location_id),
        m.category,
        item,
        colour,
        fmtExportQty(Number(m.qty)),
        m.unit,
        movementLabel(m),
        ticketOrBid(m),
        m.created_by_name ?? "",
        m.note ?? "",
        ...money,
      ];
    });
  return [header, ...rows];
}

/** What the usage report says about a ticket (service_jobs joined to its customer and site). */
export interface ExportJob {
  id: string;
  number: number | null;
  customer: string;
  site: string;
  /** scheduled_date, else the day it was created (office time). */
  day: string;
}

/** Report 3, "Usage by ticket": header + one row per ticket + item that nets to something. */
export function buildUsageRows(input: {
  movements: readonly ExportMovement[];
  since: string;
  until: string;
  jobs: ReadonlyMap<string, ExportJob>;
  /**
   * Each entry's cost (inventory-cost.ts replayLedger): a take at the average on the day it was
   * taken, a put-back at what the ticket's takes cost.
   */
  costs?: ReadonlyMap<number, EntryCost> | null;
  withValue: boolean;
}): string[][] {
  const header = [
    "Ticket",
    "Customer",
    "Site",
    "Ticket date",
    "Item",
    "Colour",
    "Quantity",
    "Unit",
  ];
  if (input.withValue) header.push("Unit cost", "Cost", "Cost note");
  // Net per ticket + cell: a take is negative in the ledger, a put-back positive; what the ticket
  // really used is minus the sum, in units and in dollars alike.
  const cells = new Map<
    string,
    { first: ExportMovement; used: number; cost: number | null; estimated: boolean }
  >();
  for (const m of input.movements) {
    if (!m.service_job_id || !inWindow(m.created_at, input)) continue;
    if (m.reason !== "consumed" && m.reason !== "released") continue;
    const k = `${m.service_job_id}\u0000${m.screen_id}\u0000${m.row_label}\u0000${m.price_col}`;
    const entry = input.costs?.get(m.id);
    const amount = entry?.amount ?? null;
    const cur = cells.get(k);
    if (cur) {
      cur.used -= Number(m.qty);
      cur.cost = cur.cost == null || amount == null ? null : cur.cost - amount;
      cur.estimated = cur.estimated || (entry?.estimated ?? false);
    } else
      cells.set(k, {
        first: m,
        used: -Number(m.qty),
        cost: amount == null ? null : -amount,
        estimated: entry?.estimated ?? false,
      });
  }
  const rows = [...cells.values()]
    .map((c) => ({ ...c, used: round3(c.used), ...itemColumns(c.first) }))
    .filter((c) => c.used !== 0)
    .map((c) => {
      const job = input.jobs.get(c.first.service_job_id!);
      const ticket =
        c.first.service_job_name ?? (job?.number != null ? `#${job.number}` : "(ticket)");
      return { ...c, job, ticket };
    })
    .sort(
      (a, b) =>
        cmp(a.ticket, b.ticket) ||
        cmp(a.first.service_job_id!, b.first.service_job_id!) ||
        cmp(a.item, b.item) ||
        cmp(a.colour, b.colour),
    )
    .map(({ first, used, cost, estimated, item, colour, job, ticket }) => {
      const out = [
        ticket,
        job?.customer ?? "",
        job?.site ?? "",
        job?.day ?? "",
        item,
        colour,
        fmtExportQty(used),
        first.unit,
      ];
      if (input.withValue)
        out.push(
          fmtUnitCost(cost == null ? null : cost / used),
          fmtMoney(cost),
          costNoteOf({ known: cost != null, estimated }),
        );
      return out;
    });
  return [header, ...rows];
}

/**
 * "inventory-stock-2026-10-15.csv" for the stock report (the day it is as of: today, office
 * time, when none is given); "inventory-movements-2026-10-01-to-2026-10-31.csv" /
 * "inventory-usage-…" / "inventory-year-…" for a dated one.
 */
export function exportFileName(
  report: ExportReport,
  from?: string | null,
  to?: string | null,
  now: Date = new Date(),
  asOf?: string | null,
): string {
  if (report === "stock") return `inventory-stock-${asOf ?? easternYmd(now)}.csv`;
  return `inventory-${report}-${from ?? ""}-to-${to ?? ""}.csv`;
}

/**
 * The dialog's rule: a dated report needs a real From..To; the stock report needs a real day
 * that is not in the future (nothing given = today).
 */
export function exportRangeValid(
  report: ExportReport,
  from: string,
  to: string,
  asOf?: string | null,
  now: Date = new Date(),
): boolean {
  if (!EXPORT_REPORT_INFO[report].dated) return !asOf || (isYmd(asOf) && asOf <= easternYmd(now));
  return isYmd(from) && isYmd(to) && from <= to;
}
