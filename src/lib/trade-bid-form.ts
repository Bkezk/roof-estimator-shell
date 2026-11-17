/**
 * Trade Bids, what the two screens are built from (owner, Nov 16: "a bid setup where we can set
 * labor and cost and time similar to the project bid calculator but simpler" … "ensure if
 * someone leaves the pages the pop up reminding to save or giving the option to leave without
 * saving is offered").
 *
 * The rules of the sum are trade-bid.ts. This file is everything a screen decides that can be
 * decided without a screen, so it is tested without a browser (trade-screens-nov16.test.ts):
 *
 *  - is there something to save? (`isDirty`: what is on screen against what was last saved);
 *  - what is missing before a save, in the words the person reads ("Pick the customer");
 *  - what a number box holds: a number, nothing, or a mistake that is said out loud;
 *  - adding, changing and removing a line of a setup, each returning a NEW setup (the screens
 *    compare the old one with the new one, so nothing here changes what it is given);
 *  - the rows and totals of the price as text, so the screen only lays them out;
 *  - a subcontractor line's words (owner, Nov 17): who was picked, what its one number box is
 *    called, how it is marked up, and what overhead and profit were worked on when a line
 *    carries a markup of its own;
 *  - the wording of a unit ("1 gallon", "10 gallons", "2 boxes", "3,000 sq ft").
 *
 * Pure: no React, no database, no clock.
 */
import {
  fmtAmount,
  fmtDays,
  fmtMoney,
  lineId,
  parseAmount,
  type TradeBasis,
  type TradeCustomer,
  type TradeFixed,
  type TradeLabor,
  type TradeMaterial,
  type TradeMeasure,
  type TradeResult,
  type TradeSetup,
  type TradeSub,
} from "@/lib/trade-bid";

// ── Is there something to save? ────────────────────────────────────────────────────────────────

/**
 * A value written out the same way every time: keys in A-to-Z order, a key holding `undefined`
 * left out. What comes back from the server has its keys in the server's order, and a box
 * cleared on screen is `undefined` where the saved copy has no key at all; neither is a change.
 * A list keeps its order: the second material is not the first.
 */
export function stableJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : walk(x)));
    if (v && typeof v === "object") {
      const from = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(from).sort())
        if (from[key] !== undefined) out[key] = walk(from[key]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value)) ?? "null";
}

/** Does what is on screen differ from what was last saved? */
export const isDirty = (saved: unknown, current: unknown): boolean =>
  stableJson(saved) !== stableJson(current);

// ── What is missing before a save ──────────────────────────────────────────────────────────────

export const PICK_CUSTOMER = "Pick the customer";
export const PICK_DUE_DATE = "Pick the due date";
export const TYPE_TRADE_NAME = "Type the trade name";

/** "2 boxes hold something that is not a number. Fix them or clear them."; null for none. */
export function boxesMessage(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 box holds something that is not a number. Fix it or clear it."
    : `${count} boxes hold something that is not a number. Fix them or clear them.`;
}

/**
 * What a bid still needs before it can be saved, in the order the screen asks for it. The
 * server refuses the same two (bid-status.ts bidCustomerProblem, bidDueDateProblem); saying it
 * here first means the person reads "Pick the customer" beside the Save button instead of a
 * refusal after pressing it. The due date is a NEW bid's rule: a saved bid already has one.
 */
export function bidSaveProblems(input: {
  isNew: boolean;
  accountId: string | null | undefined;
  dueDate: string | null | undefined;
  /** Boxes holding something that is not a number (the screen counts them). */
  invalidBoxes?: number;
}): string[] {
  const out: string[] = [];
  if (!input.accountId) out.push(PICK_CUSTOMER);
  if (input.isNew && !input.dueDate) out.push(PICK_DUE_DATE);
  const boxes = boxesMessage(input.invalidBoxes ?? 0);
  if (boxes) out.push(boxes);
  return out;
}

/** What a trade's setup still needs before it can be saved. */
export function setupSaveProblems(input: { name: string; invalidBoxes?: number }): string[] {
  const out: string[] = [];
  if (!input.name.trim()) out.push(TYPE_TRADE_NAME);
  const boxes = boxesMessage(input.invalidBoxes ?? 0);
  if (boxes) out.push(boxes);
  return out;
}

// ── A number box ───────────────────────────────────────────────────────────────────────────────

export const NOT_A_NUMBER = "Type a number, like 350 or 12.5";

/** The most each kind of box takes: what the server accepts (trade-bid.ts tradeSetupSchema). */
export const BOX_MAX = {
  amount: 100_000_000,
  pct: 1000,
  crew: 500,
  hoursPerDay: 24,
  quantity: 1_000_000_000,
} as const;

/**
 * What is wrong with what a number box holds; null when it is blank or a number. Blank is never
 * wrong: a blank is "not typed yet", and the price says which line is waiting for it.
 */
export function amountProblem(text: string, max?: number): string | null {
  if (!text.trim()) return null;
  const n = parseAmount(text);
  if (n === null) return NOT_A_NUMBER;
  if (max !== undefined && n > max) return `No more than ${fmtAmount(max)}`;
  return null;
}

/** What a number box means: its number, or nothing while it is blank or holds a mistake. */
export const amountValue = (text: string, max?: number): number | null =>
  amountProblem(text, max) ? null : parseAmount(text);

// ── Adding, changing and removing lines ────────────────────────────────────────────────────────

/** The most lines of each kind the server accepts (trade-bid.ts tradeSetupSchema). */
export const LINE_MAX = {
  measures: 30,
  materials: 100,
  labor: 100,
  fixed: 50,
  subs: 50,
} as const;

export type LineKind = "measures" | "materials" | "labor" | "fixed" | "subs";
interface LineOf {
  measures: TradeMeasure;
  materials: TradeMaterial;
  labor: TradeLabor;
  fixed: TradeFixed;
  subs: TradeSub;
}

/**
 * How a new material or labor line starts out. With one thing measured there is nothing to
 * choose, so it follows that; with several the person picks (a guess here would price the line
 * off the wrong measure without a word); with none it is a set amount, the only choice there is.
 */
const startBasis = (setup: TradeSetup): { basis: TradeBasis; measure_id: string | null } => {
  const [only, ...rest] = setup.measures;
  if (!only) return { basis: "flat", measure_id: null };
  return { basis: "measure", measure_id: rest.length === 0 ? only.id : null };
};

export const addMeasure = (setup: TradeSetup, newId: () => string = lineId): TradeSetup => ({
  ...setup,
  measures: [...setup.measures, { id: newId(), name: "", unit: "" }],
});

/** A new material: every number blank, never 0 (a blank is missing; a 0 would be priced). */
export const addMaterial = (setup: TradeSetup, newId: () => string = lineId): TradeSetup => ({
  ...setup,
  materials: [
    ...setup.materials,
    {
      id: newId(),
      name: "",
      unit: "",
      cost: null,
      ...startBasis(setup),
      coverage: null,
      waste_pct: null,
      whole: false,
      qty: null,
    },
  ],
});

export const addLabor = (setup: TradeSetup, newId: () => string = lineId): TradeSetup => ({
  ...setup,
  labor: [
    ...setup.labor,
    { id: newId(), name: "", ...startBasis(setup), per_hour: null, hours: null, rate: null },
  ],
});

export const addFixed = (setup: TradeSetup, newId: () => string = lineId): TradeSetup => ({
  ...setup,
  fixed: [...setup.fixed, { id: newId(), name: "", cost: null }],
});

/**
 * A new subcontractor line (owner, Nov 17): a set quote with every number blank and nobody
 * picked. It does not start out following a measure the way a material does: what a sub hands
 * over is most often one amount for the job, and a rate per sq ft is picked when it is not.
 *
 * This is the ONLY thing that gives a setup its list of sub lines. A setup saved before they
 * existed has no `subs` at all, and nothing else here adds one (an empty list on a setup that
 * was never touched would read as a change to save).
 */
export const addSub = (setup: TradeSetup, newId: () => string = lineId): TradeSetup => ({
  ...setup,
  subs: [
    ...(setup.subs ?? []),
    {
      id: newId(),
      name: "",
      vendor_id: null,
      vendor_name: "",
      basis: "flat",
      measure_id: null,
      rate: null,
      amount: null,
      markup_pct: null,
    },
  ],
});

/**
 * "No sub lines" written the way the saved copy writes it. A setup saved before sub lines
 * existed has no list of them; one saved since may hold an empty list. Adding a line and taking
 * it out again leaves an empty list either way, which against a saved copy with no list at all
 * would read as a change to save (and ask "Save your changes?" on the way out) though nothing
 * is different. So when the saved copy has no list, an empty one is dropped again. The screens
 * run every change to a setup through this; a list with a line in it is never touched.
 */
export function subsAsSaved(setup: TradeSetup, saved: TradeSetup): TradeSetup {
  if (!setup.subs || setup.subs.length > 0 || saved.subs) return setup;
  const { subs: _none, ...rest } = setup;
  return rest;
}

/**
 * What picking a vendor in a sub line's Subcontractor box changes on the line: the id and the
 * name, always together (the name is what the bid still shows once the vendor is archived or
 * renamed). Clearing the box clears both.
 */
export const subVendorPatch = (
  vendor: { id: string; name: string } | null,
): Pick<TradeSub, "vendor_id" | "vendor_name"> =>
  vendor
    ? { vendor_id: vendor.id, vendor_name: vendor.name }
    : { vendor_id: null, vendor_name: "" };

/** Change some of one line; every other line is the very same object as before. */
export function patchLine<K extends LineKind>(
  setup: TradeSetup,
  kind: K,
  id: string,
  patch: Partial<Omit<LineOf[K], "id">>,
): TradeSetup {
  const rows = setup[kind] as LineOf[K][] | undefined;
  // No sub lines on this setup: there is no line to change, and it is not given a list.
  if (!rows) return setup;
  return { ...setup, [kind]: rows.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

/**
 * Take a material, a labor line, a flat cost or a sub line out. (A measure goes through
 * removeMeasure.) Taking the last sub line out leaves an empty list, which is priced the same
 * as none.
 */
export function removeLine(
  setup: TradeSetup,
  kind: Exclude<LineKind, "measures">,
  id: string,
): TradeSetup {
  const rows = setup[kind] as { id: string }[] | undefined;
  if (!rows) return setup;
  return { ...setup, [kind]: rows.filter((row) => row.id !== id) };
}

/**
 * The names of the lines that go by a measure: materials first, then labor, then sub lines
 * charged by it. Removing a measure these lines follow asks first and names them.
 */
export function followers(setup: TradeSetup, measureId: string): string[] {
  const follows = (line: { basis: TradeBasis; measure_id: string | null }) =>
    line.basis === "measure" && line.measure_id === measureId;
  return [
    ...setup.materials.filter(follows).map((m) => m.name.trim() || "a material with no name"),
    ...setup.labor.filter(follows).map((l) => l.name.trim() || "a task with no name"),
    ...(setup.subs ?? [])
      .filter(follows)
      .map((s) => s.name.trim() || "a subcontractor line with no name"),
  ];
}

/**
 * Take a measure out. The lines that went by it stay, with nothing picked: each then says "pick
 * what it is measured by" and adds nothing to the price until someone does. (Quietly turning
 * them into set amounts would price them at whatever was left in a hidden box.) The quantity
 * typed for the measure is dropped by tidyQuantities, which the bid screen runs on every change
 * to its setup.
 */
export function removeMeasure(setup: TradeSetup, measureId: string): TradeSetup {
  const letGo = <T extends { measure_id: string | null }>(line: T): T =>
    line.measure_id === measureId ? { ...line, measure_id: null } : line;
  return {
    ...setup,
    measures: setup.measures.filter((m) => m.id !== measureId),
    materials: setup.materials.map(letGo),
    labor: setup.labor.map(letGo),
    // A sub line charged by the measure lets go of it too. A setup with no sub lines gets no list.
    ...(setup.subs ? { subs: setup.subs.map(letGo) } : {}),
  };
}

/**
 * The job's quantities kept to what the setup measures and to what was typed: a removed
 * measure's quantity goes with it, and a box cleared by hand is the same as one never typed in
 * (so clearing it again is not "a change to save").
 */
export function tidyQuantities(
  quantities: Readonly<Record<string, number | null | undefined>>,
  setup: TradeSetup,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of setup.measures) {
    const q = quantities[m.id];
    if (typeof q === "number" && Number.isFinite(q)) out[m.id] = q;
  }
  return out;
}

/** The "Goes by" choice for a set amount (a measure's choice is "m:" and its id). */
export const SET_AMOUNT = "set";

/** A line's "Goes by" choice; "" when nothing is picked or its measure is gone. */
export function goesBy(
  line: { basis: TradeBasis; measure_id: string | null },
  measures: readonly TradeMeasure[],
): string {
  if (line.basis === "flat") return SET_AMOUNT;
  return measures.some((m) => m.id === line.measure_id) ? `m:${line.measure_id}` : "";
}

/** What picking a "Goes by" choice changes on the line. */
export const goesByPatch = (choice: string): { basis: TradeBasis; measure_id: string | null } =>
  choice.startsWith("m:")
    ? { basis: "measure", measure_id: choice.slice(2) }
    : { basis: "flat", measure_id: null };

// ── Unit wording ───────────────────────────────────────────────────────────────────────────────

// Short forms read the same for one and for many: "1 sq ft", "3,000 sq ft", "6 each".
const SAME_FOR_MANY = new Set([
  "each",
  "ea",
  "ft",
  "feet",
  "lf",
  "sf",
  "sq",
  "sy",
  "yd",
  "in",
  "lb",
  "oz",
  "gal",
  "qt",
  "pt",
  "pc",
  "hr",
  "m",
  "cm",
  "mm",
  "kg",
  "g",
  "l",
  "ml",
]);

/**
 * A unit as it reads after a quantity: "gallon" for exactly one, "gallons" for anything else
 * (0.5 gallons, 0 gallons). Only the last word changes ("linear foot" → "linear feet"), and
 * only when it is a whole word: a short form (ft, each, EA), a unit already in the plural
 * (gallons) and one ending in anything but a letter ("roll (100 ft)") stay as typed.
 */
export function pluralUnit(unit: string, qty: number): string {
  const u = unit.trim();
  if (!u || qty === 1) return u;
  const m = u.match(/^(.*?)([A-Za-z]+)$/);
  if (!m) return u;
  const head = m[1] ?? "";
  const word = m[2] ?? "";
  const w = word.toLowerCase();
  if (SAME_FOR_MANY.has(w) || word === word.toUpperCase()) return u;
  if (w === "foot") return `${head}${word.slice(0, 1)}eet`;
  if (/[^s]s$/.test(w)) return u;
  if (/(s|x|z|ch|sh)$/.test(w)) return `${u}es`;
  if (/[^aeiou]y$/.test(w)) return `${u.slice(0, -1)}ies`;
  return `${u}s`;
}

/** A quantity with its unit: "10 gallons", "7.5 gallons", "1 box", "3,000 sq ft". */
export const unitWords = (qty: number, unit: string): string =>
  `${fmtAmount(qty)} ${pluralUnit(unit, qty)}`.trim();

// ── The price, as text ─────────────────────────────────────────────────────────────────────────

export interface ResultRow {
  id: string;
  name: string;
  /** "10 gallons", "20 hours"; "" when it cannot be worked out (and for a flat cost). */
  qty: string;
  /** "$380.00"; null when the line has a problem. */
  cost: string | null;
  /** What the line is waiting for ("Type the cost"); null when it is complete. */
  problem: string | null;
}

const sentence = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/**
 * The rows of the materials, labor and flat-cost tables. A line with a problem has no cost: it
 * shows the problem there instead, because a $0.00 beside it would read as "this costs nothing".
 */
export function resultRows(
  setup: TradeSetup,
  result: TradeResult,
): { materials: ResultRow[]; labor: ResultRow[]; fixed: ResultRow[] } {
  const row = (
    id: string,
    name: string,
    qty: string,
    r: { cost: number; problem: string | null } | undefined,
  ): ResultRow => ({
    id,
    name,
    qty,
    cost: r && !r.problem ? fmtMoney(r.cost) : null,
    problem: r?.problem ? sentence(r.problem) : null,
  });
  return {
    materials: setup.materials.map((m, i) => {
      const r = result.materials[i];
      const qty = r?.qty ?? null;
      return row(m.id, m.name.trim() || "Material", qty == null ? "" : unitWords(qty, m.unit), r);
    }),
    labor: setup.labor.map((l, i) => {
      const r = result.labor[i];
      const hours = r?.hours ?? null;
      return row(l.id, l.name.trim() || "Labor", hours == null ? "" : unitWords(hours, "hour"), r);
    }),
    fixed: setup.fixed.map((f, i) => row(f.id, f.name.trim() || "Flat cost", "", result.fixed[i])),
  };
}

/** One row of the price's Subcontractors table. */
export interface SubRow {
  id: string;
  /** What is subbed out; "Subcontractor" for a line with no name yet. */
  name: string;
  /** Who does it: the vendor's name as kept on the line, or NO_SUB_PICKED. */
  vendor: string;
  /** What the sub is paid, "$600.00"; null when the line has a problem. */
  cost: string | null;
  /** "plus $60.00 markup" for a line that carries its own markup; null for one that does not. */
  markup: string | null;
  /** What the line is waiting for ("Type the quote"); null when it is complete. */
  problem: string | null;
}

export const NO_SUB_PICKED = "No subcontractor picked";

/**
 * The rows of the Subcontractors table (owner, Nov 17). Like the other tables, a line with a
 * problem has no cost: it shows the problem there instead. A line's own markup is not part of
 * its cost (the cost is what the sub is paid), so it is said beside it.
 */
export function subRows(setup: TradeSetup, result: TradeResult): SubRow[] {
  return (setup.subs ?? []).map((s, i) => {
    const r = result.subs[i];
    const priced = !!r && !r.problem;
    return {
      id: s.id,
      name: s.name.trim() || "Subcontractor",
      vendor: s.vendor_name.trim() || NO_SUB_PICKED,
      cost: priced ? fmtMoney(r.cost) : null,
      markup: priced && r.markup !== null ? `plus ${fmtMoney(r.markup)} markup` : null,
      problem: r?.problem ? sentence(r.problem) : null,
    };
  });
}

/**
 * How a sub line is marked up, in one sentence under its quote on the bid's main screen. A
 * markup typed as 0 is a markup of its own: the line is passed on at what the sub is paid.
 */
export const subMarkupWords = (sub: Pick<TradeSub, "markup_pct">): string =>
  sub.markup_pct == null
    ? "Takes the bid's overhead and profit."
    : `Marked up ${fmtAmount(sub.markup_pct)}% on its own.`;

/**
 * What a sub line's one number box is called: "Quote" for a set quote, "Rate per sq ft" for a
 * line charged by a measure (the unit is the measure's; "unit" while there is none to name).
 */
export function subQuoteLabel(
  sub: Pick<TradeSub, "basis" | "measure_id">,
  measures: readonly TradeMeasure[],
): string {
  if (sub.basis === "flat") return "Quote";
  const unit = measures.find((m) => m.id === sub.measure_id)?.unit.trim();
  return `Rate per ${unit || "unit"}`;
}

export type TotalKey =
  | "materials"
  | "tax"
  | "labor"
  | "fixed"
  | "subs"
  | "cost"
  | "overhead"
  | "profit"
  | "subMarkup"
  | "price"
  | "hours"
  | "days"
  | "margin";

export interface TotalLine {
  key: TotalKey;
  /** How the line joins the sum: "=" a total of the lines above, "+" added to it. */
  sign: "" | "+" | "=";
  label: string;
  value: string;
  /** The price: the one line in bold. */
  strong: boolean;
  /** Why there is no value yet; null when there is one. */
  hint: string | null;
}

const withPct = (label: string, pct: number | null) =>
  pct == null ? label : `${label} (${fmtAmount(pct)}%)`;

/**
 * The totals as a sum a bookkeeper can read down: the four costs, = Cost, + Overhead, + Profit,
 * = Price; then the time (labor hours and the working days they are for the crew) and the
 * margin. The rates are printed beside the lines they make, so nobody has to open the setup to
 * see where $333.38 came from.
 *
 * Subcontractor lines (owner, Nov 17) add two lines, each only when it has something to say, so
 * a bid with nothing subbed out reads exactly as it did: "Subcontractors" with the costs when
 * the setup has a sub line, and "+ Subcontractor markup" after the profit when a line carries
 * a markup of its own (even one of 0%: that line stands apart from overhead and profit). The
 * sum still reads straight down: cost + overhead + profit + the subs' own markup = price.
 */
export function resultTotals(setup: TradeSetup, result: TradeResult): TotalLine[] {
  const line = (
    key: TotalKey,
    sign: TotalLine["sign"],
    label: string,
    value: string,
    more: { strong?: boolean; hint?: string | null } = {},
  ): TotalLine => ({ key, sign, label, value, strong: !!more.strong, hint: more.hint ?? null });
  const crew = setup.crew_size;
  const hasSubs = (setup.subs ?? []).length > 0;
  const ownMarkup = result.subs.some((s) => s.markup !== null);
  return [
    line("materials", "", "Materials", fmtMoney(result.materialTotal)),
    line("tax", "", withPct("Sales tax on materials", setup.tax_pct), fmtMoney(result.tax)),
    line("labor", "", "Labor", fmtMoney(result.laborTotal)),
    line("fixed", "", "Flat costs", fmtMoney(result.fixedTotal)),
    ...(hasSubs ? [line("subs", "", "Subcontractors", fmtMoney(result.subTotal))] : []),
    line("cost", "=", "Cost", fmtMoney(result.cost)),
    line("overhead", "+", withPct("Overhead", setup.overhead_pct), fmtMoney(result.overhead)),
    line("profit", "+", withPct("Profit", setup.profit_pct), fmtMoney(result.profit)),
    ...(ownMarkup
      ? [line("subMarkup", "+", "Subcontractor markup", fmtMoney(result.subMarkup))]
      : []),
    line("price", "=", "Price", fmtMoney(result.price), { strong: true }),
    line("hours", "", "Labor hours", unitWords(result.hours, "hour")),
    line(
      "days",
      "",
      result.crewDays == null || crew == null
        ? "Working days for the crew"
        : `Working days for a crew of ${fmtAmount(crew)}`,
      fmtDays(result.crewDays),
      {
        hint:
          result.crewDays == null
            ? "Type the people on the crew and the hours in a working day to see this."
            : null,
      },
    ),
    line(
      "margin",
      "",
      "Margin",
      result.marginPct == null ? "—" : `${fmtAmount(result.marginPct)}% of the price`,
    ),
  ];
}

/**
 * The note under the totals when overhead and profit were NOT worked on the whole cost: a sub
 * line with a markup of its own stands apart from them (trade-bid.ts). Without it, "Overhead
 * (15%) $558.38" under a cost of $4,322.55 looks like a mistake. Null when they were worked on
 * the whole cost, which is every bid with no such line.
 */
export const markupBaseNote = (result: TradeResult): string | null =>
  result.markupBase !== result.cost
    ? `Overhead and profit are worked on ${fmtMoney(result.markupBase)}: every cost except the subcontractor lines that carry their own markup.`
    : null;

/** The notice above an unfinished price. */
export const problemsNotice = (count: number): string =>
  `${count} ${count === 1 ? "line is" : "lines are"} missing a number, so the price is not complete yet.`;

// ── The job's words ────────────────────────────────────────────────────────────────────────────

/** The bid screen's heading: the job name, or what kind of bid it is. */
export function bidHeading(input: { name: string; tradeName: string; isNew: boolean }): string {
  const name = input.name.trim();
  if (name) return name;
  const trade = input.tradeName.trim() || "trade";
  return input.isNew ? `New ${trade} bid` : `${trade} bid`;
}

/** The boxes of the customer block a trade bid types. */
export type CustomerField = "projectAddress" | "jobCity" | "jobState" | "jobZip" | "estimatorName";

/**
 * Type into one box of the customer block. The boxes a block may leave out (city, state, zip,
 * estimator) go back to "not there" when cleared, so typing a letter and deleting it is not a
 * change to save. The street is always text.
 */
export function setCustomerField(
  customer: TradeCustomer,
  field: CustomerField,
  text: string,
): TradeCustomer {
  if (field === "projectAddress") return { ...customer, projectAddress: text };
  return { ...customer, [field]: text === "" ? undefined : text };
}

/** The customer block as it is sent: the four boxes it always has, and any other that holds text. */
export type SentCustomer = {
  name: string;
  contact: string;
  projectAddress: string;
  notes: string;
} & Record<string, string>;

/**
 * The customer block as Save sends it. A box cleared on screen is "not there" (see
 * setCustomerField); it is left out of what is sent rather than sent as nothing, so the server
 * stores the same block the screen compares against.
 */
export function customerToSend(customer: TradeCustomer): SentCustomer {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(customer)) if (value !== undefined) out[key] = value;
  return {
    ...out,
    name: customer.name,
    contact: customer.contact,
    projectAddress: customer.projectAddress,
    notes: customer.notes,
  };
}

/**
 * The picked property's address put into a job address that is still blank. Anything already
 * typed in any of the four boxes is left alone: the job may be at another address.
 */
export function fillJobAddress(
  customer: TradeCustomer,
  site: {
    address1: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  },
): TradeCustomer {
  const typed = [customer.projectAddress, customer.jobCity, customer.jobState, customer.jobZip];
  if (typed.some((t) => (t ?? "").trim())) return customer;
  let next = customer;
  if (site.address1?.trim()) next = setCustomerField(next, "projectAddress", site.address1.trim());
  if (site.city?.trim()) next = setCustomerField(next, "jobCity", site.city.trim());
  if (site.state?.trim()) next = setCustomerField(next, "jobState", site.state.trim());
  if (site.zip?.trim()) next = setCustomerField(next, "jobZip", site.zip.trim());
  return next;
}
