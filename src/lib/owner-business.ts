/**
 * The Owner view's Business tab (owner, Oct 8: "From an owner perspective is there any data
 * that would be useful to see on work overview?"): the money and the pipeline, which the People
 * tab never showed, and what is going stale. Pure: the server (owner-business.functions.ts)
 * hands in plain rows and the viewer's day; everything here is arithmetic, so it is tested
 * without a database. Money is read from the invoices as they stand — nothing is estimated.
 */
import { OPEN_OPP_STATUSES, isOverdueTicket } from "@/lib/work-counts";

export interface BizTicket {
  /** The row's id — needed to tell a ticket whose follow-up is on hold (`heldTickets`). */
  id?: string;
  stage: string;
  /** When the ticket reached its stage (the Authorized and Done queues' ages). */
  stage_changed_at: string | null;
  scheduled_date: string | null;
  invoice_id?: string | null;
  /** Null: nobody's — Unassigned on Work Overview, never Past due (owner, Oct 12, item 6). */
  technician_id?: string | null;
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
  /**
   * Tickets whose follow-up is on hold today (work-counts.ts heldTicketIds): left out of Past due,
   * as Work Overview files them under Waiting (owner, Oct 12, item 6). Absent: nothing is held.
   */
  heldTickets?: ReadonlySet<string>;
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
  /**
   * Authorized tickets with no invoice yet (owner, Oct 12, item 6) — the set Work Overview's
   * "Authorized — to invoice" group and the Invoices page's Awaiting invoice badge show. Aged from
   * when they reached Authorized (stage_changed_at).
   */
  toInvoice: { count: number; oldestDays: number | null };
  /** Done tickets waiting to be authorized (the tile's second line), aged the same way. */
  toAuthorize: { count: number; oldestDays: number | null };
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
    /**
     * Open / Scheduled tickets with a technician past their scheduled day, whose follow-up is not
     * on hold (work-counts.ts isOverdueTicket + heldTicketIds) — the Overdue tickets tile's rule.
     */
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
 * The tile's queue (owner, Oct 12, item 6): Authorized tickets with no invoice — the Invoices
 * page's "Awaiting invoice" queue (service-schedule.ts toInvoice; M9, owner Oct 5) and Work
 * Overview's "Authorized — to invoice" group, so the tile links there (BUSINESS_HREFS.toInvoice).
 * Until Oct 12 it counted the Done tickets, which the Awaiting invoice badge never showed.
 */
export const TO_INVOICE_STAGES: readonly string[] = ["authorized"];
/** The tile's second line: Done tickets still to be reviewed (Work Overview's Needs authorization). */
export const TO_AUTHORIZE_STAGES: readonly string[] = ["done"];
export const UNPAID_STATUSES: readonly string[] = ["final", "sent"];
export const BILLED_STATUSES: readonly string[] = ["final", "sent", "paid"];

export function businessNumbers(i: BusinessIn): BusinessNumbers {
  const month = monthRange(i.today);
  const lastMonth = lastMonthRange(i.today);
  const waiting = i.tickets.filter((t) => TO_INVOICE_STAGES.includes(t.stage) && !t.invoice_id);
  const reviewing = i.tickets.filter((t) => TO_AUTHORIZE_STAGES.includes(t.stage) && !t.invoice_id);
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
  // The one "overdue ticket" rule — the Overdue tickets tile's (owner, Oct 12, items 6 and 11):
  // Open / Scheduled past its day, with a technician (one without is Unassigned, not overdue),
  // not on hold (a held follow-up waits); a Done ticket is waiting to be invoiced, never overdue.
  const held = i.heldTickets ?? new Set<string>();
  const pastDue = i.tickets.filter(
    (t) => isOverdueTicket(t, i.today) && !(t.id !== undefined && held.has(t.id)),
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
    toAuthorize: {
      count: reviewing.length,
      oldestDays: oldest(
        reviewing.map((t) => t.stage_changed_at),
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
  // The Authorized tickets the tile counts: the Invoices page's Awaiting invoice queue.
  toInvoice: "/service/invoices?tab=to-invoice",
  unpaid: "/service/invoices?status=unpaid",
  invoiced: "/service/invoices",
  pipeline: "/opportunities?status=allopen",
  pos: "/service?stage=openwork",
  pastDue: "/service?overdue=1",
  // The untouched items have no list page of their own: each page's "Needs action" strip
  // (components/crm/contact-log.tsx NeedsActionStrip) lists them at the top, and the Service
  // and Opportunities pages take no filter for it, so the links open those pages (owner, Oct 12,
  // item 6; until then both pointed at Work Overview's Overdue group, which is another set).
  untouchedTickets: "/service",
  untouchedOpps: "/opportunities",
  snoozed: "/my-work",
} as const;

export const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
/** "$0" never shows for an empty queue: the tile reads "—" (owner: blank, never a 0). */
export const money = (n: number, count: number): string => (count === 0 ? "—" : USD.format(n));
