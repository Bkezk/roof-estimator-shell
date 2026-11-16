/**
 * The Owner view's Business tab (owner, Oct 8: "From an owner perspective is there any data
 * that would be useful to see on work overview?"): the money and the pipeline, which the People
 * tab never showed. Pure: the server (owner-business.functions.ts) hands in plain rows and the
 * viewer's day; everything here is arithmetic, so it is tested without a database.
 *
 * Owner, Nov 16: "if there is something that is on the business tab that is also present on the
 * needs attention list. remove it from the business tab as i dont want double info". Five
 * numbers left this tab that day, each a row of the People tab's Needs attention list
 * (owner-attention.ts): the Done tickets awaiting authorization, the Unpaid tile, tickets past
 * their scheduled day, and the tickets and opportunities untouched past Setup's limit. What
 * stays is what that list does not show: Authorized tickets not invoiced (left off the list as
 * noise, Nov 15), the pipeline, Won / Lost this month, and the follow-ups on hold right now.
 */
import { asBidStatus } from "@/lib/bid-status";
import { awaitsInvoice } from "@/lib/ticket-stage";
import { bidWonDay } from "@/lib/margin-report";
import { localYmd, TASK_TZ } from "@/lib/tasks";
import { OPEN_OPP_STATUSES } from "@/lib/work-counts";

export interface BizTicket {
  stage: string;
  /** When the ticket reached its stage (the Authorized queue's age). */
  stage_changed_at: string | null;
  invoice_id?: string | null;
  /** An inspection ends at Authorized unless it is billed: it never waits for an invoice (Nov 16). */
  service_type?: string | null;
}
/** A won or lost bid (bids; owner, Oct 21: the Won / Lost tile counts bids, not opportunities). */
export interface BizBid {
  status: string;
  won_on: string | null;
  status_changed_at: string | null;
  updated_at: string;
}
export interface BizOpp {
  status: string;
  est_value: number | string | null;
  expected_close: string | null;
  updated_at: string | null;
}

export interface BusinessIn {
  /** The viewer's day, YYYY-MM-DD. */
  today: string;
  /** When the rows were read (ISO). */
  now: string;
  /** The live Authorized tickets. */
  tickets: readonly BizTicket[];
  opps: readonly BizOpp[];
  /** The live won / lost bids (absent in older callers: nothing won or lost). */
  bids?: readonly BizBid[];
  /** Open follow-ups snoozed past now. */
  snoozed: number;
}

export interface BusinessNumbers {
  today: string;
  at: string;
  /**
   * Authorized tickets not invoiced yet (owner, Oct 12, item 6) — the set Work Overview's
   * "Authorized — to invoice" group and the Invoices page's Awaiting invoice badge show. Aged from
   * when they reached Authorized (stage_changed_at).
   */
  toInvoice: { count: number; oldestDays: number | null };
  // No purchase-order tile since Oct 28 (owner: approval is gone; every PO is a cost already).
  // No Unpaid tile and no Done line since Nov 16 (the Needs attention list has them).
  pipeline: {
    open: { count: number; value: number };
    closingThisMonth: { count: number; value: number };
    /** Won / Lost whose last update fell in this month (the closest the rows come to a close date). */
    wonThisMonth: number;
    lostThisMonth: number;
  };
  /** Open follow-ups on hold right now (the one line left of "Going stale"; Nov 16). */
  stale: { snoozed: number };
}

const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

/** "2026-10-08" → the month's first and last day (YYYY-MM-DD). */
export function monthRange(today: string): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}
const inRange = (ymd: string | null | undefined, r: { start: string; end: string }) =>
  !!ymd && ymd.slice(0, 10) >= r.start && ymd.slice(0, 10) <= r.end;

/** Whole days from an ISO instant (or YYYY-MM-DD) to `now`, never below 0. */
export function daysOld(iso: string | null | undefined, now: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((new Date(now).getTime() - t) / 86_400_000));
}
const oldest = (dates: readonly (string | null | undefined)[], now: string): number | null =>
  dates.reduce<number | null>((best, d) => {
    const age = daysOld(d, now);
    return age === null ? best : best === null || age > best ? age : best;
  }, null);

/**
 * The tile's queue (owner, Oct 12, item 6): Authorized tickets with no invoice — the Invoices
 * page's "Awaiting invoice" queue (service-schedule.ts toInvoice; M9, owner Oct 5) and Work
 * Overview's "Authorized — to invoice" group, so the tile links there (BUSINESS_HREFS.toInvoice).
 * Until Oct 12 it counted the Done tickets, which the Awaiting invoice badge never showed.
 */
export const TO_INVOICE_STAGES: readonly string[] = ["authorized"];

export function businessNumbers(i: BusinessIn): BusinessNumbers {
  const month = monthRange(i.today);
  // The Awaiting invoice queue's own rule (ticket-stage.ts awaitsInvoice): Authorized, and not
  // an inspection that ends there. A ticket with a draft still waits — the queue, its badge and
  // Work Overview count it, and until the Nov 16 audit (fix 7) this tile alone did not.
  const waiting = i.tickets.filter(
    (t) =>
      TO_INVOICE_STAGES.includes(t.stage) &&
      awaitsInvoice({
        stage: "authorized",
        service_type: t.service_type,
        invoice_id: t.invoice_id,
      }),
  );
  const sumBy = <T>(rows: readonly T[], f: (r: T) => number) =>
    round2(rows.reduce((s, r) => s + f(r), 0));
  const openOpps = i.opps.filter((o) =>
    (OPEN_OPP_STATUSES as readonly string[]).includes(o.status),
  );
  const closing = openOpps.filter((o) => inRange(o.expected_close, month));
  // Won / Lost this month (owner, Oct 21): BIDS, not opportunities — won by the Won-on day
  // (lib/margin-report.ts bidWonDay: won_on, else the status stamp's office day), lost by the
  // office day the status changed. Opportunities' Won / Lost follow the bid anyway.
  const bids = i.bids ?? [];
  const wonBids = bids.filter(
    (b) => asBidStatus(b.status) === "won" && inRange(bidWonDay(b), month),
  ).length;
  const lostBids = bids.filter(
    (b) =>
      asBidStatus(b.status) === "lost" &&
      inRange(localYmd(new Date(b.status_changed_at || b.updated_at), TASK_TZ), month),
  ).length;
  return {
    today: i.today,
    at: i.now,
    toInvoice: {
      count: waiting.length,
      oldestDays: oldest(
        waiting.map((t) => t.stage_changed_at),
        i.now,
      ),
    },
    pipeline: {
      open: { count: openOpps.length, value: sumBy(openOpps, (o) => num(o.est_value)) },
      closingThisMonth: { count: closing.length, value: sumBy(closing, (o) => num(o.est_value)) },
      wonThisMonth: wonBids,
      lostThisMonth: lostBids,
    },
    stale: { snoozed: i.snoozed },
  };
}

/** Where each tile goes: the list already filtered to what the tile counts. */
export const BUSINESS_HREFS = {
  // The Authorized tickets the tile counts: the Invoices page's Awaiting invoice queue.
  toInvoice: "/service/invoices?tab=to-invoice",
  pipeline: "/opportunities?status=allopen",
  // Won / Lost this month: the bids (owner, Oct 21).
  bids: "/bids",
  snoozed: "/my-work",
} as const;

export const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
/** "$0" never shows for an empty queue: the tile reads "—" (owner: blank, never a 0). */
export const money = (n: number, count: number): string => (count === 0 ? "—" : USD.format(n));
