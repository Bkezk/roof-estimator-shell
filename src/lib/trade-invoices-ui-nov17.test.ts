/**
 * Invoices on a trade bid, the screens (owner, Nov 17: "Go with option 1, T-1001 format"; on a
 * deposit and a final: "im not sure on that yet").
 *
 * Two screens changed. The trade bid's own screen has an Invoices block under its price
 * (bid-invoices-card.tsx), and the invoice page (invoice-editor.tsx) opens an invoice that has
 * no service ticket. Both are drawn to a string here with their answers already in hand, then a
 * few pins on the source for what a string cannot show (a click, a closed menu). There is no
 * browser here, so nothing below presses a button.
 *
 * The same painting job as trade-screens-nov16.test.ts runs through it. Every number was worked
 * out by hand first:
 *
 *   the bid's price                                                         $3,067.12
 *   a deposit invoice T-1001, $1,000.00 before tax, no tax, paid in full    $1,000.00
 *   left to bill      3,067.12 − 1,000.00                                   $2,067.12
 *   the final invoice T-1001.2 bills what is left                           $2,067.12
 *   left to bill      3,067.12 − 1,000.00 − 2,067.12                            $0.00
 *
 *   a payment of $500.00 on the $2,067.12 final invoice does not cover it:
 *   balance due       2,067.12 − 500.00                                     $1,567.12
 *
 *   a voided invoice bills nothing: with T-1001 void, left to bill is the price again.
 */
import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Nothing is loaded or saved: the server wrapper, the sign-in and the router are stand-ins.
// The link stand-in keeps where it goes, so a row's address can be read off the string.
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@tanstack/react-router", () => ({
  useBlocker: () => ({ status: "idle", proceed: () => {}, reset: () => {} }),
  useNavigate: () => () => {},
  Link: (p: {
    to?: string;
    search?: Record<string, unknown>;
    title?: string;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      "a",
      { "data-to": p.to, "data-search": JSON.stringify(p.search ?? {}), title: p.title },
      p.children,
    ),
}));

// The signed-in person, set by each test below.
const auth = vi.hoisted(() => ({
  profile: null as { id: string; full_name: string; role: string } | null,
}));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    session: {},
    profile: auth.profile,
    role: auth.profile?.role ?? null,
    can: () => true,
    loading: false,
    profileFailed: false,
  }),
}));

import { InvoiceEditorPage } from "@/components/service/invoice-editor";
import { invoicePageKey } from "@/components/service/invoice-utils";
import {
  BILLED_IN_FULL,
  BidInvoicesCard,
  NOT_WON,
  SAVE_FIRST,
} from "@/components/trade/bid-invoices-card";
import { TradeBidScreen } from "@/components/trade/trade-bid-screen";
import {
  unbilledAmount,
  type BidInvoiceRow,
  type BidInvoicesResult,
  type InvoiceBidRef,
} from "@/lib/bid-invoices";
import { bidLink } from "@/lib/bid-kind";
import type { InvoiceLineRow, InvoiceRow, InvoiceWithLines } from "@/lib/invoices.functions";
import type { ServiceJobWithTech } from "@/lib/service.functions";
import { emptyCustomer, newTradeBid, type TradeSetup } from "@/lib/trade-bid";
import type { TradeBid, TradeType } from "@/lib/trade-bids.functions";

const BID_ID = "22222222-2222-4222-8222-222222222222";
const TRADE_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const DEPOSIT_ID = "44444444-4444-4444-8444-444444444444";
const FINAL_ID = "55555555-5555-4555-8555-555555555555";
const JOB_ID = "66666666-6666-4666-8666-666666666666";
const TICKET_INVOICE_ID = "77777777-7777-4777-8777-777777777777";

/** The bid's price (trade-screens-nov16.test.ts works it out from the measurements). */
const PRICE = 3067.12;

const row = (over: Partial<BidInvoiceRow> & Pick<BidInvoiceRow, "id">): BidInvoiceRow => ({
  display_number: "T-1001",
  status: "draft",
  invoice_date: "2026-11-17",
  subtotal: 0,
  total: 0,
  paid_amount: 0,
  ...over,
});
/** The deposit: $1,000.00, no tax, paid in full. */
const DEPOSIT = row({
  id: DEPOSIT_ID,
  status: "paid",
  subtotal: 1000,
  total: 1000,
  paid_amount: 1000,
});
/** The final invoice: what the deposit left, 3,067.12 − 1,000.00 = 2,067.12, not paid yet. */
const FINAL = row({
  id: FINAL_ID,
  display_number: "T-1001.2",
  status: "final",
  invoice_date: "2026-11-24",
  subtotal: 2067.12,
  total: 2067.12,
});

/** What listBidInvoices answers: the rows, and what they leave of the price (bid-invoices.ts). */
const answer = (invoices: BidInvoiceRow[], over: Partial<BidInvoicesResult> = {}) => ({
  allowed: true,
  job_label: invoices.length ? "T-1001" : null,
  invoices,
  unbilled: unbilledAmount(PRICE, invoices),
  ...over,
});

/** A screen drawn to a string with its answers already in hand, as it stands when it opens. */
function draw(el: React.ReactElement, have: [readonly unknown[], unknown][] = []) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const [key, data] of have) qc.setQueryData(key, data);
  const html = renderToString(React.createElement(QueryClientProvider, { client: qc }, el));
  // Nothing that is not a word or a number ever reaches the page.
  for (const junk of ["[object Object]", "undefined", "NaN", ">null<"])
    expect(html).not.toContain(junk);
  return html;
}
/** React writes a marker between two pieces of text; a person reads straight through it. */
const words = (html: string) => html.replace(/<!-- -->/g, "");

type CardProps = Parameters<typeof BidInvoicesCard>[0];
const card = (props: Partial<CardProps>, list?: BidInvoicesResult) =>
  words(
    draw(
      React.createElement(BidInvoicesCard, { bidId: BID_ID, won: true, unsaved: false, ...props }),
      list ? [[["bid-invoices", BID_ID], list]] : [],
    ),
  );
const makeButton = (html: string) =>
  html.match(/<button[^>]*data-make-invoice="true"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
const unbilledLine = (html: string) =>
  html.match(/<p[^>]*data-unbilled="true"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
const rowsOf = (html: string) => html.match(/<li[^>]*data-bid-invoice-row="[^"]*"/g) ?? [];

const MANAGER = { id: "u1", full_name: "Dana Manager", role: "manager" };
const OFFICE = { id: "u2", full_name: "Olive Office", role: "user" };

describe("the numbers, by hand", () => {
  it("a $1,000.00 deposit on a $3,067.12 bid leaves $2,067.12; the final leaves nothing", () => {
    expect(unbilledAmount(PRICE, [])).toBe(3067.12);
    expect(unbilledAmount(PRICE, [DEPOSIT])).toBe(2067.12);
    expect(unbilledAmount(PRICE, [DEPOSIT, FINAL])).toBe(0);
    // A voided invoice bills nothing: its amount is left to bill again.
    expect(unbilledAmount(PRICE, [{ ...DEPOSIT, status: "void" }])).toBe(3067.12);
  });
});

describe("the bid's Invoices block, drawn", () => {
  it("someone who may not invoice sees nothing at all, Won or not", () => {
    auth.profile = OFFICE;
    const no: BidInvoicesResult = { allowed: false, job_label: null, invoices: [], unbilled: 0 };
    expect(card({ won: true }, no)).toBe("");
    expect(card({ won: false }, no)).toBe("");
  });

  it("while the answer is on its way it draws nothing", () => {
    auth.profile = MANAGER;
    expect(card({ won: true })).toBe("");
    expect(card({ won: false })).toBe("");
  });

  it("a bid that is not Won yet: one line saying what to do, and no button", () => {
    auth.profile = MANAGER;
    const html = card({ won: false }, answer([]));
    expect(NOT_WON).toBe("Mark the bid Won to invoice it.");
    expect(html).toContain(NOT_WON);
    expect(html).toContain("data-bid-invoices-hint");
    expect(html).not.toContain("data-bid-invoices=");
    expect(makeButton(html)).toBe("");
    expect(html).not.toContain("Left to bill");
  });

  it("Won, nothing invoiced yet: the whole price is left, and the button makes the first", () => {
    auth.profile = MANAGER;
    const html = card({}, answer([]));
    expect(html).toContain('data-bid-invoices="true"');
    expect(html).toContain(">Invoices");
    // No job number until the first invoice gives it one.
    expect(html).not.toContain("data-job-label");
    expect(rowsOf(html)).toHaveLength(0);
    expect(unbilledLine(html)).toBe("Left to bill: $3,067.12");
    expect(makeButton(html)).toContain("Make an invoice");
    expect(makeButton(html)).not.toContain("another");
    expect(makeButton(html)).not.toContain('disabled=""');
    expect(html).not.toContain("data-make-invoice-reason");
  });

  it("a paid $1,000.00 deposit: its row, $2,067.12 left, and the button makes another", () => {
    auth.profile = MANAGER;
    const html = card({}, answer([DEPOSIT]));
    expect(html.match(/<span[^>]*data-job-label="true"[^>]*>([^<]*)</)?.[1]).toBe("T-1001");
    expect(rowsOf(html)).toEqual([`<li data-bid-invoice-row="${DEPOSIT_ID}"`]);
    const line = html.slice(html.indexOf("<li"), html.indexOf("</li>"));
    // The number, the status as the Invoices list words it, the date and the total.
    expect(line).toContain("#T-1001<");
    expect(line).toContain(">Paid<");
    expect(line).toContain("Nov 17, 2026");
    expect(line).toContain("$1,000.00");
    // Paid in full: no balance.
    expect(line).not.toContain("balance due");
    // The row opens the invoice where the Invoices list opens it.
    expect(line).toContain('data-to="/service/invoices"');
    expect(line).toContain(`data-search="{&quot;id&quot;:&quot;${DEPOSIT_ID}&quot;}"`);
    expect(unbilledLine(html)).toBe("Left to bill: $2,067.12");
    expect(makeButton(html)).toContain("Make another invoice");
    expect(makeButton(html)).not.toContain('disabled=""');
  });

  it("billed in full: says so, and the button is off with the reason beside it", () => {
    auth.profile = MANAGER;
    const html = card({}, answer([DEPOSIT, FINAL]));
    expect(rowsOf(html)).toHaveLength(2);
    expect(html).toContain("#T-1001.2<");
    expect(html).toContain(">Final<");
    expect(html).toContain("$2,067.12");
    expect(BILLED_IN_FULL).toBe("Billed in full.");
    expect(unbilledLine(html)).toBe(BILLED_IN_FULL);
    expect(html).not.toContain("Left to bill");
    expect(makeButton(html)).toContain("Make another invoice");
    expect(makeButton(html)).toContain('disabled=""');
    expect(html).toMatch(
      /data-make-invoice-reason="true"[^>]*>Nothing is left to bill\. Void an invoice first if one was made by mistake\.</,
    );
  });

  it("changes not saved: the button is off until the bid is saved", () => {
    auth.profile = MANAGER;
    const html = card({ unsaved: true }, answer([DEPOSIT]));
    expect(SAVE_FIRST).toBe("Save the bid first.");
    expect(makeButton(html)).toContain('disabled=""');
    expect(html).toMatch(/data-make-invoice-reason="true"[^>]*>Save the bid first\.</);
    // What is left to bill still shows: it is the saved bid's.
    expect(unbilledLine(html)).toBe("Left to bill: $2,067.12");
    // Saved again, the button is back on.
    const saved = card({ unsaved: false }, answer([DEPOSIT]));
    expect(makeButton(saved)).not.toContain('disabled=""');
    expect(saved).not.toContain(SAVE_FIRST);
  });

  it("a payment that does not cover the invoice shows the balance due", () => {
    auth.profile = MANAGER;
    // 2,067.12 − 500.00 = 1,567.12 still owed; the invoice stays Final.
    const html = card({}, answer([DEPOSIT, { ...FINAL, paid_amount: 500 }]));
    expect(html).toMatch(/data-balance-due="true"[^>]*>balance due \$1,567\.12</);
    expect(html.match(/data-balance-due/g)).toHaveLength(1);
  });

  it("a voided invoice stays in the list, bills nothing, and does not count as one made", () => {
    auth.profile = MANAGER;
    const html = card({}, answer([{ ...DEPOSIT, status: "void", paid_amount: 0 }]));
    expect(rowsOf(html)).toHaveLength(1);
    expect(html).toContain(">Void<");
    expect(html).toContain("line-through");
    expect(unbilledLine(html)).toBe("Left to bill: $3,067.12");
    expect(makeButton(html)).toContain("Make an invoice");
    expect(makeButton(html)).not.toContain('disabled=""');
  });

  it("a bid moved off Won after it was invoiced keeps its invoices in sight", () => {
    auth.profile = MANAGER;
    const html = card({ won: false }, answer([DEPOSIT]));
    expect(rowsOf(html)).toHaveLength(1);
    expect(makeButton(html)).toContain('disabled=""');
    expect(html).toMatch(/data-make-invoice-reason="true"[^>]*>Mark the bid Won to invoice it\.</);
  });

  it("nothing has a fixed width, and no box takes a number", () => {
    const src = readFileSync("src/components/trade/bid-invoices-card.tsx", "utf8");
    // A 390 px phone: the rows and the button line wrap; nothing is sized in pixels or columns.
    // (`min-w-0` is the opposite of a fixed width: it lets a long line shrink and wrap.)
    expect(src).not.toMatch(
      /(?<!min-)\bw-(?:\[|\d)|min-w-\[|grid-cols-|whitespace-nowrap|overflow-x/,
    );
    expect(src.match(/flex flex-wrap/g)!.length).toBeGreaterThanOrEqual(4);
    expect(src).not.toMatch(/<input|<Input|NumberField/);
  });
});

// ── The block on the bid's screen ──────────────────────────────────────────────────────────────

const SETUP: TradeSetup = {
  measures: [{ id: "walls", name: "Walls", unit: "sq ft" }],
  materials: [],
  labor: [],
  // One flat cost and no markup: the screen's own price is not what is under test here.
  fixed: [{ id: "all", name: "Painting, as bid", cost: PRICE }],
  overhead_pct: 0,
  profit_pct: 0,
  tax_pct: 0,
  crew_size: 2,
  hours_per_day: 8,
};
const TRADE: TradeType = {
  id: TRADE_ID,
  name: "Painting",
  setup: SETUP,
  updated_at: "2026-11-16T15:00:00.000Z",
};
const WON_BID: TradeBid = {
  id: BID_ID,
  name: "Corner house, exterior",
  status: "won",
  due_date: "2026-12-01",
  lost_reason: null,
  account_id: ACCOUNT_ID,
  site_id: null,
  account: { id: ACCOUNT_ID, name: "Corner House Owner" },
  data: {
    ...newTradeBid(TRADE),
    quantities: { walls: 3000 },
    scope: "Paint the outside of the house.",
    customer: { ...emptyCustomer(), name: "Corner House Owner", estimatorName: "Dana Manager" },
  },
  grand_total: PRICE,
  updated_at: "2026-11-17T15:00:00.000Z",
  updated_by_name: "Dana Manager",
  deleted_at: null,
};

describe("the bid's screen, drawn", () => {
  it("a won, saved bid: the Invoices block sits under the price, before the bid's own rates", () => {
    auth.profile = MANAGER;
    const html = words(
      draw(React.createElement(TradeBidScreen, { bidId: BID_ID }), [
        [["trade-bid", BID_ID], WON_BID],
        [["bid-invoices", BID_ID], answer([DEPOSIT])],
      ]),
    );
    const price = html.indexOf('data-card="trade-bid-price"');
    const invoices = html.indexOf('data-bid-invoices="true"');
    const rates = html.indexOf("data-open-rates");
    expect(price).toBeGreaterThan(-1);
    expect(invoices).toBeGreaterThan(price);
    expect(rates).toBeGreaterThan(invoices);
    expect(unbilledLine(html)).toBe("Left to bill: $2,067.12");
    // The bid is as saved, so the button is on, and the bid still reads as saved.
    expect(makeButton(html)).not.toContain('disabled=""');
    expect(html).toContain("All changes are saved.");
  });

  it("a bid that is not Won: the one line, for someone who may invoice", () => {
    auth.profile = MANAGER;
    const html = draw(React.createElement(TradeBidScreen, { bidId: BID_ID }), [
      [["trade-bid", BID_ID], { ...WON_BID, status: "submitted" }],
      [["bid-invoices", BID_ID], answer([])],
    ]);
    expect(html).toContain(NOT_WON);
    expect(html).not.toContain("data-make-invoice");
  });

  it("someone who may not invoice sees the bid as it always was", () => {
    auth.profile = OFFICE;
    const html = draw(React.createElement(TradeBidScreen, { bidId: BID_ID }), [
      [["trade-bid", BID_ID], WON_BID],
      [["bid-invoices", BID_ID], { allowed: false, job_label: null, invoices: [], unbilled: 0 }],
    ]);
    expect(html).toContain('data-card="trade-bid-price"');
    expect(html).not.toContain("data-bid-invoices");
    expect(html).not.toContain("Invoices");
    expect(html).not.toContain(NOT_WON);
  });

  it("a new bid has no Invoices block: there is nothing saved to invoice", () => {
    auth.profile = MANAGER;
    const html = draw(React.createElement(TradeBidScreen, { tradeTypeId: TRADE_ID }), [
      [["trade-type", TRADE_ID], TRADE],
    ]);
    expect(html).toContain('data-trade-bid="new"');
    expect(html).not.toContain("data-bid-invoices");
    expect(html).not.toContain(NOT_WON);
  });
});

// ── The invoice page ───────────────────────────────────────────────────────────────────────────

const invoiceRow = (over: Partial<InvoiceRow>): InvoiceRow => ({
  id: FINAL_ID,
  bid_id: null,
  service_job_id: null,
  bill_to: { name: "Corner House Owner", address1: "12 Corner St", city: "Springfield" },
  bill_to_vendor_id: null,
  cost_total: 0,
  created_at: "2026-11-17T15:00:00.000Z",
  created_by: null,
  description: null,
  display_number: null,
  due_date: null,
  finalized_at: null,
  invoice_date: "2026-11-17",
  job_code: null,
  material_markup: 0.75,
  number: null,
  paid_amount: 0,
  paid_method: null,
  paid_on: null,
  paid_ref: null,
  payment_terms: null,
  pdf_path: null,
  photo_ids: null,
  po_markup: true,
  po_number: null,
  property: {},
  sage_exported_at: null,
  sent_at: null,
  sent_by_name: null,
  sent_to: null,
  share_created_at: null,
  share_last_viewed_at: null,
  share_token: null,
  share_views: 0,
  status: "draft",
  subtotal: 2067.12,
  tax_amount: 0,
  tax_rate: 0,
  total: 2067.12,
  updated_at: "2026-11-17T15:00:00.000Z",
  updated_by_name: null,
  ...over,
});
const line = (invoiceId: string): InvoiceLineRow => ({
  id: 1,
  invoice_id: invoiceId,
  kind: "other",
  description: "Painting, balance of the bid",
  qty: 1,
  unit: "ea",
  rate: 2067.12,
  total: 2067.12,
  cost_rate: 0,
  cost_total: 0,
  on_date: null,
  taxable: true,
  source: null,
  rate_overridden: false,
  show_on_invoice: true,
  hide_price: false,
  sort: 0,
});

const BID_REF: InvoiceBidRef = {
  id: BID_ID,
  name: "Corner house, exterior",
  trade_name: "Painting",
  job_label: "T-1001",
  account_id: null,
  readable: true,
};
/** A bid's invoice: no ticket (service_job_id null), the second on job T-1001. */
const bidInvoice = (over: Partial<InvoiceRow> = {}, bid: InvoiceBidRef | null = BID_REF) => ({
  invoice: invoiceRow({ id: FINAL_ID, bid_id: BID_ID, display_number: "T-1001.2", ...over }),
  lines: [line(FINAL_ID)],
  ...(bid ? { bid } : {}),
});
const TICKET = {
  id: JOB_ID,
  number: 6012,
  customer_name: "Harbor Bakery",
  account_id: null,
  stage: "done",
} as unknown as ServiceJobWithTech;
const ticketInvoice = (over: Partial<InvoiceRow> = {}): InvoiceWithLines => ({
  invoice: invoiceRow({
    id: TICKET_INVOICE_ID,
    service_job_id: JOB_ID,
    display_number: "6012",
    bill_to: { name: "Harbor Bakery" },
    ...over,
  }),
  lines: [line(TICKET_INVOICE_ID)],
});
const page = (id: string, have: [readonly unknown[], unknown][]) =>
  words(draw(React.createElement(InvoiceEditorPage, { id }), have));
const ownerWords = (html: string) =>
  html.match(/<span[^>]*data-invoice-owner="true"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "";

describe("the invoice page, drawn", () => {
  it("a bid's invoice opens as soon as it is read: there is no ticket to wait for", () => {
    auth.profile = MANAGER;
    // Only the invoice is in hand. No ticket, no list of the bid's invoices.
    const html = page(FINAL_ID, [[invoicePageKey(FINAL_ID), bidInvoice()]]);
    expect(html).not.toContain("Loading the invoice");
    expect(html).toContain("Invoice #T-1001.2</h1>");
    expect(html).toContain("Finalise");
    expect(html).toContain('value="Painting, balance of the bid"');
    expect(html).toContain("$2,067.12");
  });

  it("the header names the bid and links to it on Trade Bids", () => {
    auth.profile = MANAGER;
    const html = page(FINAL_ID, [[invoicePageKey(FINAL_ID), bidInvoice()]]);
    const owner = ownerWords(html);
    expect(owner).toContain("Trade bid T-1001 · Corner house, exterior");
    // bidLink for a trade bid: Trade Bids, never the roofing estimator.
    expect(bidLink({ id: BID_ID, kind: "trade" })).toEqual({
      to: "/trade-bids",
      search: { bid: BID_ID },
    });
    expect(owner).toContain('data-to="/trade-bids"');
    expect(owner).toContain(`data-search="{&quot;bid&quot;:&quot;${BID_ID}&quot;}"`);
    // The title is not a link to a ticket: there is none.
    expect(html).not.toContain('data-to="/service"');
    expect(html).not.toContain("Ticket #");
  });

  it("someone without Estimate access reads the job number and gets no link to the bid", () => {
    auth.profile = MANAGER;
    const closed: InvoiceBidRef = { ...BID_REF, name: "", trade_name: "", readable: false };
    const html = page(FINAL_ID, [[invoicePageKey(FINAL_ID), bidInvoice({}, closed)]]);
    expect(ownerWords(html)).toBe("Trade bid T-1001");
    expect(html).not.toContain("/trade-bids");
  });

  it("an answer that does not say which bid still opens: the job number is the invoice's own", () => {
    auth.profile = MANAGER;
    // "T-1001.2" is the second invoice of job T-1001.
    const html = page(FINAL_ID, [[invoicePageKey(FINAL_ID), bidInvoice({}, null)]]);
    expect(html).not.toContain("Loading the invoice");
    expect(ownerWords(html)).toBe("Trade bid T-1001");
    expect(html).not.toContain("/trade-bids");
  });

  it("a bid's invoice leaves out what only a ticket has", () => {
    auth.profile = MANAGER;
    const html = page(FINAL_ID, [[invoicePageKey(FINAL_ID), bidInvoice()]]);
    // The photos fold, the purchase-order switch, and the ticket's words.
    expect(html).not.toContain("Show the photos");
    expect(html).not.toContain("Mark up purchase orders");
    expect(html).not.toContain("urchase order");
    expect(html).not.toMatch(/\bticket\b/i);
    // "Another invoice" says what it bills.
    expect(html).toContain(
      'title="Make another invoice for trade bid T-1001: it bills what the bid has left to bill"',
    );
  });

  it("the chips are the bid's invoices", () => {
    auth.profile = MANAGER;
    const html = page(FINAL_ID, [
      [invoicePageKey(FINAL_ID), bidInvoice()],
      [["bid-invoices", BID_ID], answer([DEPOSIT, FINAL])],
    ]);
    const chips = html.slice(html.indexOf('aria-label="This bid&#x27;s invoices"'));
    expect(chips).toContain("#T-1001<");
    expect(chips).toContain("#T-1001.2<");
    expect(chips).toContain(`data-search="{&quot;id&quot;:&quot;${DEPOSIT_ID}&quot;}"`);
  });

  it("a final invoice of a bid: its notes speak of the bid, not of a ticket", () => {
    auth.profile = MANAGER;
    const html = page(FINAL_ID, [
      [
        invoicePageKey(FINAL_ID),
        bidInvoice({ status: "final", finalized_at: "2026-11-24T15:00:00.000Z" }),
      ],
    ]);
    expect(html).toContain(
      "This invoice is final, so it can&#x27;t be edited. To change it, Void it below and make a new one with Another invoice above.",
    );
    expect(html).toContain("Mark paid");
    expect(html).toContain("Void");
    expect(html).not.toMatch(/\bticket\b/i);
    expect(html).not.toContain("Show the photos");
  });

  it("a ticket's invoice still waits for its ticket", () => {
    auth.profile = MANAGER;
    const html = page(TICKET_INVOICE_ID, [[invoicePageKey(TICKET_INVOICE_ID), ticketInvoice()]]);
    expect(html).toContain("Loading the invoice");
    expect(html).not.toContain("Finalise");
  });

  it("a ticket's invoice reads as it always did: the ticket, the photos, the purchase orders", () => {
    auth.profile = MANAGER;
    const html = page(TICKET_INVOICE_ID, [
      [invoicePageKey(TICKET_INVOICE_ID), ticketInvoice()],
      [["service-job", JOB_ID], TICKET],
    ]);
    expect(html).not.toContain("Loading the invoice");
    // The title opens the ticket; the words beside it name it and its customer.
    expect(html).toMatch(
      /<h1[^>]*><a data-to="\/service" data-search="\{&quot;id&quot;:&quot;[^"]*&quot;\}" title="Open ticket #6012">Invoice #6012<\/a><\/h1>/,
    );
    expect(ownerWords(html)).toBe("Ticket #6012 · Harbor Bakery");
    expect(html).not.toContain("Trade bid");
    expect(html).not.toContain("/trade-bids");
    expect(html).toContain("Show the photos");
    expect(html).toContain("Mark up purchase orders");
    expect(html).toContain(
      'title="Make another invoice for ticket #6012 (numbered 6012.2, 6012.3, …)"',
    );
    expect(html).toContain('aria-label="More actions"');
  });
});

// ── Pins on the source ─────────────────────────────────────────────────────────────────────────

const read = (path: string) => readFileSync(path, "utf8");
const EDITOR = read("src/components/service/invoice-editor.tsx");
const CARD = read("src/components/trade/bid-invoices-card.tsx");
const SCREEN = read("src/components/trade/trade-bid-screen.tsx");
const PAGE = EDITOR.slice(
  EDITOR.indexOf("export function InvoiceEditorPage"),
  EDITOR.indexOf("// ---- Draft ----"),
);
const DRAFT = EDITOR.slice(
  EDITOR.indexOf("function DraftInvoice("),
  EDITOR.indexOf("function useAccount("),
);

describe("pins on the invoice page's source", () => {
  it("a bid's invoice does not wait on a ticket", () => {
    // What it belongs to: the ticket or the bid, never both.
    expect(EDITOR).toContain(
      "type Owner = { job: ServiceJobWithTech; bid: null } | { job: null; bid: InvoiceBidRef };",
    );
    // A bid's invoice has its owner at once; a ticket's only when the ticket is read.
    expect(EDITOR).toMatch(
      /const bidId = data\.invoice\.bid_id;\s*if \(bidId\) return \{ job: null, bid: bidRefOf\(data, bidId\) \};\s*return ticket \? \{ job: ticket, bid: null \} : null;/,
    );
    expect(PAGE).toContain("const owner = data ? ownerOf(data, jobQ.data) : null;");
    expect(PAGE).toMatch(/if \(!data \|\| !owner\)\s*return \(/);
    expect(PAGE).not.toContain("if (!data || !job)");
    // No ticket is asked for without a ticket id, and the bid's list only with a bid id.
    expect(PAGE).toMatch(
      /queryKey: \["service-job", jobId\],\s*queryFn: \(\) => jobFn\(\{ data: \{ id: jobId! \} \}\),\s*enabled: !!session && !!jobId,/,
    );
    expect(PAGE).toMatch(
      /queryKey: \["bid-invoices", bidId\],\s*queryFn: \(\) => bidListFn\(\{ data: \{ bid_id: bidId! \} \}\),\s*enabled: !!session && !!bidId,/,
    );
  });

  it("the header links to the bid with bidLink, only for someone who may open it", () => {
    expect(EDITOR).toContain('import { bidLink } from "@/lib/bid-kind";');
    expect(PAGE).toMatch(
      /\) : bid\.readable \? \(\s*<Link\s+\{\.\.\.bidLink\(\{ id: bid\.id, kind: "trade" \}\)\}/,
    );
    expect(PAGE).toMatch(
      /Trade bid \{bid\.job_label\}\s*\{bid\.name \? ` · \$\{bid\.name\}` : ""\}/,
    );
    expect(PAGE).toContain("`Trade bid ${bid.job_label}`");
  });

  it("the photos and Rebuild are a ticket's: not drawn for a bid's invoice, still drawn for a ticket's", () => {
    // The photos fold exists only behind `job`, and is what the page draws.
    expect(PAGE).toMatch(
      /const photos = job && \(\s*<InvoicePhotos invoiceId=\{inv\.id\} ticketNumber=\{job\.number\} editable=\{status === "draft"\} \/>\s*\);/,
    );
    expect(PAGE.match(/<InvoicePhotos\b/g)).toHaveLength(1);
    expect(PAGE).toMatch(/\{photos\}\s*<AuditHistory entity="invoice"/);
    // Rebuild from ticket is in the "…" menu only behind `job`; Delete draft is always there.
    expect(DRAFT).toMatch(
      /\{job && \(\s*<DropdownMenuItem\s+title="[^"]*"\s+onSelect=\{\(\) => setConfirm\("rebuild"\)\}\s*>\s*<RefreshCw [^>]*\/> Rebuild from ticket\s*<\/DropdownMenuItem>\s*\)\}/,
    );
    expect(DRAFT.match(/setConfirm\("rebuild"\)/g)).toHaveLength(1);
    expect(DRAFT).toMatch(
      /\)\}\s*<DropdownMenuItem\s+className="text-destructive focus:text-destructive"\s+onSelect=\{\(\) => setConfirm\("delete"\)\}/,
    );
  });

  it("the purchase orders are a ticket's: nothing is read for a bid's invoice", () => {
    expect(EDITOR).toContain("enabled: enabled && hasTicket,");
    expect(EDITOR.match(/enabled: enabled && hasTicket,/g)).toHaveLength(2);
    expect(EDITOR).toMatch(/\{job && \(\s*<>\s*<div[^>]*>\s*<Switch\s+id="inv-po-markup"/);
    expect(DRAFT).toContain("<Totals t={t} taxPct={head.tax_pct} pos={false} />");
    expect(EDITOR).toContain("<Totals t={stored} taxPct={toPct(inv.tax_rate)} pos={false} />");
    expect(EDITOR).toMatch(/\{pos && \(\s*<div[^>]*>\s*<dt>\s*Purchase orders/);
  });

  it("\"Another invoice\" on a bid's invoice bills what the bid has left; the server's refusal is said as it is", () => {
    expect(PAGE).toContain("const bidAnotherFn = useServerFn(createBidInvoice);");
    expect(PAGE).toContain("mutationFn: (bid: string) => bidAnotherFn({ data: { bid_id: bid } }),");
    expect(PAGE).toContain(
      "onClick={() => (job ? another.mutate(job.id) : anotherBid.mutate(bid.id))}",
    );
    const mut = PAGE.slice(PAGE.indexOf("const anotherBid = useMutation({"));
    expect(mut.slice(0, mut.indexOf("});"))).toContain("onError: (e) => toast.error(errText(e)),");
    expect(mut.slice(0, mut.indexOf("});"))).toContain("openInvoice(r.id);");
  });

  it("what a bid's invoice re-reads, and where it goes after a Void or a deleted draft", () => {
    const refresh = PAGE.slice(PAGE.indexOf("const refreshBid = ("));
    const body = refresh.slice(0, refresh.indexOf("};"));
    for (const key of ['["invoices"]', '["bid-invoices", bid]', '["trade-bid", bid]'])
      expect(body).toContain(`void qc.invalidateQueries({ queryKey: ${key}, refetchType });`);
    // A ticket's invoice refreshes its ticket, as before; a bid's has none.
    expect(PAGE).toContain(
      "if (!job) return refreshBid(bid.id, !opts?.quiet);\n      refreshLists(job.id, !opts?.quiet);\n      if (opts?.stage) refreshTicket(job.id);",
    );
    expect(PAGE).toContain("if (!job) return bidVoided(bid, voidedId);");
    expect(PAGE).toContain(
      'if (b.readable) void navigate({ ...bidLink({ id: b.id, kind: "trade" }), replace: true });',
    );
    expect(PAGE).toContain(
      'else void navigate({ to: "/service/invoices", search: listSearch, replace: true });',
    );
    // A save's answer does not carry the bid: the one in hand is kept.
    expect(PAGE).toContain("qc.setQueryData(invoicePageKey(r.invoice.id), keepBid(r));");
  });

  it("a bid's invoice has no ticket account or ticket number to read", () => {
    expect(EDITOR.match(/useAccount\(job \? job\.account_id : bid\.account_id\)/g)).toHaveLength(2);
    expect(EDITOR).toContain("accountId={job ? job.account_id : bid.account_id}");
    expect(DRAFT).toMatch(
      /\? job\s*\? deleteDraftNote\(job\.number, no\)\s*: `The draft and its lines are removed\. The next invoice made for this bid takes number \$\{no\}\.`/,
    );
    // Nothing reads the ticket without first knowing there is one.
    expect(EDITOR).not.toMatch(/const \{ job \} = ctx;/);
  });
});

describe("pins on the bid screen's source", () => {
  it("the block reads and makes through the two server functions, under the agreed key", () => {
    expect(CARD).toContain("useServerFn(listBidInvoices)");
    expect(CARD).toContain("useServerFn(createBidInvoice)");
    expect(CARD).toContain('queryKey: ["bid-invoices", props.bidId],');
    expect(CARD).toContain("mutationFn: () => makeFn({ data: { bid_id: props.bidId } }),");
    // Then on to the new invoice, where the Invoices list opens one.
    expect(CARD).toContain('void navigate({ to: "/service/invoices", search: { id: r.id } });');
    // The server's refusal, as the server words it.
    expect(CARD).toContain("onError: (e) => toast.error(plainErrText(e), { duration: 12_000 }),");
    expect(CARD).toMatch(/<Link\s+to="\/service\/invoices"\s+search=\{\{ id: inv\.id \}\}/);
    // An error is one line with a way to try again, where the block would be.
    expect(CARD).toMatch(/onClick=\{\(\) => void q\.refetch\(\)\}>\s*<RefreshCw \/> Try again/);
  });

  it("the words and the money are the ones the other screens use", () => {
    expect(CARD).toContain('import { fmtMoney } from "@/lib/trade-bid";');
    expect(CARD).toContain('import { balanceDue, partlyPaid } from "@/lib/invoice-payment";');
    expect(CARD).toMatch(
      /import \{\s*asInvoiceStatus,\s*shortDay,\s*STATUS_CLASS,\s*STATUS_LABELS,\s*\} from "@\/components\/service\/invoice-utils";/,
    );
  });

  it("the hooks a browser test holds on to", () => {
    for (const hook of [
      "data-bid-invoices",
      "data-bid-invoice-row={inv.id}",
      "data-make-invoice",
      "data-unbilled",
      "data-job-label",
    ])
      expect(CARD).toContain(hook);
  });

  it("the block is no part of the bid's form: it is told two things and changes nothing", () => {
    expect(SCREEN).toContain(
      '<BidInvoicesCard bidId={bid.id} won={status === "won"} unsaved={dirty} deleted={deleted} />',
    );
    // It is handed no way to change the bid: no setter, no draft, no callback. All it takes:
    const props = CARD.slice(CARD.indexOf("export function BidInvoicesCard(props: {"));
    expect(props.slice(0, props.indexOf("}) {")).match(/^ {2}\w+\??: \w+;$/gm)).toEqual([
      "  bidId: string;",
      "  won: boolean;",
      "  unsaved: boolean;",
      "  deleted?: boolean;",
    ]);
    expect(CARD).not.toMatch(/setDraft|setSaved|dirtyRef|useBlocker/);
    // The leave guard is as it was.
    expect(SCREEN).toMatch(
      /const blocker = useBlocker\(\{\s*shouldBlockFn: \(\) => dirtyRef\.current,\s*withResolver: true,\s*enableBeforeUnload: \(\) => dirtyRef\.current,\s*\}\);/,
    );
    expect(SCREEN).toContain("const dirty = !deleted && isDirty(saved, draft);");
    // A saved price changes what is left to bill: the block reads again after Save.
    expect(SCREEN).toContain('void qc.invalidateQueries({ queryKey: ["bid-invoices", row.id] });');
  });
});
