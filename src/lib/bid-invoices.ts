/**
 * Invoices on a trade bid, the rules (owner, Nov 17: "Go with option 1, T-1001 format"; on a
 * deposit and a final: "im not sure on that yet").
 *
 * An invoice belongs to a service ticket or to a won trade bid (invoices.bid_id,
 * 20261117090000). A trade bid has no ticket number, so the first time it is invoiced it takes a
 * job number of its own from a series that starts at 1001 (bids.trade_number), shown "T-1001".
 * Its invoices are numbered as a ticket's are: the first is the bare job number, further live
 * ones take the lowest free slot, "T-1001.2", "T-1001.3" (invoice-numbering.ts).
 *
 * Whether a job gets one invoice or a deposit and a final is left open on purpose: each new
 * invoice starts at what the bid has left to bill, so one invoice bills it all and a second is
 * only ever the remainder.
 *
 * Pure: no database, no clock. The server functions are in bid-invoices.functions.ts.
 */
import { nextInvoiceNumber, type NumberedInvoice } from "@/lib/invoice-numbering";

export const TRADE_NUMBER_PREFIX = "T-";

/** A trade bid's job number as people see it: 1001 is "T-1001". */
export const tradeJobLabel = (tradeNumber: number): string =>
  `${TRADE_NUMBER_PREFIX}${tradeNumber}`;

/** Is this invoice number a trade job's ("T-1001", "T-1001.2")? */
export const isTradeInvoiceNumber = (display: string | null | undefined): boolean =>
  /^T-\d+(\.\d+)?$/.test((display ?? "").trim());

/**
 * The number for a new invoice on trade job `tradeNumber`, given the bid's invoices: the lowest
 * slot no live invoice holds. A voided invoice frees its slot, as on a ticket.
 */
export function nextBidInvoiceNumber(
  tradeNumber: number,
  invoices: readonly NumberedInvoice[],
): string {
  const plain = invoices.map((inv) => ({
    status: inv.status ?? null,
    // Only this job's own numbers hold a slot; a legacy integer never belongs to a trade job.
    display_number: (inv.display_number ?? "").trim().startsWith(TRADE_NUMBER_PREFIX)
      ? (inv.display_number ?? "").trim().slice(TRADE_NUMBER_PREFIX.length)
      : "",
    number: null,
  }));
  return `${TRADE_NUMBER_PREFIX}${nextInvoiceNumber(tradeNumber, plain)}`;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * What the bid has left to bill: its price less what its live invoices bill before sales tax
 * (their subtotals). A voided invoice bills nothing. Never below zero: a job billed past its
 * price has nothing left, it does not owe a credit.
 */
export function unbilledAmount(
  price: number,
  invoices: readonly { status: string; subtotal: number }[],
): number {
  const billed = invoices
    .filter((i) => i.status !== "void")
    .reduce((sum, i) => sum + (Number.isFinite(i.subtotal) ? i.subtotal : 0), 0);
  return Math.max(0, cents(price - billed));
}

/** One of a bid's invoices, as the bid screen lists them. */
export interface BidInvoiceRow {
  id: string;
  /** "T-1001", "T-1001.2". */
  display_number: string;
  status: string;
  invoice_date: string;
  /** Before sales tax. */
  subtotal: number;
  total: number;
  paid_amount: number;
}

/** What the bid screen's Invoices block needs (listBidInvoices). */
export interface BidInvoicesResult {
  /**
   * May this person make and see invoices (an admin, a manager, the Invoices tick)? When false
   * the block is not shown and `invoices` is empty.
   */
  allowed: boolean;
  /** "T-1001" once the bid has been invoiced; null before. */
  job_label: string | null;
  invoices: BidInvoiceRow[];
  /** The bid's price less its live invoices' subtotals. */
  unbilled: number;
}

/** The trade bid an invoice belongs to, as the invoice page shows it (getInvoice). */
export interface InvoiceBidRef {
  id: string;
  /** The bid's job name; "" when this person may not read bids (no Estimate access). */
  name: string;
  /** "Painting"; "" when not readable. */
  trade_name: string;
  /** "T-1001". */
  job_label: string;
  account_id: string | null;
  /** May this person open the bid (Estimate access)? The page links to it only then. */
  readable: boolean;
  /**
   * Set when the invoice belongs to a Roof Care plan year, not a trade bid (Nov 19;
   * invoices.roof_care_plan_id). Then `id` is the plan's, `job_label` is "RC-1001", `trade_name`
   * is "Roof Guard plan" and `name` is the property's. The page links to the property and
   * offers none of the bid's own buttons.
   */
  plan?: { site_id: string };
}

/** createBidInvoice's refusals, in plain words. */
export const BID_INVOICE_NEEDS_WON = "Mark the bid Won before invoicing it.";
export const BID_INVOICE_NOT_TRADE = "Only a trade bid is invoiced from the bid.";
export const BID_INVOICE_NOTHING_LEFT =
  "This bid is billed in full. Void an invoice first if it was made by mistake.";
