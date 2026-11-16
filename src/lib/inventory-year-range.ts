/**
 * Inventory › Year end, the words and small sums of the screen (owner, Nov 16: "as far as
 * reporting for EOY stuff, is it as efficient and good as it could be especially with the
 * reconciliation part").
 *
 * The numbers are the server's (inventory-cost.ts has the cost rules, inventory-year-end.ts the
 * shapes). What is here is everything the screen (components/inventory-year-end-tab.tsx) would
 * otherwise decide inline, kept apart so each piece is tested without a browser:
 *
 *  - the period: "This year" and "Last year" as calendar years, a From after a To said in
 *    words, and the title of the Totals card;
 *  - the Totals card as an ordered list of lines with their signs, so the screen only maps them
 *    and a bookkeeper can add them up: opening + received + put in from jobs + opening stock
 *    − used on jobs − damaged ± count corrections ± other ± revalued = closing;
 *  - which optional columns the item tables show;
 *  - the sentences of the warnings (one item or many) and of an entry that needs a price.
 *
 * The readers are roofing office staff, not accountants or programmers: every sentence here is
 * one they read, so it says "inventory", "average cost" and "price paid", and nothing about how
 * the numbers are worked out.
 *
 * Pure: no React, no clock (today is handed in), no database.
 */
import { FIELD_DAY_TZ } from "@/lib/field-day";
import {
  cents,
  FLOW_INFO,
  fmtDollars,
  fmtUnitCost,
  parsePrice,
  type Amounts,
  type CostSource,
  type FlowKey,
} from "@/lib/inventory-cost";
import type { Dollars, YearEndGroup } from "@/lib/inventory-year-end";

// ── The period ─────────────────────────────────────────────────────────────────────────────────

export interface YearRange {
  from: string;
  to: string;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar year: January 1 to December 31, both included. */
export function yearRange(year: number): YearRange {
  const y = String(year).padStart(4, "0");
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/**
 * The year `today` (YYYY-MM-DD) falls in. Today is the OFFICE's day (inventory-year-end.ts
 * officeToday), so at 10 pm on New Year's Eve "This year" is still the year being closed.
 */
export const thisYear = (today: string): YearRange => yearRange(Number(today.slice(0, 4)));
/** The year before the one `today` falls in. */
export const lastYear = (today: string): YearRange => yearRange(Number(today.slice(0, 4)) - 1);

/** The year, month (1–12) and day of a real calendar day; null for anything else. */
function partsOf(ymd: string): { y: number; m: number; d: number } | null {
  const hit = YMD.exec(ymd);
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  // February 30 has the right shape and is not a day: UTC arithmetic would roll it into March.
  const back = new Date(Date.UTC(y, m - 1, d));
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d)
    return null;
  return { y, m, d };
}

export const RANGE_INCOMPLETE = "Pick a From and a To date";
/** The server's own words (inventory-year-end.ts buildYearEnd), so both say the same thing. */
export const RANGE_BACKWARDS = "From must be on or before To";

/**
 * What is wrong with a From..To, in words, or null when it is a period. A date box that was
 * emptied hands back "", which the server would refuse with a programmer's message, so it is
 * caught here and nothing is asked of the server.
 */
export function rangeProblem(from: string, to: string): string | null {
  if (!partsOf(from) || !partsOf(to)) return RANGE_INCOMPLETE;
  return from > to ? RANGE_BACKWARDS : null;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "January 1, 2026" from "2026-01-01", from the digits themselves. A Date would read the text as
 * midnight UTC and print it in the reader's own time zone: December 31 for anyone west of
 * Greenwich, on the one screen where the day of the year matters most. Anything that is not a
 * day comes back as it was given.
 */
export function longDate(ymd: string): string {
  const p = partsOf(ymd);
  return p ? `${MONTHS[p.m - 1] ?? ""} ${p.d}, ${p.y}` : ymd;
}

/** "Oct 27, 2026" from "2026-10-27", the same way (a purchase order's day). */
export function shortDate(ymd: string): string {
  const p = partsOf(ymd.slice(0, 10));
  return p ? `${(MONTHS[p.m - 1] ?? "").slice(0, 3)} ${p.d}, ${p.y}` : ymd;
}

/** "January 1, 2026 to December 31, 2026"; one date when the period is a single day. */
export const periodTitle = (from: string, to: string): string =>
  from === to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`;

const officeDay = new Intl.DateTimeFormat("en-US", {
  timeZone: FIELD_DAY_TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});
/**
 * "Oct 28, 2026": the day an entry was made, in the office's time zone. This one IS an instant
 * (a time stamp), so it goes through the office's clock: an entry made at 10:30 pm belongs to
 * that evening, not to the next day as UTC has it.
 */
export const entryDate = (iso: string): string => officeDay.format(new Date(iso));

// ── The Totals card ────────────────────────────────────────────────────────────────────────────

export type TotalKey = keyof Dollars | "rounding";

export interface TotalLine {
  key: TotalKey;
  title: string;
  /** A sentence under the title (and its hover note) saying what the line holds. */
  help: string;
  /**
   * What a bookkeeper does with the amount: add it, take it off, or (blank) add it as printed,
   * minus sign and all. "=" is the answer line.
   */
  sign: "+" | "−" | "" | "=";
  amount: number;
  /** False for a line that is only printed when it has a number and has none. */
  show: boolean;
}

export const OPENING_HELP = "What inventory was worth at the start of the period.";
export const CLOSING_HELP = "What inventory was worth at the end of the period.";
export const REVALUED_HELP =
  "Stock came in while an item was at or below zero, so its average cost started again at the new price. This line is the value that moved because of that.";
export const ROUNDING_HELP =
  "Each line is rounded to the cent by itself, so together they can come to a cent or two more or less than the closing value. This line is that difference.";

const inCents = (n: number): number => Math.round(cents(n) * 100);

/**
 * The lines of the Totals card, top to bottom. Received, put in from jobs, used, damaged and
 * count corrections are always printed, zero or not, so a quiet year still reads as a complete
 * sum; opening stock, other and revalued are rare and would only be noise at zero.
 *
 * "Rounding" is this file's own line, and almost never shown. The server rounds every line to
 * the cent separately (10.004 + 5.004 = 15.008 arrives as 10.00, 5.00 and 15.01), so the printed
 * lines can miss the printed closing value by a cent. A bookkeeper who adds the card up must
 * land on the closing value, so the missing cent is printed instead of left to be found.
 */
export function totalLines(d: Dollars): TotalLine[] {
  const flow = (key: FlowKey, sign: TotalLine["sign"], always: boolean): TotalLine => ({
    key,
    title: FLOW_INFO[key].title,
    help: FLOW_INFO[key].help,
    sign,
    amount: d[key],
    show: always || inCents(d[key]) !== 0,
  });
  const explained =
    inCents(d.opening) +
    inCents(d.received) +
    inCents(d.fromJobs) +
    inCents(d.openingStock) -
    inCents(d.used) -
    inCents(d.damaged) +
    inCents(d.counted) +
    inCents(d.other) +
    inCents(d.revalued);
  const gap = (inCents(d.closing) - explained) / 100;
  return [
    {
      key: "opening",
      title: "Opening stock value",
      help: OPENING_HELP,
      sign: "",
      amount: d.opening,
      show: true,
    },
    flow("received", "+", true),
    flow("fromJobs", "+", true),
    flow("openingStock", "+", false),
    // Used and damaged arrive as positive amounts that come OFF the stock (FLOW_INFO sign −1).
    flow("used", "−", true),
    flow("damaged", "−", true),
    // A count can find more or less than expected: the amount carries its own sign.
    flow("counted", "", true),
    flow("other", "", false),
    {
      key: "revalued",
      title: "Revalued",
      help: REVALUED_HELP,
      sign: "",
      amount: d.revalued,
      show: inCents(d.revalued) !== 0,
    },
    {
      key: "rounding",
      title: "Rounding",
      help: ROUNDING_HELP,
      sign: "",
      amount: gap,
      show: gap !== 0,
    },
    {
      key: "closing",
      title: "Closing stock value",
      help: CLOSING_HELP,
      sign: "=",
      amount: d.closing,
      show: true,
    },
  ];
}

// ── The item tables ────────────────────────────────────────────────────────────────────────────

export interface OptionalColumns {
  openingStock: boolean;
  other: boolean;
  revalued: boolean;
}

/**
 * Which of the rare columns the item tables show: one only when some row of the WHOLE report has
 * a number in it, so every category's table has the same columns and they line up down the page.
 * A quantity with no dollars counts too (opening stock that nobody priced is still stock).
 */
export function visibleColumns(groups: readonly YearEndGroup[]): OptionalColumns {
  const out: OptionalColumns = { openingStock: false, other: false, revalued: false };
  for (const g of groups)
    for (const r of g.rows) {
      if (r.qty.openingStock !== 0 || r.dollars.openingStock !== 0) out.openingStock = true;
      if (r.qty.other !== 0 || r.dollars.other !== 0) out.other = true;
      if (r.dollars.revalued !== 0) out.revalued = true;
    }
  return out;
}

export interface YearColumn {
  key: keyof Dollars;
  title: string;
  /** The hover note on the column's heading. */
  help: string;
  /** The quantity carries a + or − (a correction can go either way). */
  signed: boolean;
}

/** Revalued is dollars only: no stock moved, its value did. */
export const hasQty = (key: keyof Dollars): key is keyof Amounts => key !== "revalued";

/** The quantity-and-dollars columns of an item table, in the order of the Totals card. */
export function tableColumns(show: OptionalColumns): YearColumn[] {
  const flow = (key: FlowKey, title: string, signed = false): YearColumn => ({
    key,
    title,
    help: FLOW_INFO[key].help,
    signed,
  });
  const all: (YearColumn | null)[] = [
    {
      key: "opening",
      title: "Opening",
      help: "On hand at the start of the period.",
      signed: false,
    },
    flow("received", "Received"),
    flow("fromJobs", "From jobs"),
    show.openingStock ? flow("openingStock", "Opening stock") : null,
    flow("used", "Used"),
    flow("damaged", "Damaged"),
    flow("counted", "Count", true),
    show.other ? flow("other", "Other", true) : null,
    show.revalued
      ? { key: "revalued", title: "Revalued", help: REVALUED_HELP, signed: false }
      : null,
    { key: "closing", title: "Closing", help: "On hand at the end of the period.", signed: false },
  ];
  return all.filter((c): c is YearColumn => c !== null);
}

/** "TPO 60 mil · White"; the item alone when it has no colour. */
export const itemName = (item: string, colour: string): string =>
  colour ? `${item} · ${colour}` : item;

/**
 * A quantity for a table: three decimals at most, a real minus sign, and a plus on a correction
 * that added stock (so "+2" and "−2" cannot be mistaken for each other at a glance).
 */
export function qtyText(n: number, signed = false): string {
  const r = Math.round(n * 1000) / 1000;
  const abs = Math.abs(r).toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (r < 0) return `−${abs}`;
  return signed && r > 0 ? `+${abs}` : abs;
}

// ── The warnings ───────────────────────────────────────────────────────────────────────────────

/** The word for one or for many: plural(1, "entry", "entries") is "entry". */
export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The warnings in the order they are shown; each is a key of the server's `counts`. */
export const WARNING_KINDS = ["needsPrice", "unknown", "belowZero"] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];

/**
 * A warning's sentence, grammatical for one or for many ("1 entry … Its numbers", "2 entries …
 * Their numbers"): a count of one is common here, and "1 entries" reads as a mistake on a page
 * whose whole job is to be trusted.
 *
 * `nothingToPrice`: an item can have no cost with no entry to price (stock was taken out before
 * any came in). The list "below" is then not on the page, so the sentence must not send the
 * reader looking for it; the Setup cost is what gives such an item a cost.
 */
export function warningText(
  kind: WarningKind,
  n: number,
  opts: { nothingToPrice?: boolean } = {},
): string {
  const one = n === 1;
  if (kind === "needsPrice")
    return `${n} ${plural(n, "entry", "entries")} came in with no price typed. ${one ? "Its" : "Their"} numbers are estimates until someone types what was paid, below.`;
  if (kind === "unknown") {
    const fix = opts.nothingToPrice
      ? `Give ${one ? "it" : "each one"} a cost in Setup.`
      : `Type a price on ${one ? "its" : "their"} entries below.`;
    return `${n} ${plural(n, "item has", "items have")} no cost at all, so ${one ? "it is" : "they are"} left out of the dollars. ${fix}`;
  }
  return `${n} ${plural(n, "item is", "items are")} below zero at the end of this period. Count ${one ? "it" : "them"} before relying on these numbers.`;
}

// ── An entry that needs a price ────────────────────────────────────────────────────────────────

/** "per box"; a unit of "each" reads "each" ("$0.09 each", not "$0.09 per each"). */
export function perUnit(unit: string): string {
  const u = unit.trim();
  return !u || /^(each|ea)$/i.test(u) ? "each" : `per ${u}`;
}

/** A cost for one unit, on screen: "$98.75", "$0.0915"; a dash when there is none. */
export const unitDollars = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `$${fmtUnitCost(n)}`;

/**
 * Where the cost used meanwhile came from. Only the first three reach the screen: an entry is on
 * the list because its cost is NOT a price typed or a job's own material, but the type allows
 * all five, so all five have words.
 */
export function sourceWords(source: CostSource): string {
  if (source === "average") return "the item's average cost";
  if (source === "setup") return "the Setup cost";
  if (source === "none") return "nothing, no cost is known";
  return source === "paid" ? "the price typed" : "what the job's material cost";
}

/** "Used meanwhile: $95.00 per bundle, the item's average cost". */
export function usedMeanwhile(unitCost: number | null, unit: string, source: CostSource): string {
  if (unitCost == null || source === "none") return `Used meanwhile: ${sourceWords("none")}`;
  return `Used meanwhile: ${unitDollars(unitCost)} ${perUnit(unit)}, ${sourceWords(source)}`;
}

/** The most the server takes for one unit (inventory-cost.functions.ts priceSchema). */
export const PRICE_MAX = 1_000_000;

/**
 * The price in the box when Save may send it, else null: a number at or above zero (free stock
 * is a price) and not above what the server takes.
 */
export function priceToSave(text: string): number | null {
  const n = parsePrice(text);
  return n != null && n <= PRICE_MAX ? n : null;
}

/**
 * What to say under the box, or null. A blank box says nothing: it starts blank, and a scolding
 * before anything is typed teaches people to ignore the red line.
 */
export function priceProblem(text: string): string | null {
  if (!text.trim()) return null;
  const n = parsePrice(text);
  if (n == null) return "Type the price in dollars, like 12.50";
  // The likeliest way to get here is typing the purchase order's total into a per-unit box.
  return n > PRICE_MAX
    ? "That is over $1,000,000. Type the price of one unit, not of the whole order."
    : null;
}

/**
 * What the typed price comes to for the whole entry (the "= $900.00 for 10 boxes" under the
 * box), to the cent; null until the box holds a price that can be saved. It is there so a
 * person can hold it against the invoice in their hand before saving.
 */
export function lineTotal(priceText: string, qty: number): number | null {
  const price = priceToSave(priceText);
  return price == null || !Number.isFinite(qty) ? null : cents(price * qty);
}

/** "PO 4411 · ABC Supply · $1,250.50 · Oct 27, 2026"; a vendor that is blank is left out. */
export function poLine(po: {
  po_number: string;
  vendor: string;
  price: number;
  po_date: string;
}): string {
  return [`PO ${po.po_number}`, po.vendor.trim(), fmtDollars(po.price), shortDate(po.po_date ?? "")]
    .filter(Boolean)
    .join(" · ");
}
