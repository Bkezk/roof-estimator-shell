/**
 * Trade Bids, the rules (owner, Nov 16: "were talking about expanding into other areas so we
 * need a way to bid them … a bid setup where we can set labor and cost and time similar to the
 * project bid calculator but simpler and we can save it per job type like fill it in for
 * painting save it, fill it in for siding save it" … "a saved bid should keep its own numbers
 * and agreed it should be simpler").
 *
 * Two things, both plain data:
 *
 *  - A TRADE is a job type (Painting, Siding) set up once: what a bid of that kind measures
 *    (wall sq ft, trim linear ft, doors), the materials (cost, how far one goes, waste), the
 *    labor (how fast, the hourly rate), flat costs, and the overhead, profit and tax. It is a
 *    starting point and nothing more.
 *  - A TRADE BID copies the whole setup of its trade the moment it is started and keeps that
 *    copy. Changing the trade later changes no bid, and any line of a bid can be changed for
 *    that one job. A bid adds the job's own quantities.
 *
 * The sum, top to bottom, every step to the cent:
 *
 *   materials   each line: quantity needed × cost per unit
 *               quantity needed = measured ÷ how far one goes, plus waste; rounded UP to a
 *               whole unit when the line says it is bought whole (nobody buys 9.4 gallons)
 *   tax         materials × the sales tax rate. It is tax PAID to the supplier: a cost.
 *   labor       each line: hours × hourly rate; hours = measured ÷ how much one person does
 *               in an hour
 *   flat costs  a lift, a permit, a dumpster
 *   subs        work handed to a subcontractor (owner, Nov 17): the sub's quote for the job, or
 *               the sub's rate × what the job measures. No sales tax (it is not a material) and
 *               no hours (it is not our crew).
 *   cost        materials + tax + labor + flat costs + subs
 *   overhead    cost × overhead %
 *   profit      (cost + overhead) × profit %
 *   price       cost + overhead + profit
 *
 * A sub line may carry a markup of its own. Then it stands apart: the bid's overhead and profit
 * are worked on every other cost, and the line adds its cost plus its own markup to the price.
 * With its markup left blank it is a cost like any other, and overhead and profit apply to it.
 *
 * Time is the labor hours, and the working days they are for the crew: hours ÷ (people on the
 * crew × hours in a day).
 *
 * A number left blank is not zero: it is missing, and the line it sits on says so
 * (`problems`) instead of quietly pricing the job without it. Number boxes start blank.
 *
 * Pure: no database, no clock. The figures the Margin report reads (bid-figures.ts) are built
 * here too, so a trade bid is counted by the same report as a roofing bid.
 */
import { z } from "zod";

import type { BidFigures } from "@/lib/bid-figures";

export const TRADE_BID_VERSION = 1;

/** How a line gets its quantity: from something the bid measures, or typed as a flat amount. */
export type TradeBasis = "measure" | "flat";

/** Something a bid of this trade measures. */
export interface TradeMeasure {
  id: string;
  /** "Walls", "Trim", "Doors". */
  name: string;
  /** "sq ft", "linear ft", "each". */
  unit: string;
}

export interface TradeMaterial {
  id: string;
  name: string;
  /** What it is bought in: "gallon", "box", "square". */
  unit: string;
  /** Cost of one unit. */
  cost: number | null;
  basis: TradeBasis;
  /** basis "measure": which measure it follows. */
  measure_id: string | null;
  /** basis "measure": how much of the measure ONE unit covers (350 sq ft a gallon). */
  coverage: number | null;
  /** basis "measure": extra allowed for waste, in percent. */
  waste_pct: number | null;
  /** Bought in whole units: the quantity is rounded up. */
  whole: boolean;
  /** basis "flat": how many units, whatever the job measures. */
  qty: number | null;
}

export interface TradeLabor {
  id: string;
  /** "Roll walls", "Set up and clean up". */
  name: string;
  basis: TradeBasis;
  measure_id: string | null;
  /** basis "measure": how much of the measure ONE person does in an hour. */
  per_hour: number | null;
  /** basis "flat": hours, whatever the job measures. */
  hours: number | null;
  /** Dollars an hour for this work. */
  rate: number | null;
}

export interface TradeFixed {
  id: string;
  name: string;
  cost: number | null;
}

/** Work handed to a subcontractor (owner, Nov 17: "add the subcontractors line"). */
export interface TradeSub {
  id: string;
  /** What is subbed out: "Pressure washing". */
  name: string;
  /**
   * Who does it, picked from the vendor list. The name is kept beside the id so the bid still
   * says who after the vendor is archived or renamed. Both blank when nobody is picked yet.
   */
  vendor_id: string | null;
  vendor_name: string;
  /** "flat": one quoted amount for the job. "measure": the sub's rate for each unit measured. */
  basis: TradeBasis;
  measure_id: string | null;
  /** basis "measure": the sub's price for ONE unit of the measure ($0.20 a sq ft). */
  rate: number | null;
  /** basis "flat": the sub's quote for the job. */
  amount: number | null;
  /**
   * The markup on this line alone, in percent. Blank: no markup of its own, so the bid's
   * overhead and profit apply to it like any other cost.
   */
  markup_pct: number | null;
}

export interface TradeSetup {
  measures: TradeMeasure[];
  materials: TradeMaterial[];
  labor: TradeLabor[];
  fixed: TradeFixed[];
  /** Subcontractor lines. Absent on a setup saved before they existed: none. */
  subs?: TradeSub[] | undefined;
  /** Percent added to cost. */
  overhead_pct: number | null;
  /** Percent added on top of cost and overhead. */
  profit_pct: number | null;
  /** Sales tax paid on materials, in percent. */
  tax_pct: number | null;
  /** People on the crew, for the working days. */
  crew_size: number | null;
  /** Hours in a working day. */
  hours_per_day: number | null;
}

/** What `bids.data` holds for a trade bid. */
export interface TradeBidData {
  kind: "trade";
  v: 1;
  /** The trade it was started from; null once that trade is deleted. The copy below is what counts. */
  trade_type_id: string | null;
  /** The trade's name when the bid was started ("Painting"). */
  trade_name: string;
  /** The bid's OWN copy of the setup. */
  setup: TradeSetup;
  /** The job's quantities, by measure id; a measure not typed yet is absent or null. */
  quantities: Record<string, number | null>;
  /** What the work is, in words, for the proposal. */
  scope: string;
  /**
   * The customer and the job site, under the SAME keys a roofing bid uses (proposal-bid.ts
   * CustomerInfo: name, contact, phone, email, projectAddress, jobCity, jobState, jobZip,
   * estimatorName …). Everything that already reads a bid's customer then reads a trade bid's
   * too: the Customers page's link and move (bid-account-link.ts), the Margin report's customer
   * column, the bid's name after its customer.
   */
  customer: TradeCustomer;
}

/** The customer fields a trade bid types; any other CustomerInfo key a link fills is kept. */
export interface TradeCustomer {
  name: string;
  contact: string;
  projectAddress: string;
  notes: string;
  phone?: string | undefined;
  email?: string | undefined;
  jobCity?: string | undefined;
  jobState?: string | undefined;
  jobZip?: string | undefined;
  estimatorName?: string | undefined;
  [key: string]: string | undefined;
}

export const emptyCustomer = (): TradeCustomer => ({
  name: "",
  contact: "",
  projectAddress: "",
  notes: "",
});

export const emptySetup = (): TradeSetup => ({
  measures: [],
  materials: [],
  labor: [],
  fixed: [],
  subs: [],
  overhead_pct: null,
  profit_pct: null,
  tax_pct: null,
  crew_size: null,
  hours_per_day: null,
});

// ── What the server accepts ────────────────────────────────────────────────────────────────────

const id = z.string().min(1).max(40);
const text = (max: number) => z.string().max(max);
const amount = z.number().finite().min(0).max(100_000_000).nullable();
const pct = z.number().finite().min(0).max(1000).nullable();
const basis = z.enum(["measure", "flat"]);

export const tradeSetupSchema = z.object({
  measures: z.array(z.object({ id, name: text(80), unit: text(30) })).max(30),
  materials: z
    .array(
      z.object({
        id,
        name: text(120),
        unit: text(30),
        cost: amount,
        basis,
        measure_id: id.nullable(),
        coverage: amount,
        waste_pct: pct,
        whole: z.boolean(),
        qty: amount,
      }),
    )
    .max(100),
  labor: z
    .array(
      z.object({
        id,
        name: text(120),
        basis,
        measure_id: id.nullable(),
        per_hour: amount,
        hours: amount,
        rate: amount,
      }),
    )
    .max(100),
  fixed: z.array(z.object({ id, name: text(120), cost: amount })).max(50),
  // A setup saved before subcontractor lines existed has none, and is left as it is.
  subs: z
    .array(
      z.object({
        id,
        name: text(120),
        vendor_id: z.string().uuid().nullable(),
        vendor_name: text(200),
        basis,
        measure_id: id.nullable(),
        rate: amount,
        amount,
        markup_pct: pct,
      }),
    )
    .max(50)
    .optional(),
  overhead_pct: pct,
  profit_pct: pct,
  tax_pct: pct,
  crew_size: z.number().finite().min(0).max(500).nullable(),
  hours_per_day: z.number().finite().min(0).max(24).nullable(),
});

export const tradeBidDataSchema = z.object({
  kind: z.literal("trade"),
  v: z.literal(1),
  trade_type_id: z.string().uuid().nullable(),
  trade_name: text(80),
  setup: tradeSetupSchema,
  quantities: z.record(id, z.number().finite().min(0).max(1_000_000_000).nullable()),
  scope: text(8000),
  customer: z
    .object({
      name: text(200),
      contact: text(200),
      projectAddress: text(300),
      notes: text(4000),
      phone: text(60).optional(),
      email: text(200).optional(),
      jobCity: text(120).optional(),
      jobState: text(40).optional(),
      jobZip: text(20).optional(),
      estimatorName: text(120).optional(),
    })
    // Any other customer field a link fills in (the client's own address) is text too.
    .catchall(text(400)),
});

/** `bids.data` read back as a trade bid; null for a roofing bid or anything malformed. */
export function asTradeBidData(x: unknown): TradeBidData | null {
  const r = tradeBidDataSchema.safeParse(x);
  return r.success ? r.data : null;
}

/** Is this `bids.data` a trade bid's? (A roofing bid's has no `kind`.) */
export const isTradeData = (x: unknown): boolean =>
  !!x && typeof x === "object" && (x as { kind?: unknown }).kind === "trade";

// ── The sum ────────────────────────────────────────────────────────────────────────────────────

const r2 = (n: number) => {
  const v = Math.round((Math.abs(n) + 1e-9) * 100) / 100;
  return n < 0 && v !== 0 ? -v : v;
};
const r3 = (n: number) => Math.round((n + 1e-9) * 1000) / 1000;
const has = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);
const named = (name: string, fallback: string) => name.trim() || fallback;

export interface MaterialResult {
  id: string;
  /** Units to buy; null when it cannot be worked out. */
  qty: number | null;
  /** To the cent; 0 when it cannot be worked out. */
  cost: number;
  /** What is missing, in plain words; null when the line is complete. */
  problem: string | null;
}
export interface LaborResult {
  id: string;
  hours: number | null;
  cost: number;
  problem: string | null;
}
export interface FixedResult {
  id: string;
  cost: number;
  problem: string | null;
}

export interface SubResult {
  id: string;
  /** What the sub is paid; 0 when it cannot be worked out. */
  cost: number;
  /**
   * The line's own markup in dollars; null when it has none of its own (the bid's overhead and
   * profit apply to it instead).
   */
  markup: number | null;
  problem: string | null;
}

export interface TradeResult {
  materials: MaterialResult[];
  labor: LaborResult[];
  fixed: FixedResult[];
  subs: SubResult[];
  materialTotal: number;
  tax: number;
  laborTotal: number;
  fixedTotal: number;
  /** What the subs are paid, every line. */
  subTotal: number;
  /** The markups of the sub lines that carry their own, added up. */
  subMarkup: number;
  /**
   * What overhead and profit are worked on: the cost, less the sub lines that carry their own
   * markup. The same as `cost` when no sub line does.
   */
  markupBase: number;
  /** Labor hours, all lines. */
  hours: number;
  /** Working days for the crew; null when the crew or the day's hours are not set. */
  crewDays: number | null;
  cost: number;
  overhead: number;
  profit: number;
  price: number;
  /** Overhead and profit as a share of the price, in percent; null at a price of zero. */
  marginPct: number | null;
  /** Every line that could not be priced, in plain words. Empty when the bid is complete. */
  problems: string[];
}

/** The quantity a line follows: the job's measure, or what is wrong with it. */
function measured(
  setup: TradeSetup,
  quantities: Readonly<Record<string, number | null | undefined>>,
  measureId: string | null,
): { q: number; unit: string } | { problem: string } {
  const m = setup.measures.find((x) => x.id === measureId);
  if (!m) return { problem: "pick what it is measured by" };
  const q = quantities[m.id];
  if (!has(q)) return { problem: `type the ${named(m.name, "measure").toLowerCase()}` };
  return { q, unit: m.unit };
}

/** Price a trade bid from its own setup and the job's quantities. */
export function calcTradeBid(
  setup: TradeSetup,
  quantities: Readonly<Record<string, number | null | undefined>>,
): TradeResult {
  const problems: string[] = [];
  const flag = (kind: string, name: string, what: string): string => {
    const line = `${named(name, kind)}: ${what}`;
    problems.push(line);
    return what;
  };

  const materials: MaterialResult[] = setup.materials.map((m) => {
    const bad = (what: string): MaterialResult => ({
      id: m.id,
      qty: null,
      cost: 0,
      problem: flag("Material", m.name, what),
    });
    let qty: number;
    if (m.basis === "flat") {
      if (!has(m.qty)) return bad("type how many");
      qty = m.qty;
    } else {
      const got = measured(setup, quantities, m.measure_id);
      if ("problem" in got) return bad(got.problem);
      if (!has(m.coverage) || m.coverage <= 0) return bad("type how far one goes");
      qty = (got.q / m.coverage) * (1 + (has(m.waste_pct) ? m.waste_pct : 0) / 100);
    }
    // Bought whole: up to the next unit, unless it is already whole to the thousandth.
    // (`|| 0`: rounding nothing up gives a "negative zero", which would print as -0.)
    qty = m.whole ? Math.ceil(r3(qty) - 1e-9) || 0 : r3(qty);
    if (!has(m.cost)) return { ...bad("type the cost"), qty };
    return { id: m.id, qty, cost: r2(qty * m.cost), problem: null };
  });

  const labor: LaborResult[] = setup.labor.map((l) => {
    const bad = (what: string): LaborResult => ({
      id: l.id,
      hours: null,
      cost: 0,
      problem: flag("Labor", l.name, what),
    });
    let hours: number;
    if (l.basis === "flat") {
      if (!has(l.hours)) return bad("type the hours");
      hours = l.hours;
    } else {
      const got = measured(setup, quantities, l.measure_id);
      if ("problem" in got) return bad(got.problem);
      if (!has(l.per_hour) || l.per_hour <= 0) return bad("type how much one person does an hour");
      hours = got.q / l.per_hour;
    }
    hours = r2(hours);
    if (!has(l.rate)) return { ...bad("type the hourly rate"), hours };
    return { id: l.id, hours, cost: r2(hours * l.rate), problem: null };
  });

  const fixed: FixedResult[] = setup.fixed.map((f) =>
    has(f.cost)
      ? { id: f.id, cost: r2(f.cost), problem: null }
      : { id: f.id, cost: 0, problem: flag("Flat cost", f.name, "type the cost") },
  );

  const subs: SubResult[] = (setup.subs ?? []).map((s) => {
    const bad = (what: string): SubResult => ({
      id: s.id,
      cost: 0,
      markup: null,
      problem: flag("Subcontractor", s.name, what),
    });
    let cost: number;
    if (s.basis === "flat") {
      if (!has(s.amount)) return bad("type the quote");
      cost = r2(s.amount);
    } else {
      const got = measured(setup, quantities, s.measure_id);
      if ("problem" in got) return bad(got.problem);
      if (!has(s.rate)) return bad("type the rate");
      cost = r2(got.q * s.rate);
    }
    return {
      id: s.id,
      cost,
      markup: has(s.markup_pct) ? r2((cost * s.markup_pct) / 100) : null,
      problem: null,
    };
  });

  const sum = (rows: readonly { cost: number }[]) => r2(rows.reduce((n, r) => n + r.cost, 0));
  const materialTotal = sum(materials);
  const tax = r2((materialTotal * (has(setup.tax_pct) ? setup.tax_pct : 0)) / 100);
  const laborTotal = sum(labor);
  const fixedTotal = sum(fixed);
  const hours = r2(labor.reduce((n, l) => n + (l.hours ?? 0), 0));
  const perDay =
    has(setup.crew_size) && has(setup.hours_per_day) ? setup.crew_size * setup.hours_per_day : 0;
  const crewDays = perDay > 0 ? Math.round((hours / perDay + 1e-9) * 10) / 10 : null;

  const subTotal = sum(subs);
  // The sub lines that carry their own markup stand apart from overhead and profit.
  const apart = subs.filter((s) => s.markup !== null);
  const apartCost = sum(apart);
  const subMarkup = r2(apart.reduce((n, s) => n + (s.markup ?? 0), 0));

  const cost = r2(materialTotal + tax + laborTotal + fixedTotal + subTotal);
  const markupBase = r2(cost - apartCost);
  const overheadRate = (has(setup.overhead_pct) ? setup.overhead_pct : 0) / 100;
  const profitRate = (has(setup.profit_pct) ? setup.profit_pct : 0) / 100;
  // The marked-up part is worked out in one go and the two lines are cut from it, so they add
  // up to it; the sub lines with their own markup are then added at cost plus that markup.
  const marked = r2(markupBase * (1 + overheadRate) * (1 + profitRate));
  const overhead = r2(markupBase * overheadRate);
  const profit = r2(marked - markupBase - overhead);
  const price = r2(marked + apartCost + subMarkup);
  const marginPct = price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null;

  return {
    materials,
    labor,
    fixed,
    subs,
    materialTotal,
    tax,
    laborTotal,
    fixedTotal,
    subTotal,
    subMarkup,
    markupBase,
    hours,
    crewDays,
    cost,
    overhead,
    profit,
    price,
    marginPct,
    problems,
  };
}

/**
 * The figures the Margin report reads (bid-figures.ts), so a trade bid sits in the same report
 * as a roofing bid. The tax here is tax PAID on materials, a cost: it is `materialTax`, which
 * the report counts as cost and as revenue (margin-report.ts bidToMarginIn), so the report's
 * revenue is the price and its margin is overhead + profit (and the subs' own markups). What
 * the subs are paid is a cost of the job: it sits with the flat costs in `other`.
 */
export function tradeFigures(r: TradeResult): BidFigures {
  return {
    v: 1,
    revenue: r2(r.price - r.tax),
    material: r.materialTotal,
    labor: r.laborTotal,
    other: r2(r.fixedTotal + r.subTotal),
    hours: r.hours,
    tax: r.tax,
    total: r.price,
    materialTax: r.tax,
  };
}

// ── Starting and changing a bid ────────────────────────────────────────────────────────────────

/** A deep copy: a bid's setup shares nothing with its trade's. */
export const copySetup = (s: TradeSetup): TradeSetup => ({
  ...s,
  measures: s.measures.map((x) => ({ ...x })),
  materials: s.materials.map((x) => ({ ...x })),
  labor: s.labor.map((x) => ({ ...x })),
  fixed: s.fixed.map((x) => ({ ...x })),
  // A setup with no sub lines stays as it is: no empty list is added to it.
  ...(s.subs ? { subs: s.subs.map((x) => ({ ...x })) } : {}),
});

/** A new bid of a trade: the trade's setup copied in, every quantity blank. */
export function newTradeBid(trade: { id: string; name: string; setup: TradeSetup }): TradeBidData {
  return {
    kind: "trade",
    v: 1,
    trade_type_id: trade.id,
    trade_name: trade.name,
    setup: copySetup(trade.setup),
    quantities: {},
    scope: "",
    customer: emptyCustomer(),
  };
}

/** What a typed number box means: a number at or above zero, or blank. "1,250.5" is 1250.5. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,%\s]/g, "");
  if (!t || !/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A stored number back in its box: blank for none, no trailing zeros ("350", "0.5"). */
export const amountText = (n: number | null | undefined): string =>
  has(n) ? String(Math.round(n * 10000) / 10000) : "";

/** Money on a screen: "$3,067.12". */
export const fmtMoney = (n: number): string => {
  const v = r2(n);
  const text = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return v < 0 ? `-$${text}` : `$${text}`;
};

/** A quantity on a screen: three decimals at most, thousands separated ("9.429", "3,000"). */
export const fmtAmount = (n: number): string =>
  (Math.round(n * 1000) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

/** "2.3 days", "1 day"; a dash when the crew is not set. */
export const fmtDays = (d: number | null): string =>
  d == null
    ? "—"
    : `${d.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${d === 1 ? "day" : "days"}`;

/** A short id for a new line; the caller passes its own randomness so this stays pure. */
export const lineId = (rand: () => number = Math.random): string =>
  Array.from(
    { length: 10 },
    () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(rand() * 32)],
  ).join("");
