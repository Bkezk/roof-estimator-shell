/**
 * The Owner view's Business tab (owner, Oct 8: "From an owner perspective is there any data
 * that would be useful to see on work overview?"): the money and the pipeline, which the People
 * tab never showed, and what is going stale. Pure: the server (owner-business.functions.ts)
 * hands in plain rows and the viewer's day; everything here is arithmetic, so it is tested
 * without a database. Money is read from the invoices as they stand — nothing is estimated.
 */
import { OPEN_OPP_STATUSES } from "@/lib/work-counts";

export interface BizTicket {
  stage: string;
  /** When the ticket reached its stage (the Done queue's age). */
  stage_changed_at: string | null;
  scheduled_date: string | null;
  invoice_id?: string | null;
}
export interface BizInvoice {
  status: string;
  total: number | string | null;
  invoice_date: string | null;
}
export interface BizPo {
  approved: boolean | null;
  price: number | string | null;
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
  tickets: readonly BizTicket[];
  invoices: readonly BizInvoice[];
  pos: readonly BizPo[];
  opps: readonly BizOpp[];
  /** Open follow-ups snoozed past now. */
  snoozed: number;
  /** crm_untouched(): items past Setup's untouched limits, by kind; null when the rpc is absent. */
  untouched: { tickets: number; opps: number } | null;
}

export interface MoneyTile {
  count: number;
  total: number;
  /** Days since the oldest item entered the queue; null when the queue is empty. */
  oldestDays: number | null;
}

export interface BusinessNumbers {
  today: string;
  at: string;
  /** Done tickets with no invoice yet (still to be authorized, then invoiced). */
  toInvoice: { count: number; oldestDays: number | null };
  /** Final or sent invoices not marked paid. */
  unpaid: MoneyTile;
  /** Invoices dated this month and last (final, sent or paid — never drafts or voids). */
  invoiced: {
    month: { count: number; total: number };
    lastMonth: { count: number; total: number };
  };
  /** Purchase orders waiting for approval. */
  pos: { count: number; total: number };
  pipeline: {
    open: { count: number; value: number };
    closingThisMonth: { count: number; value: number };
    /** Won / Lost whose last update fell in this month (the closest the rows come to a close date). */
    wonThisMonth: number;
    lostThisMonth: number;
  };
  stale: {
    /** Open / Scheduled tickets past their scheduled day. */
    pastDue: number;
    untouchedTickets: number | null;
    untouchedOpps: number | null;
    snoozed: number;
  };
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
/** The month before `today`'s. */
export function lastMonthRange(today: string): { start: string; end: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  return monthRange(prev);
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
 * The tile's queue: Done tickets with no invoice — the ones still to be reviewed (Authorized) and
 * invoiced. Not the Invoices page's "Awaiting invoice" chip, which lists the Authorized tickets
 * (service-schedule.ts toInvoice; M9, owner Oct 5), so the tile links to the Done tickets
 * themselves (BUSINESS_HREFS.toInvoice).
 */
export const TO_INVOICE_STAGES: readonly string[] = ["done"];
export const UNPAID_STATUSES: readonly string[] = ["final", "sent"];
export const BILLED_STATUSES: readonly string[] = ["final", "sent", "paid"];

export function businessNumbers(i: BusinessIn): BusinessNumbers {
  const month = monthRange(i.today);
  const lastMonth = lastMonthRange(i.today);
  const waiting = i.tickets.filter((t) => TO_INVOICE_STAGES.includes(t.stage) && !t.invoice_id);
  const unpaid = i.invoices.filter((v) => UNPAID_STATUSES.includes(v.status));
  const billed = i.invoices.filter((v) => BILLED_STATUSES.includes(v.status));
  const sumBy = <T>(rows: readonly T[], f: (r: T) => number) =>
    round2(rows.reduce((s, r) => s + f(r), 0));
  const monthOf = (r: { start: string; end: string }) => {
    const rows = billed.filter((v) => inRange(v.invoice_date, r));
    return { count: rows.length, total: sumBy(rows, (v) => num(v.total)) };
  };
  const pos = i.pos.filter((p) => !p.approved);
  const openOpps = i.opps.filter((o) =>
    (OPEN_OPP_STATUSES as readonly string[]).includes(o.status),
  );
  const closing = openOpps.filter((o) => inRange(o.expected_close, month));
  const pastDue = i.tickets.filter(
    (t) =>
      (t.stage === "open" || t.stage === "scheduled") &&
      !!t.scheduled_date &&
      t.scheduled_date < i.today,
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
    unpaid: {
      count: unpaid.length,
      total: sumBy(unpaid, (v) => num(v.total)),
      oldestDays: oldest(
        unpaid.map((v) => v.invoice_date),
        i.now,
      ),
    },
    invoiced: { month: monthOf(month), lastMonth: monthOf(lastMonth) },
    pos: { count: pos.length, total: sumBy(pos, (p) => num(p.price)) },
    pipeline: {
      open: { count: openOpps.length, value: sumBy(openOpps, (o) => num(o.est_value)) },
      closingThisMonth: { count: closing.length, value: sumBy(closing, (o) => num(o.est_value)) },
      wonThisMonth: i.opps.filter((o) => o.status === "won" && inRange(o.updated_at, month)).length,
      lostThisMonth: i.opps.filter((o) => o.status === "lost" && inRange(o.updated_at, month))
        .length,
    },
    stale: {
      pastDue,
      untouchedTickets: i.untouched ? i.untouched.tickets : null,
      untouchedOpps: i.untouched ? i.untouched.opps : null,
      snoozed: i.snoozed,
    },
  };
}

/** Where each tile goes: the list already filtered to what the tile counts. */
export const BUSINESS_HREFS = {
  // The Done tickets the tile counts (the Awaiting invoice queue holds the Authorized ones).
  toInvoice: "/service?stage=done",
  unpaid: "/service/invoices?status=unpaid",
  invoiced: "/service/invoices",
  pipeline: "/opportunities?status=allopen",
  pos: "/service?stage=openwork",
  pastDue: "/service?overdue=1",
  untouched: "/my-work?bucket=overdue",
  snoozed: "/my-work",
} as const;

export const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
/** "$0" never shows for an empty queue: the tile reads "—" (owner: blank, never a 0). */
export const money = (n: number, count: number): string => (count === 0 ? "—" : USD.format(n));
