/**
 * Inventory › cost (owner, Nov 16: "as far as reporting for EOY stuff, is it as efficient and good
 * as it could be" … "How does it handle a situation where there's stock bought for x amount of
 * dollars then the same material bought later for more/less money?" … "Go with all 6").
 *
 * The method is a MOVING AVERAGE per item, one average for the whole company: the shop and every
 * vehicle share it, so moving stock between places never changes what it cost. The owner's own
 * example, which the tests work through to the cent:
 *
 *   buy 10 at $90      average $90.00   on hand 10   value   $900
 *   buy 10 at $100     average $95.00   on hand 20   value $1,900
 *   use 5 on a ticket  the ticket costs 5 × $95 = $475        on hand 15   value $1,425
 *   buy 5 at $110      average $98.75   on hand 20   value $1,975
 *
 * What is stored and what is worked out. The database keeps ONE thing: the price paid per stock
 * unit on an entry that brought stock in (inventory_movement_costs, an admin's and a manager's
 * table). Everything else here is worked out by replaying the ledger oldest first, so a price
 * corrected later corrects every number that followed from it, and nothing can drift apart.
 *
 * The cost of an entry that brings stock IN, first rule that applies:
 *   1. the price stored for it (typed when it was received, or set later);
 *   2. a put-back from a ticket or bid: what that job's takes of the item cost;
 *   3. the item's average at that moment (so stock found in a count comes in at the average);
 *   4. the Setup cost of the item, when the caller knows one;
 *   5. nothing: the cost is unknown and so is the item's value.
 * A leftover, a receipt or opening stock that got its cost from rule 3 or 4 is flagged
 * `needsPrice`: its numbers are an estimate until a manager types what was paid.
 *
 * The cost of an entry that takes stock OUT is the average at that moment (the Setup cost when
 * there is no average yet). Taking never moves the average.
 *
 * Coming in while the item is at or below zero starts the average afresh at the incoming cost:
 * there is no stock left to average with. That is the one place value moves without an entry of
 * its own, and the year summary shows it on its own line ("Revalued") so every line still adds
 * up: opening + in − out ± corrections + revalued = closing.
 *
 * Pure: no database, no clock. The server functions (inventory-cost.functions.ts) feed it rows.
 */
import type { Cell } from "@/lib/service-materials";

/** The columns of inventory_movements the replay reads (a ReconcileMovement qualifies). */
export interface CostMovement extends Cell {
  id: number;
  location_id: string;
  qty: number | string;
  unit: string;
  reason: string;
  service_job_id?: string | null;
  bid_id?: string | null;
  created_at: string;
}

/** A row of inventory_movement_costs: the price paid per stock unit. */
export interface StoredPrice {
  unit_cost: number;
  /** paid | opening | count | set (who typed it and where). */
  source: string;
}

/** Where an entry's cost came from. */
export type CostSource = "paid" | "putback" | "average" | "setup" | "none";

export interface EntryCost {
  id: number;
  /** Per stock unit; null when nothing is known. */
  unit_cost: number | null;
  /** qty × unit_cost with the entry's sign (in = +, out = −); null when unknown. */
  amount: number | null;
  source: CostSource;
  /** Stock came in with no price typed: a manager should say what was paid. */
  needsPrice: boolean;
  /** The cost rests, wholly or partly, on an entry with no price typed. */
  estimated: boolean;
  /** Value that moved because the average started afresh at this entry (0 almost always). */
  revalued: number;
}

export interface ItemCost extends Cell {
  key: string;
  unit: string;
  /** On hand, the whole company. */
  qty: number;
  /** Average cost per stock unit; null when unknown. */
  avg: number | null;
  /** qty × avg; null when the cost is unknown (0 when nothing is on hand). */
  value: number | null;
  estimated: boolean;
  /** On hand per place (inventory_locations.id). */
  byLocation: Map<string, number>;
  /** The newest entry's time. */
  last_at: string | null;
}

export interface Replay {
  entries: Map<number, EntryCost>;
  items: Map<string, ItemCost>;
}

export const cellKeyOf = (c: Cell): string =>
  `${c.screen_id}\u0000${c.row_label}\u0000${c.price_col}`;

const EPS = 1e-9;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Dollars to the cent (half away from zero, on a value nudged past float noise). */
export const cents = (n: number): number => {
  const v = Math.round((Math.abs(n) + 1e-9) * 100) / 100;
  return n < 0 && v !== 0 ? -v : v;
};

/** Oldest first; entries of one instant in the order they were made. */
export const byLedgerOrder = (
  a: { created_at: string; id: number },
  b: { created_at: string; id: number },
): number => a.created_at.localeCompare(b.created_at) || a.id - b.id;

/** The reasons whose stock comes from outside and so should carry a price paid. */
export const PRICED_REASONS: readonly string[] = ["received", "leftover", "opening"];

export interface ReplayInput {
  movements: readonly CostMovement[];
  /** movement id → the price stored for it. */
  prices: ReadonlyMap<number, StoredPrice>;
  /** The Setup cost of one stock unit of a cell, when one is known. */
  setupCost?: ((cell: Cell) => number | null) | null | undefined;
  /** Replay only entries made before this instant (ISO); everything when absent. */
  until?: string | null | undefined;
}

interface Running {
  item: ItemCost;
  /** Per job (ticket or bid): what it took of this item and what that cost. */
  taken: Map<string, { qty: number; cost: number | null; estimated: boolean }>;
}

const jobKeyOf = (m: CostMovement): string | null =>
  m.service_job_id ? `t:${m.service_job_id}` : m.bid_id ? `b:${m.bid_id}` : null;

/** Replay the ledger: every entry's cost, and every item's quantity, average and value. */
export function replayLedger(input: ReplayInput): Replay {
  const entries = new Map<number, EntryCost>();
  const running = new Map<string, Running>();
  const ordered = [...input.movements]
    .filter((m) => !input.until || m.created_at < input.until)
    .sort(byLedgerOrder);
  for (const m of ordered) {
    const qty = Number(m.qty);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const key = cellKeyOf(m);
    let run = running.get(key);
    if (!run) {
      run = {
        item: {
          key,
          screen_id: m.screen_id,
          row_label: m.row_label,
          price_col: m.price_col,
          unit: m.unit,
          qty: 0,
          avg: null,
          value: null,
          estimated: false,
          byLocation: new Map(),
          last_at: null,
        },
        taken: new Map(),
      };
      running.set(key, run);
    }
    const it = run.item;
    const setup = (): number | null => {
      const c = input.setupCost?.(m);
      return c != null && Number.isFinite(c) && c >= 0 ? c : null;
    };
    const job = jobKeyOf(m);
    let entry: EntryCost;
    if (qty > 0) {
      const stored = input.prices.get(m.id);
      const took = job ? run.taken.get(job) : undefined;
      let unit: number | null;
      let source: CostSource;
      let estimated: boolean;
      if (stored && Number.isFinite(stored.unit_cost) && stored.unit_cost >= 0) {
        unit = stored.unit_cost;
        source = "paid";
        estimated = false;
      } else if (m.reason === "released" && took && took.qty > EPS && took.cost != null) {
        unit = took.cost / took.qty;
        source = "putback";
        estimated = took.estimated;
      } else if (it.avg != null) {
        unit = it.avg;
        source = "average";
        estimated = it.estimated;
      } else {
        unit = setup();
        source = unit == null ? "none" : "setup";
        estimated = true;
      }
      // A leftover, a receipt or opening stock with no price typed; or anything else that came
      // in with no average to take its cost from. A move between places is never asked a price.
      const needsPrice =
        source !== "paid" &&
        source !== "putback" &&
        m.reason !== "transfer_in" &&
        (PRICED_REASONS.includes(m.reason) || source !== "average");
      if (needsPrice) estimated = true;
      // What a put-back gives back comes off what the job took.
      if (m.reason === "released" && took) {
        const back = Math.min(qty, took.qty);
        if (took.cost != null && took.qty > EPS) took.cost -= (took.cost / took.qty) * back;
        took.qty -= back;
      }
      const before = it.qty;
      const valueBefore = it.avg == null ? null : before * it.avg;
      let revalued = 0;
      if (before <= EPS) {
        // Nothing left to average with: the average starts afresh at what came in.
        it.avg = unit;
        it.estimated = estimated;
      } else if (unit == null) {
        // Only when there is no average either (rule 3 would have applied): still unknown.
        it.estimated = true;
      } else if (it.avg == null) {
        // Stock of unknown cost meets stock of known cost: the known cost stands for both.
        it.avg = unit;
        it.estimated = true;
      } else {
        it.avg = (before * it.avg + qty * unit) / (before + qty);
        it.estimated = it.estimated || estimated;
      }
      it.qty = before + qty;
      if (unit != null && it.avg != null) {
        const after = it.qty * it.avg;
        revalued = after - (valueBefore ?? 0) - qty * unit;
        if (Math.abs(revalued) < 1e-7) revalued = 0;
      }
      entry = {
        id: m.id,
        unit_cost: unit,
        amount: unit == null ? null : qty * unit,
        source,
        needsPrice,
        estimated,
        revalued,
      };
    } else {
      const out = -qty;
      let unit = it.avg;
      let source: CostSource = "average";
      let estimated = it.estimated;
      if (unit == null) {
        unit = setup();
        source = unit == null ? "none" : "setup";
        estimated = true;
        // The first cost known for stock that was taken before any came in priced.
        if (unit != null) {
          it.avg = unit;
          it.estimated = true;
        }
      }
      if (m.reason === "consumed" && job) {
        const took = run.taken.get(job) ?? { qty: 0, cost: 0 as number | null, estimated: false };
        took.cost = took.cost == null || unit == null ? null : took.cost + out * unit;
        took.qty += out;
        took.estimated = took.estimated || estimated;
        run.taken.set(job, took);
      }
      it.qty -= out;
      entry = {
        id: m.id,
        unit_cost: unit,
        amount: unit == null ? null : qty * unit,
        source,
        needsPrice: false,
        estimated,
        revalued: 0,
      };
    }
    if (Math.abs(it.qty) < EPS) it.qty = 0;
    it.byLocation.set(m.location_id, (it.byLocation.get(m.location_id) ?? 0) + qty);
    it.last_at = m.created_at;
    it.unit = m.unit || it.unit;
    entries.set(m.id, entry);
  }
  const items = new Map<string, ItemCost>();
  for (const [key, { item }] of running) {
    item.qty = r3(item.qty);
    for (const [loc, q] of item.byLocation) item.byLocation.set(loc, r3(q));
    item.value = item.qty === 0 ? 0 : item.avg == null ? null : item.qty * item.avg;
    items.set(key, item);
  }
  return { entries, items };
}

// ── The year summary ───────────────────────────────────────────────────────────────────────────

/** The lines of the summary, in the order they are printed. */
export const FLOW_KEYS = [
  "received",
  "fromJobs",
  "openingStock",
  "used",
  "damaged",
  "counted",
  "other",
] as const;
export type FlowKey = (typeof FLOW_KEYS)[number];

/**
 * Which line an entry belongs on. `used` is material on tickets and bids, net: a take adds to
 * it and a put-back takes off it. A transfer's two halves land on `other` and cancel.
 */
export function flowOf(reason: string): FlowKey {
  if (reason === "received") return "received";
  if (reason === "leftover") return "fromJobs";
  if (reason === "opening") return "openingStock";
  if (reason === "consumed" || reason === "released" || reason === "vehicle_used") return "used";
  if (reason === "damaged") return "damaged";
  if (reason === "adjustment") return "counted";
  return "other";
}

/**
 * How each line reads on the report and its sign in the sum: `used` and `damaged` are shown as
 * positive numbers that come OFF the stock.
 */
export const FLOW_INFO: Record<FlowKey, { title: string; sign: 1 | -1; help: string }> = {
  received: {
    title: "Received",
    sign: 1,
    help: "Stock bought or added with a Received entry, at the price paid.",
  },
  fromJobs: {
    title: "Put in from jobs",
    sign: 1,
    help: "Excess from a job put on the shelf or a truck, at the price paid for it.",
  },
  openingStock: {
    title: "Opening stock",
    sign: 1,
    help: "Stock loaded by an opening count, at the cost typed on that count.",
  },
  used: {
    title: "Used on jobs",
    sign: -1,
    help: "Material taken for tickets and bids, less what was put back, at the average cost when it was taken.",
  },
  damaged: {
    title: "Damaged / written off",
    sign: -1,
    help: "Stock written off, at the average cost on that day.",
  },
  counted: {
    title: "Count corrections",
    sign: 1,
    help: "The difference a count found: more than expected adds, less than expected takes off, at the average cost.",
  },
  other: {
    title: "Other",
    sign: 1,
    help: "Anything else. A move between the shop and a truck nets to zero here.",
  },
};

export interface Amounts {
  opening: number;
  received: number;
  fromJobs: number;
  openingStock: number;
  used: number;
  damaged: number;
  counted: number;
  other: number;
  closing: number;
}

export interface YearItem extends Cell {
  key: string;
  unit: string;
  /** Quantities in the stock unit; `used` and `damaged` are positive amounts taken off. */
  qty: Amounts;
  /** Dollars, unrounded; a part with no known cost counts as 0 and sets `unknown`. */
  dollars: Amounts & { revalued: number };
  /** Average cost per unit at the end of the period; null when unknown. */
  avg: number | null;
  /** Some number on this row rests on an entry with no price typed. */
  estimated: boolean;
  /** Some number on this row could not be costed at all. */
  unknown: boolean;
}

const zeroAmounts = (): Amounts => ({
  opening: 0,
  received: 0,
  fromJobs: 0,
  openingStock: 0,
  used: 0,
  damaged: 0,
  counted: 0,
  other: 0,
  closing: 0,
});

export interface YearSummary {
  items: YearItem[];
  /** Entries in the period that brought stock in with no price typed. */
  needsPrice: number;
}

/**
 * Opening, every movement line and closing for each item, between two instants (since
 * inclusive, until exclusive). An item that had nothing on hand and no entry in the period is
 * left out.
 */
export function yearSummary(
  input: Omit<ReplayInput, "until"> & { since: string; until: string },
): YearSummary {
  const base = { movements: input.movements, prices: input.prices, setupCost: input.setupCost };
  const start = replayLedger({ ...base, until: input.since });
  const end = replayLedger({ ...base, until: input.until });
  const rows = new Map<string, YearItem>();
  const rowFor = (cell: Cell, unit: string): YearItem => {
    const key = cellKeyOf(cell);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        screen_id: cell.screen_id,
        row_label: cell.row_label,
        price_col: cell.price_col,
        unit,
        qty: zeroAmounts(),
        dollars: { ...zeroAmounts(), revalued: 0 },
        avg: null,
        estimated: false,
        unknown: false,
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const it of start.items.values()) {
    if (it.qty === 0) continue;
    const row = rowFor(it, it.unit);
    row.qty.opening = it.qty;
    if (it.value == null) row.unknown = true;
    else row.dollars.opening = it.value;
    row.estimated = row.estimated || it.estimated;
  }
  let needsPrice = 0;
  for (const m of input.movements) {
    if (m.created_at < input.since || m.created_at >= input.until) continue;
    const cost = end.entries.get(m.id);
    if (!cost) continue;
    const row = rowFor(m, m.unit);
    const flow = flowOf(m.reason);
    const sign = FLOW_INFO[flow].sign;
    row.qty[flow] += sign * Number(m.qty);
    if (cost.amount == null) row.unknown = true;
    else row.dollars[flow] += sign * cost.amount;
    row.estimated = row.estimated || cost.estimated;
    if (cost.needsPrice) needsPrice += 1;
  }
  for (const row of rows.values()) {
    const it = end.items.get(row.key);
    row.qty.closing = it?.qty ?? 0;
    row.avg = it?.avg ?? null;
    if (it && it.value == null) row.unknown = true;
    else row.dollars.closing = it?.value ?? 0;
    if (it && it.qty !== 0) row.estimated = row.estimated || it.estimated;
    for (const k of [...FLOW_KEYS, "opening", "closing"] as const) row.qty[k] = r3(row.qty[k]);
    // Whatever the lines do not explain is the revaluation (nothing, unless the average started
    // afresh or a cost was unknown): the lines always add up to closing.
    const d = row.dollars;
    const explained =
      d.opening +
      d.received +
      d.fromJobs +
      d.openingStock -
      d.used -
      d.damaged +
      d.counted +
      d.other;
    d.revalued = d.closing - explained;
    if (Math.abs(d.revalued) < 0.005) d.revalued = 0;
  }
  return { items: [...rows.values()], needsPrice };
}

/** The dollar lines of several rows added up (each line to the cent after adding). */
export function sumDollars(rows: readonly YearItem[]): Amounts & { revalued: number } {
  const out = { ...zeroAmounts(), revalued: 0 };
  for (const r of rows)
    for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += r.dollars[k];
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = cents(out[k]);
  return out;
}

// ── Counting ───────────────────────────────────────────────────────────────────────────────────

/** Counted against expected for one line of a count: the difference in units and in dollars. */
export function countDifference(
  expected: number,
  counted: number,
  avg: number | null,
): { diff: number; value: number | null } {
  const diff = r3(counted - expected);
  return { diff, value: diff === 0 ? 0 : avg == null ? null : diff * avg };
}

/** Money for a screen or a file: "$1,975.00", "-$50.00"; a dash when unknown. */
export const fmtDollars = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = cents(n);
  const text = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `-$${text}` : `$${text}`;
};

/** A unit cost for a file: four decimals at most, no trailing zeros past the cent ("98.75", "0.0915"). */
export const fmtUnitCost = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "";
  const four = (Math.round((n + 1e-12) * 10000) / 10000).toFixed(4);
  return four.replace(/0{1,2}$/, "");
};

/** What a typed price means: a number at or above zero, or nothing. "$1,250.50" is 1250.5. */
export function parsePrice(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!t || !/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
