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
 * Value in dollars (reports 1 and 3, and only when ticked): the unit cost is the service
 * material's cost (service_materials.cost, per piece as CenterPoint lists it), turned into the
 * STOCK PACK's cost with service-materials.ts packCostFor — a box of 1,000 fasteners at $0.091
 * is $91 a box — because every quantity here is in the stock unit, packs. Where no cost is known
 * the money columns are blank, never 0. There is no reorder report (owner: "no on reorders").
 *
 * Pure: the server function (inventory-export.functions.ts) feeds these builders rows and turns
 * the result into a file with review-export.ts toCsv; the dialog (inventory-export-dialog.tsx)
 * only picks the report and the range. No internal id goes into a CSV: a ticket is its stored
 * name (service_job_name), a location its name, an item its label.
 */
import { easternYmd, FIELD_DAY_TZ } from "@/lib/field-day";
import { easternMidnight } from "@/lib/inventory-reconcile";
import { movementLabel } from "@/lib/inventory.functions";
import { packCostFor, type Cell } from "@/lib/service-materials";
import { variantOf, type PieceDef } from "@/lib/stock-units";

export type ExportReport = "stock" | "movements" | "usage";
export const EXPORT_REPORTS: readonly ExportReport[] = ["stock", "movements", "usage"];

/** What the dialog shows for each report: its name and, in plain words, what the file holds. */
export const EXPORT_REPORT_INFO: Record<
  ExportReport,
  { title: string; blurb: string; dated: boolean }
> = {
  stock: {
    title: "Stock on hand",
    blurb:
      "What inventory has right now: one row per item at each place (the shop and every vehicle), including items at zero and below zero.",
    dated: false,
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
export const fmtMoney = (n: number | null): string => (n == null ? "" : n.toFixed(2));

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
 * The per-piece cost of a cell (service_materials.cost through the cell → material link), or
 * null when no material prices it. Only given when "Include value in dollars" is ticked.
 */
export type CostLookup = (cell: Cell) => number | null;

/** Unit cost of one STOCK PACK of a cell, or null when unknown. */
export function packCostOf(
  costFor: CostLookup | null | undefined,
  cell: Cell,
  piece: PieceDef | null,
): number | null {
  const cost = costFor?.(cell);
  return cost == null ? null : packCostFor(cost, piece);
}

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
  costFor?: CostLookup | null;
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
  if (input.withValue) header.push("Unit cost", "Value");
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
        const unitCost = packCostOf(input.costFor, r, r.piece);
        out.push(fmtMoney(unitCost), fmtMoney(unitCost == null ? null : unitCost * r.on_hand));
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
  const rows = input.movements
    .filter((m) => inWindow(m.created_at, input))
    .sort(byTime)
    .map((m) => {
      const { item, colour } = itemColumns(m);
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
  /** The cell's pack definition (for the pack cost); null when counted whole. */
  pieceFor: (cell: Cell) => PieceDef | null;
  costFor?: CostLookup | null;
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
  if (input.withValue) header.push("Unit cost", "Cost");
  // Net per ticket + cell: a take is negative in the ledger, a put-back positive; what the ticket
  // really used is minus the sum.
  const cells = new Map<string, { first: ExportMovement; used: number }>();
  for (const m of input.movements) {
    if (!m.service_job_id || !inWindow(m.created_at, input)) continue;
    if (m.reason !== "consumed" && m.reason !== "released") continue;
    const k = `${m.service_job_id}\u0000${m.screen_id}\u0000${m.row_label}\u0000${m.price_col}`;
    const cur = cells.get(k);
    if (cur) cur.used -= Number(m.qty);
    else cells.set(k, { first: m, used: -Number(m.qty) });
  }
  const rows = [...cells.values()]
    .map(({ first, used }) => ({ first, used: round3(used), ...itemColumns(first) }))
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
    .map(({ first, used, item, colour, job, ticket }) => {
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
      if (input.withValue) {
        const unitCost = packCostOf(input.costFor, first, input.pieceFor(first));
        out.push(fmtMoney(unitCost), fmtMoney(unitCost == null ? null : unitCost * used));
      }
      return out;
    });
  return [header, ...rows];
}

/**
 * "inventory-stock-2026-10-15.csv" (today, office time) for the stock report;
 * "inventory-movements-2026-10-01-to-2026-10-31.csv" / "inventory-usage-…" for a dated one.
 */
export function exportFileName(
  report: ExportReport,
  from?: string | null,
  to?: string | null,
  now: Date = new Date(),
): string {
  if (report === "stock") return `inventory-stock-${easternYmd(now)}.csv`;
  return `inventory-${report}-${from ?? ""}-to-${to ?? ""}.csv`;
}

/** The dialog's rule: a dated report needs a real From..To; the stock report needs nothing. */
export function exportRangeValid(report: ExportReport, from: string, to: string): boolean {
  if (!EXPORT_REPORT_INFO[report].dated) return true;
  return isYmd(from) && isYmd(to) && from <= to;
}
