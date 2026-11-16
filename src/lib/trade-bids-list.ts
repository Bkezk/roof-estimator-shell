/**
 * The Trade Bids list, the rules (owner, Nov 16: "Put it under estimate pricing and have it
 * similar to project bids, listing the info on the bids then have a new button trade bids that
 * pops up two options, a dropdown of the existing types of bids (painting etc) or starting a
 * new one." … "I don't want that list combined with project bids").
 *
 * What the screen (components/trade/trade-bids-list.tsx) shows is decided here, so it can be
 * tested without a browser: whose name stands as the customer, what the search box finds, which
 * trades the filter offers, and the grouping Draft → Submitted → Won → Lost with each group's
 * count and total, the way Project Bids groups its own list.
 *
 * Pure: no database, no clock, no React. Each function asks only for the columns it reads, so
 * it works on a list row (trade-bids.functions.ts TradeBidListRow) and on a plain test row alike.
 */
import { BID_STATUSES, asBidStatus, type BidStatus } from "@/lib/bid-status";

/** The columns of a list row these rules read (a TradeBidListRow has them all). */
export interface TradeListRow {
  id: string;
  name: string;
  status: string;
  grand_total: number;
  updated_at: string;
  /** The linked customer profile, or null. */
  account: { id: string; name: string } | null;
  /** The customer's name as typed on the bid. */
  typed_customer: string;
  estimator_name: string;
  /** "Painting": the trade the bid was started from. */
  trade_name: string;
}

const clean = (s: string | null | undefined): string => (s ?? "").trim();

/**
 * The bid's customer: the linked customer's name, else the name typed on the bid, else "".
 * The same order Project Bids uses, so one customer never reads two ways on the two lists.
 */
export const customerOf = (row: Pick<TradeListRow, "account" | "typed_customer">): string =>
  clean(row.account?.name) || clean(row.typed_customer);

/**
 * Does the search box find this bid? Every word typed must be somewhere in the job name, the
 * customer, the trade or the estimator, capitals ignored; the words may sit in different places
 * ("maple hill" finds the Maple St job for Hill Property Group). Nothing typed finds every bid.
 */
export function matchesSearch(
  row: Pick<TradeListRow, "name" | "account" | "typed_customer" | "trade_name" | "estimator_name">,
  text: string,
): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // One line per field: a typed word has no line break in it, so it can never be matched by
  // the end of one field running into the start of the next.
  const hay = [row.name, customerOf(row), row.trade_name, row.estimator_name]
    .map((s) => clean(s).toLowerCase())
    .join("\n");
  return words.every((w) => hay.includes(w));
}

/**
 * The Trade filter's choices: each trade that has a bid in the list, once, A to Z. A bid with
 * no trade name adds nothing (it still shows under "All trades").
 */
export function tradeNames(rows: readonly Pick<TradeListRow, "trade_name">[]): string[] {
  const names = new Set<string>();
  for (const r of rows) {
    const name = clean(r.trade_name);
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "en"));
}

/** What the controls above the list are set to. `trade` null (or blank) = all trades. */
export interface TradeListFilter {
  search: string;
  trade: string | null;
}

/** The bids the search box and the Trade filter leave, in the order given. */
export function filterRows<
  T extends Pick<
    TradeListRow,
    "name" | "account" | "typed_customer" | "trade_name" | "estimator_name"
  >,
>(rows: readonly T[], filter: TradeListFilter): T[] {
  const trade = clean(filter.trade);
  return rows.filter(
    (r) => (trade === "" || clean(r.trade_name) === trade) && matchesSearch(r, filter.search),
  );
}

export interface TradeStatusGroup<T> {
  status: BidStatus;
  rows: T[];
  /** How many bids are in the group. */
  count: number;
  /** Their totals added up, to the cent. */
  total: number;
}

/** The moment a row was saved, for ordering; a stamp that will not read sorts as the oldest. */
const savedAt = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * The list in its groups: Draft, Submitted, Won, Lost, in that order (the old program's status
 * words fold into these four — asBidStatus), the newest save first inside each, and each with
 * its count and its total. A group with no bids is left out, as on Project Bids. The list given
 * is not reordered.
 */
export function groupByStatus<
  T extends Pick<TradeListRow, "status" | "grand_total" | "updated_at">,
>(rows: readonly T[]): TradeStatusGroup<T>[] {
  return BID_STATUSES.map((status) => {
    const mine = rows
      .filter((r) => asBidStatus(r.status) === status)
      // By the moment itself, not the text: two stamps written in different time zones still
      // order correctly. Equal moments keep the order they came in (the server's).
      .sort((a, b) => {
        const ta = savedAt(a.updated_at);
        const tb = savedAt(b.updated_at);
        return tb === ta ? 0 : tb > ta ? 1 : -1;
      });
    const sum = mine.reduce((acc, r) => acc + (Number(r.grand_total) || 0), 0);
    return {
      status,
      rows: mine,
      count: mine.length,
      // Rounded once at the end: adding dollars-and-cents on a computer drifts (0.1 + 0.2 is
      // 0.30000000000000004), and a header must not read a cent off.
      total: Math.round(sum * 100) / 100,
    };
  }).filter((g) => g.count > 0);
}

/**
 * The labor hours on a row: "37 hours", "1 hour", "12.5 hours" (one decimal at most). "" when
 * the hours are not known, so the row leaves them out instead of saying 0. A bid whose labor
 * really is nothing reads "0 hours".
 */
export function hoursText(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return "";
  // Rounded first, so "hour" or "hours" follows the number the reader sees (0.96 reads "1 hour").
  const shown = Math.round(hours * 10) / 10;
  return `${shown.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${shown === 1 ? "hour" : "hours"}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days a deleted bid is still kept in "Recently deleted" before it is removed for good: part of
 * a day counts as a day (it is still there), never less than 0. No deletion time on record
 * counts as deleted just now. `nowMs` is passed in so the count can be tested.
 */
export function binDaysLeft(
  deletedAt: string | null | undefined,
  nowMs: number,
  keptDays: number,
): number {
  const parsed = deletedAt ? Date.parse(deletedAt) : NaN;
  const from = Number.isNaN(parsed) ? nowMs : parsed;
  return Math.max(0, Math.ceil((from + keptDays * DAY_MS - nowMs) / DAY_MS));
}
