/**
 * Inventory › Year end and Count, the shapes the screens and the files show (owner, Nov 16: "as
 * far as reporting for EOY stuff, is it as efficient and good as it could be especially with the
 * reconciliation part" … "Go with all 6, also is it exportable?").
 *
 * The cost rules are inventory-cost.ts; this file turns their answers into what a person reads:
 *   - the year summary, by category: opening, received, put in from jobs, opening stock, used on
 *     jobs, damaged, count corrections, other, revalued, closing, each line adding up to closing;
 *   - the list of entries that brought stock in with no price typed, for a manager to price;
 *   - stock as it stood at the end of any day, one row per item per place, valued at the average
 *     cost of that day;
 *   - a saved count: every line with what inventory expected, what was counted and the
 *     difference, in units and in dollars.
 *
 * Pure: the server functions (inventory-cost.functions.ts, inventory-count.functions.ts) read the
 * rows and call these. Days are the office's (field-day.ts FIELD_DAY_TZ): "as of Dec 31" is up
 * to, not including, the midnight after Dec 31 in New York.
 */
import { easternYmd } from "@/lib/field-day";
import {
  cellKeyOf,
  cents,
  FLOW_INFO,
  FLOW_KEYS,
  replayLedger,
  sumDollars,
  yearSummary,
  type Amounts,
  type CostMovement,
  type CostSource,
  type EntryCost,
  type Replay,
  type StoredPrice,
} from "@/lib/inventory-cost";
import { easternMidnight } from "@/lib/inventory-reconcile";
import type { Cell } from "@/lib/service-materials";
import { variantOf } from "@/lib/stock-units";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const nextDay = (ymd: string): string =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/** The instant a day ends in the office's time zone: the midnight after it. */
export function endOfDay(ymd: string): string {
  if (!YMD.test(ymd)) throw new Error("Pick a date");
  return easternMidnight(nextDay(ymd)).toISOString();
}
/** The instant a day starts in the office's time zone. */
export function startOfDay(ymd: string): string {
  if (!YMD.test(ymd)) throw new Error("Pick a date");
  return easternMidnight(ymd).toISOString();
}

/** A ledger entry with the names a report prints (category, service name, ticket, who). */
export interface NamedMovement extends CostMovement {
  category: string;
  label?: string | null;
  service_job_name?: string | null;
  bid_name?: string | null;
  created_by_name?: string | null;
  note?: string | null;
}

export interface CostInput {
  movements: readonly NamedMovement[];
  prices: ReadonlyMap<number, StoredPrice>;
  setupCost?: ((cell: Cell) => number | null) | null | undefined;
}

const itemOf = (m: { label?: string | null; row_label: string; price_col: string }) => ({
  item: m.label ?? m.row_label,
  colour: variantOf(m.price_col) ?? "",
});
const cmp = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

// ── The year summary ───────────────────────────────────────────────────────────────────────────

export type Dollars = Amounts & { revalued: number };

export interface YearEndRow extends Cell {
  key: string;
  category: string;
  item: string;
  colour: string;
  unit: string;
  qty: Amounts;
  /** To the cent. */
  dollars: Dollars;
  avg: number | null;
  estimated: boolean;
  unknown: boolean;
  /** On hand is below zero at the end of the period: the count needs fixing. */
  below_zero: boolean;
}

export interface YearEndGroup {
  category: string;
  rows: YearEndRow[];
  dollars: Dollars;
}

/** An entry that brought stock in with no price typed. */
export interface UnpricedEntry extends Cell {
  id: number;
  at: string;
  item: string;
  colour: string;
  qty: number;
  unit: string;
  location_name: string;
  /** "Put in inventory", "Received", "Opening stock", "Count adjustment". */
  reason: string;
  job_name: string | null;
  service_job_id: string | null;
  by_name: string | null;
  /** What the reports use meanwhile, per unit; null when nothing is known. */
  unit_cost: number | null;
  source: CostSource;
  /** The Setup cost of one stock unit, to offer as the price; null when Setup has none. */
  setup_cost: number | null;
  /** The ticket's purchase orders, to read the price from (a PO holds one total, not lines). */
  pos: { po_number: string; vendor: string; price: number; po_date: string }[];
}

export interface YearEnd {
  from: string;
  to: string;
  groups: YearEndGroup[];
  dollars: Dollars;
  counts: {
    items: number;
    /** Rows whose numbers rest on an entry with no price typed. */
    estimated: number;
    /** Rows that could not be costed at all. */
    unknown: number;
    belowZero: number;
    /** Entries up to the end of the period that still need a price. */
    needsPrice: number;
  };
  unpriced: UnpricedEntry[];
}

const centsAll = (d: Dollars): Dollars => {
  const out = { ...d };
  for (const k of Object.keys(out) as (keyof Dollars)[]) out[k] = cents(out[k]);
  return out;
};

/** What the reports call the reason of an entry that came in. */
const IN_REASON: Record<string, string> = {
  leftover: "Put in from a job",
  received: "Received",
  opening: "Opening stock",
  adjustment: "Found in a count",
  released: "Put back",
};

/** The entries, up to an instant, that brought stock in with no price typed; oldest first. */
export function unpricedEntries(
  input: CostInput & { until: string; locations: readonly { id: string; name: string }[] },
  replay?: Replay,
): UnpricedEntry[] {
  const r = replay ?? replayLedger({ ...input, until: input.until });
  const place = new Map(input.locations.map((l) => [l.id, l.name]));
  const setupOf = (m: Cell): number | null => {
    const c = input.setupCost?.(m);
    return c != null && Number.isFinite(c) && c >= 0 ? c : null;
  };
  return input.movements
    .filter((m) => r.entries.get(m.id)?.needsPrice)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
    .map((m) => {
      const cost = r.entries.get(m.id) as EntryCost;
      return {
        id: m.id,
        at: m.created_at,
        screen_id: m.screen_id,
        row_label: m.row_label,
        price_col: m.price_col,
        ...itemOf(m),
        qty: Number(m.qty),
        unit: m.unit,
        location_name:
          place.get(m.location_id) ?? (m.location_id === "shop" ? "Shop" : m.location_id),
        reason: IN_REASON[m.reason] ?? m.reason,
        job_name: m.service_job_name ?? m.bid_name ?? null,
        service_job_id: m.service_job_id ?? null,
        by_name: m.created_by_name ?? null,
        unit_cost: cost.unit_cost,
        source: cost.source,
        setup_cost: setupOf(m),
        pos: [],
      };
    });
}

/** The year summary for a From..To of office days, both included. */
export function buildYearEnd(
  input: CostInput & {
    from: string;
    to: string;
    locations: readonly { id: string; name: string }[];
  },
): YearEnd {
  if (!YMD.test(input.from) || !YMD.test(input.to)) throw new Error("Pick a from and to date");
  if (input.from > input.to) throw new Error("From must be on or before To");
  const since = startOfDay(input.from);
  const until = endOfDay(input.to);
  const summary = yearSummary({ ...input, since, until });
  const named = new Map<string, NamedMovement>();
  for (const m of input.movements) named.set(cellKeyOf(m), m);
  const rows: YearEndRow[] = summary.items.map((it) => {
    const m = named.get(it.key);
    return {
      key: it.key,
      screen_id: it.screen_id,
      row_label: it.row_label,
      price_col: it.price_col,
      category: m?.category ?? "",
      ...itemOf(m ?? it),
      unit: it.unit,
      qty: it.qty,
      dollars: centsAll(it.dollars),
      avg: it.avg,
      estimated: it.estimated,
      unknown: it.unknown,
      below_zero: it.qty.closing < 0,
    };
  });
  const byCategory = new Map<string, YearEndRow[]>();
  for (const r of rows) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const groups: YearEndGroup[] = [...byCategory.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([category, list]) => {
      const keys = new Set(list.map((r) => r.key));
      return {
        category,
        rows: list.sort((a, b) => cmp(a.item, b.item) || cmp(a.colour, b.colour)),
        dollars: sumDollars(summary.items.filter((i) => keys.has(i.key))),
      };
    });
  const unpriced = unpricedEntries({ ...input, until });
  return {
    from: input.from,
    to: input.to,
    groups,
    dollars: sumDollars(summary.items),
    counts: {
      items: rows.length,
      estimated: rows.filter((r) => r.estimated && !r.unknown).length,
      unknown: rows.filter((r) => r.unknown).length,
      belowZero: rows.filter((r) => r.below_zero).length,
      needsPrice: unpriced.length,
    },
    unpriced,
  };
}

const q = (n: number): string => String(Math.round(n * 1000) / 1000);
const money = (n: number | null): string => (n == null ? "" : cents(n).toFixed(2));
const unitCost = (n: number | null): string =>
  n == null ? "" : (Math.round((n + 1e-12) * 10000) / 10000).toFixed(4).replace(/0{1,2}$/, "");

/** What a row's cost rests on, in a word, for the "Cost note" column. */
export const costNote = (r: { estimated: boolean; unknown?: boolean }): string =>
  r.unknown ? "No cost known" : r.estimated ? "Estimate: an entry has no price" : "";

/** The year summary as a file: one row per item, the lines in units then in dollars, then totals. */
export function buildYearRows(y: YearEnd): string[][] {
  const lines = ["opening", ...FLOW_KEYS, "closing"] as const;
  const title = (k: (typeof lines)[number]): string =>
    k === "opening" ? "Opening" : k === "closing" ? "Closing" : FLOW_INFO[k].title;
  const header = [
    "Category",
    "Item",
    "Colour",
    "Unit",
    ...lines.map((k) => `${title(k)} (qty)`),
    ...lines.slice(0, -1).map((k) => `${title(k)} ($)`),
    "Revalued ($)",
    "Closing ($)",
    "Average cost at close",
    "Cost note",
  ];
  const dollarsOf = (d: Dollars, blank: boolean): string[] => [
    ...lines.slice(0, -1).map((k) => (blank ? "" : money(d[k]))),
    blank ? "" : money(d.revalued),
    blank ? "" : money(d.closing),
  ];
  const rows: string[][] = [];
  for (const g of y.groups)
    for (const r of g.rows)
      rows.push([
        r.category,
        r.item,
        r.colour,
        r.unit,
        ...lines.map((k) => q(r.qty[k])),
        ...dollarsOf(r.dollars, r.unknown),
        unitCost(r.avg),
        costNote(r),
      ]);
  const total = [
    "Total",
    "",
    "",
    "",
    ...lines.map(() => ""),
    ...dollarsOf(y.dollars, false),
    "",
    y.counts.unknown
      ? `${y.counts.unknown} item${y.counts.unknown === 1 ? "" : "s"} with no cost left out`
      : "",
  ];
  return rows.length ? [header, ...rows, total] : [header];
}

// ── Stock as of a day ──────────────────────────────────────────────────────────────────────────

/** One cell at one place as it stood at an instant, summed from the ledger. */
export interface AsOfCell extends Cell {
  location_id: string;
  on_hand: number;
  last_at: string | null;
  unit: string;
}

/**
 * Every cell at every place that had an entry before `until`, with what was on hand then (zero
 * and below-zero rows included, as today's stock report includes them).
 */
export function stockAsOf(movements: readonly CostMovement[], until: string): AsOfCell[] {
  const cells = new Map<string, AsOfCell>();
  for (const m of [...movements].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id,
  )) {
    if (m.created_at >= until) continue;
    const k = `${m.location_id}\u0000${cellKeyOf(m)}`;
    const cur = cells.get(k);
    if (cur) {
      cur.on_hand += Number(m.qty);
      cur.last_at = m.created_at;
      cur.unit = m.unit || cur.unit;
    } else
      cells.set(k, {
        location_id: m.location_id,
        screen_id: m.screen_id,
        row_label: m.row_label,
        price_col: m.price_col,
        on_hand: Number(m.qty),
        last_at: m.created_at,
        unit: m.unit,
      });
  }
  return [...cells.values()].map((c) => ({ ...c, on_hand: Math.round(c.on_hand * 1000) / 1000 }));
}

// ── A saved count ──────────────────────────────────────────────────────────────────────────────

export interface CountLineIn extends Cell {
  unit: string;
  expected: number | string;
  counted: number | string;
  movement_id: number | null;
}

export interface CountLine extends Cell {
  item: string;
  colour: string;
  category: string;
  unit: string;
  expected: number;
  counted: number;
  diff: number;
  /** The difference in dollars (the correcting entry's cost); null when dollars are not shown or unknown. */
  value: number | null;
}

export interface CountReport {
  id: string;
  location_id: string;
  location_name: string;
  counted_on: string;
  opening: boolean;
  note: string | null;
  by_name: string | null;
  created_at: string;
  lines: CountLine[];
  /** Lines whose count differed from what inventory expected. */
  differences: number;
  /** The differences added up, to the cent; null when dollars are not shown, or a line has no cost. */
  value: number | null;
  /** Dollars are shown (an admin or a manager is reading). */
  dollars: boolean;
}

/**
 * The lines of a saved count as a person reads them. `costs` is the replay's entries when the
 * reader may see dollars, else null: every value is then null.
 */
export function buildCountLines(
  lines: readonly CountLineIn[],
  names: (cell: Cell) => { item: string; colour: string; category: string },
  costs: ReadonlyMap<number, EntryCost> | null,
): { lines: CountLine[]; differences: number; value: number | null } {
  let total: number | null = costs ? 0 : null;
  let differences = 0;
  const out = lines
    .map((l) => {
      const expected = Number(l.expected);
      const counted = Number(l.counted);
      const diff = Math.round((counted - expected) * 1000) / 1000;
      let value: number | null = null;
      if (costs) {
        if (diff === 0) value = 0;
        else value = (l.movement_id != null ? costs.get(l.movement_id)?.amount : null) ?? null;
        if (value == null) total = null;
        else if (total != null) total += value;
      }
      if (diff !== 0) differences += 1;
      return {
        screen_id: l.screen_id,
        row_label: l.row_label,
        price_col: l.price_col,
        ...names(l),
        unit: l.unit,
        expected,
        counted,
        diff,
        value: value == null ? null : cents(value),
      };
    })
    .sort((a, b) => cmp(a.category, b.category) || cmp(a.item, b.item) || cmp(a.colour, b.colour));
  return { lines: out, differences, value: total == null ? null : cents(total) };
}

/** A saved count as a file. */
export function buildCountRows(c: CountReport): string[][] {
  const header = [
    "Place",
    "Counted on",
    "Category",
    "Item",
    "Colour",
    "Unit",
    "Expected",
    "Counted",
    "Difference",
  ];
  if (c.dollars) header.push("Difference ($)");
  const rows = c.lines.map((l) => {
    const out = [
      c.location_name,
      c.counted_on,
      l.category,
      l.item,
      l.colour,
      l.unit,
      q(l.expected),
      q(l.counted),
      q(l.diff),
    ];
    if (c.dollars) out.push(money(l.value));
    return out;
  });
  return [header, ...rows];
}

/** "inventory-count-shop-2026-12-31.csv": the place's name, lower case, letters and digits only. */
export const countFileName = (c: { location_name: string; counted_on: string }): string =>
  `inventory-count-${
    c.location_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "place"
  }-${c.counted_on}.csv`;

/** Today in the office's time zone, for a date box's default and its latest allowed day. */
export const officeToday = (now: Date = new Date()): string => easternYmd(now);
