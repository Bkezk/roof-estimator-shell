/**
 * The Margin report — the server side (owner, Oct 21; src/lib/margin-report.ts has the rules and
 * the definitions). Admins only: `listMarginReport` reads the caller's own profile row and throws
 * "Forbidden: admin only" unless its role is admin — never a flag from the client. Reads run under
 * the caller's own client (an admin reads everything by RLS, other users' profiles included).
 *
 * What is read, and why (`readPeriod`, once for the range asked for and once more for the
 * comparison period when `compare` is given — one call from the client, no second round trip):
 *  - invoices with status final / sent / paid whose invoice_date is in From..To, every row a page
 *    at a time (read-all.ts: no 1,000-row ceiling; keyset pages by id since Oct 21's eighth audit,
 *    so an invoice finalized while the report reads is counted once or not at all, never twice).
 *    invoice_date is never null, so filtering on it loses nothing; invoiceDay still applies the
 *    finalized / created fallbacks for the grouping.
 *  - their tickets (technician, account, customer name), their lines (the cost split, the hours
 *    from the labor and travel lines' qty, and the "po:<id>" sources), the tickets' purchase
 *    orders (every one; owner, Oct 28), and — for tickets that have one — every invoice of the
 *    ticket whatever its
 *    status, because the PO counts toward the ticket's earliest LIVE invoice (a draft included;
 *    invoice-totals.ts poCostInvoice). Id lists go 100 at a time (chunk-ids.ts), each chunk read
 *    to the end (readAll) so a chunk with over 1,000 lines is not cut short.
 *  - names: the invoice's bill_to snapshot carries the customer's (or vendor's) name, as the
 *    Invoices list shows it (invoices.functions.ts listInvoices); a blank one falls back to the
 *    vendor, the account, then the ticket's customer_name. Technicians come from profiles.
 *
 * The answer carries the groups, the totals and the lean per-invoice rows (margin-report.ts
 * MarginInvoiceRow: ids, numbers, names, day, status, the money — no tax, no lines) so the report
 * can open a group and show the invoices behind it without another read.
 *
 * Won bids (owner, Oct 21; `readWonBids`, when Include is not "service only"): the live
 * (deleted_at null) bids whose status is won (the legacy accepted too), read by keyset page like
 * the invoices, with the customer name as the JSON path `data->customer->>name` so the bid's data
 * blob — the whole estimator payload and pricing snapshot — never crosses the wire. The won day
 * is settled in code (margin-report.ts bidWonDay: won_on, else status_changed_at's office day,
 * else updated_at's), so the range filter is in code too; won bids are few, and every one of them
 * is a page or two. The account's name (crm_accounts) and the estimator's (profiles, created_by)
 * are resolved with the same chunked reads. A won bid in the range whose figures column is null
 * (saved before the column existed) is reported in `bidsWithoutFigures` and counted nowhere.
 *
 * Invoices made from a trade bid (Nov 17; invoices.bid_id): a won trade bid is counted above,
 * from the bid's own figures, so its invoices are left out of the invoices read here or the job
 * would be in the report twice. Left out in code after the read (`bid_id` is selected and the
 * rows that carry one dropped), not as a database filter.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { isAdmin } from "@/lib/access";
import { asBidFigures } from "@/lib/bid-figures";
import { asBidStatus } from "@/lib/bid-status";
import { readInChunks } from "@/lib/chunk-ids";
import { invoiceLabel } from "@/lib/invoice-numbering";
import { poIdOfLine } from "@/lib/invoice-po-lines";
import type { TicketInvoiceRef } from "@/lib/invoice-totals";
import {
  COUNTED_INVOICE_STATUSES,
  MARGIN_GROUPS,
  MARGIN_SOURCES,
  aggregateMarginRows,
  bidToMarginIn,
  bidWonDay,
  invoiceDay,
  lineCosts,
  poCostCarried,
  toMarginInvoiceRow,
  type CountedInvoiceStatus,
  type MarginGroupBy,
  type MarginInvoiceRow,
  type MarginPeriod,
  type MarginReportResult,
  type MarginSource,
  marginBucket,
} from "@/lib/margin-report";
import {
  filterByLine,
  lineMonthSeries,
  lineTotals,
  MARGIN_LINE_FILTERS,
  type MarginLineFilter,
  type RoofCareInForce,
} from "@/lib/margin-lines";
import { PAGE, afterId, readAll, type RowId } from "@/lib/read-all";
import { readSizeRefunds } from "@/lib/roof-care-plan";

type Sb = SupabaseClient<Database>;

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day as YYYY-MM-DD");
const RANGE = z
  .object({ from: YMD, to: YMD })
  .refine((d) => d.from <= d.to, { message: "From must be on or before To" });
const INPUT = z
  .object({
    from: YMD,
    to: YMD,
    groupBy: z.enum(MARGIN_GROUPS),
    compare: RANGE.optional(),
    /** Include: service invoices, won bids, or both (the default). */
    source: z.enum(MARGIN_SOURCES).optional(),
    /** Business: everything (the default), or one line of business alone (Nov 18). */
    line: z.enum(MARGIN_LINE_FILTERS).optional(),
  })
  .refine((d) => d.from <= d.to, { message: "From must be on or before To" });
export type MarginReportInput = z.infer<typeof INPUT>;

const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;
const uniq = (ids: readonly (string | null | undefined)[]): string[] => [
  ...new Set(ids.filter((x): x is string => !!x)),
];

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

/**
 * Every row of `table` whose `column` is in `ids`: 100 ids a request, each read to its end by
 * keyset page (`after` is the last id seen, null first; read-all.ts, Oct 21, eighth audit).
 */
function byIds<T extends { id: RowId }>(
  ids: readonly string[],
  page: (
    chunk: string[],
    after: RowId | null,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  return readInChunks(ids, (chunk) => readAll((after) => page(chunk, after)));
}

/** The counted invoices of from..to as lean per-invoice rows (the reads described at the top). */
async function readInvoices(sb: Sb, from: string, to: string): Promise<MarginInvoiceRow[]> {
  const read = must(
    "invoices",
    await readAll((after) =>
      afterId(
        sb
          .from("invoices")
          .select(
            "id, number, display_number, status, sent_at, invoice_date, finalized_at, created_at, subtotal, bill_to, bill_to_vendor_id, service_job_id, bid_id, roof_care_plan_id",
          )
          .in("status", [...COUNTED_INVOICE_STATUSES])
          .gte("invoice_date", from)
          .lte("invoice_date", to)
          .order("id")
          .limit(PAGE),
        after,
      ),
    ),
  );
  // A trade bid's invoices are not counted: the won bid is, from its own figures (readWonBids).
  // Every invoice left is a ticket's, or a Roof Care plan year's (Nov 19: paid for before the
  // plan starts; the check invoices_one_parent). `ticket` is the ticket's id, "" for a row with
  // none, which then finds no ticket and no purchase orders below. A plan year's invoice is Roof
  // Care's income; what the year costs is on its inspections' own invoices, which bill nothing.
  const invoices = read
    .filter((i) => !i.bid_id)
    .map((i) => ({ ...i, ticket: i.service_job_id ?? "" }));
  const invoiceIds = invoices.map((i) => i.id);
  const ticketIds = uniq(invoices.map((i) => i.ticket));

  const [tickets, lines, pos] = await Promise.all([
    readInChunks(ticketIds, (chunk) =>
      sb
        .from("service_jobs")
        .select("id, technician_id, account_id, customer_name, roof_care_visit_id")
        .in("id", chunk),
    ),
    byIds(invoiceIds, (chunk, after) =>
      afterId(
        sb
          .from("invoice_lines")
          .select("id, invoice_id, kind, cost_total, qty, source")
          .in("invoice_id", chunk)
          .order("id")
          .limit(PAGE),
        after,
      ),
    ),
    byIds(ticketIds, (chunk, after) =>
      afterId(
        sb
          .from("service_job_purchase_orders")
          .select("id, service_job_id, price")
          .in("service_job_id", chunk)
          .order("id")
          .limit(PAGE),
        after,
      ),
    ),
  ]);
  const ticketById = new Map(tickets.map((t) => [t.id, t]));
  const linesByInvoice = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = linesByInvoice.get(l.invoice_id) ?? [];
    list.push(l);
    linesByInvoice.set(l.invoice_id, list);
  }
  const posByTicket = new Map<string, typeof pos>();
  for (const p of pos) {
    const list = posByTicket.get(p.service_job_id) ?? [];
    list.push(p);
    posByTicket.set(p.service_job_id, list);
  }

  // Names, and the carrier rule's invoice lists, in one round.
  const blankName = (i: (typeof invoices)[number]) => !billToName(i.bill_to);
  const vendorIds = uniq(invoices.filter(blankName).map((i) => i.bill_to_vendor_id));
  const accountIds = uniq(
    invoices
      .filter((i) => blankName(i) && !i.bill_to_vendor_id)
      .map((i) => ticketById.get(i.ticket)?.account_id),
  );
  const techIds = uniq(tickets.map((t) => t.technician_id));
  const [vendors, accounts, profiles, ticketInvoices] = await Promise.all([
    readInChunks(vendorIds, (chunk) => sb.from("vendors").select("id, name").in("id", chunk)),
    readInChunks(accountIds, (chunk) => sb.from("crm_accounts").select("id, name").in("id", chunk)),
    readInChunks(techIds, (chunk) =>
      sb.from("profiles").select("id, full_name, email").in("id", chunk),
    ),
    byIds([...posByTicket.keys()], (chunk, after) =>
      afterId(
        sb
          .from("invoices")
          .select("id, number, display_number, status, created_at, service_job_id")
          .in("service_job_id", chunk)
          .order("id")
          .limit(PAGE),
        after,
      ),
    ),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const techName = new Map(profiles.map((p) => [p.id, nameOf(p)]));
  // Which purchase orders each of those invoices bills as a line (Nov 16): a PO billed on
  // another live invoice of the ticket is in that invoice's cost, so the carrying invoice must
  // not count it again. The invoices of the range have their lines read already; the ticket's
  // other invoices (another month, a draft) are read here, their PO lines only.
  const others = ticketInvoices.filter((r) => !linesByInvoice.has(r.id) && r.status !== "void");
  const otherLines = await byIds(
    others.map((r) => r.id),
    (chunk, after) =>
      afterId(
        sb
          .from("invoice_lines")
          .select("id, invoice_id, source")
          .in("invoice_id", chunk)
          .not("source", "is", null)
          .order("id")
          .limit(PAGE),
        after,
      ),
  );
  const poIdsByInvoice = new Map<string, string[]>();
  for (const l of [...lines, ...otherLines]) {
    const id = poIdOfLine(l);
    if (id) poIdsByInvoice.set(l.invoice_id, [...(poIdsByInvoice.get(l.invoice_id) ?? []), id]);
  }
  const refsByTicket = new Map<string, TicketInvoiceRef[]>();
  for (const r of ticketInvoices) {
    // Read by ticket id, so each has one; the type alone allows none.
    if (!r.service_job_id) continue;
    const list = refsByTicket.get(r.service_job_id) ?? [];
    list.push({
      id: r.id,
      label: invoiceLabel(r),
      status: r.status,
      created_at: r.created_at,
      po_ids: poIdsByInvoice.get(r.id) ?? [],
    });
    refsByTicket.set(r.service_job_id, list);
  }

  return invoices.map((i) => {
    const ticket = ticketById.get(i.ticket);
    const myLines = linesByInvoice.get(i.id) ?? [];
    const myPos = posByTicket.get(i.ticket) ?? [];
    const costs = lineCosts(myLines);
    const customer =
      billToName(i.bill_to) ||
      (i.bill_to_vendor_id ? vendorName.get(i.bill_to_vendor_id) : undefined) ||
      (ticket?.account_id ? accountName.get(ticket.account_id) : undefined) ||
      ticket?.customer_name ||
      "";
    const technicianId = ticket?.technician_id ?? null;
    return toMarginInvoiceRow({
      id: i.id,
      kind: "service",
      number: invoiceLabel(i),
      day: invoiceDay(i),
      // The split's bucket: paid, sent (the stamp; Nov 9), else final.
      status: marginBucket(i),
      subtotal: Number(i.subtotal),
      customer,
      technician: technicianId ? (techName.get(technicianId) ?? null) : null,
      technicianId,
      ticket: !!ticket,
      // The invoice of a Roof Care plan inspection is its own line of business (Nov 18).
      ...(ticket?.roof_care_visit_id || i.roof_care_plan_id ? { carePlan: true } : {}),
      ...costs,
      purchaseOrders: myPos.length
        ? poCostCarried(i.id, refsByTicket.get(i.ticket) ?? [], myPos, myLines)
        : 0,
    });
  });
}

/** A won bid as the read answers it (the select below; the JSON path alias is a plain text column). */
interface WonBidRead {
  id: string;
  /** "roof" or "trade" (Nov 16): a won trade bid is in the report like a won roofing bid. */
  kind?: string | null;
  name: string;
  status: string;
  status_changed_at: string | null;
  updated_at: string;
  created_at: string;
  account_id: string | null;
  created_by: string | null;
  grand_total: number | string | null;
  figures: unknown;
  won_on: string | null;
  customer_name: string | null;
  /** data.taxMaterialOnly and data.adminSnapshot.settings.taxMaterialOnly, as JSON text. */
  own_tax_mode?: unknown;
  priced_tax_mode?: unknown;
}

/** A JSON boolean read as text ("true" / "false") or as itself; anything else is unknown. */
const jsonFlag = (v: unknown): boolean | null =>
  v === true || v === "true" ? true : v === false || v === "false" ? false : null;

interface PeriodRead {
  rows: MarginInvoiceRow[];
  bidsWithoutFigures: MarginReportResult["bidsWithoutFigures"];
}

/** The won bids whose won day falls in from..to, as rows; and those without figures, listed. */
async function readWonBids(sb: Sb, from: string, to: string): Promise<PeriodRead> {
  const all = must(
    "bids",
    await readAll((after) =>
      afterId(
        sb
          .from("bids")
          .select(
            // own_tax_mode / priced_tax_mode: was the bid priced with sales tax on material
            // only (its own setting, else the company setting in its pricing snapshot)? Read
            // for figures saved before Nov 16, which do not say (bid-figures.ts bidMaterialTax).
            "id, name, kind, status, status_changed_at, updated_at, created_at, account_id, created_by, grand_total, figures, won_on, customer_name:data->customer->>name, own_tax_mode:data->>taxMaterialOnly, priced_tax_mode:data->adminSnapshot->settings->>taxMaterialOnly",
          )
          .in("status", ["won", "accepted"])
          .is("deleted_at", null)
          .order("id")
          .limit(PAGE),
        after,
      ),
    ),
  ) as unknown as WonBidRead[];
  // The read's status filter already keeps won and the legacy accepted; asBidStatus names it.
  const inRange = all.filter((b) => {
    if (asBidStatus(b.status) !== "won") return false;
    const day = bidWonDay(b);
    return day >= from && day <= to;
  });
  const [accounts, profiles] = await Promise.all([
    readInChunks(uniq(inRange.map((b) => b.account_id)), (chunk) =>
      sb.from("crm_accounts").select("id, name").in("id", chunk),
    ),
    readInChunks(uniq(inRange.map((b) => b.created_by)), (chunk) =>
      sb.from("profiles").select("id, full_name, email").in("id", chunk),
    ),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const estimatorName = new Map(profiles.map((p) => [p.id, nameOf(p)]));
  const rows: MarginInvoiceRow[] = [];
  const bidsWithoutFigures: PeriodRead["bidsWithoutFigures"] = [];
  for (const b of inRange) {
    const figures = asBidFigures(b.figures);
    if (!figures) {
      bidsWithoutFigures.push({
        id: b.id,
        name: b.name,
        day: bidWonDay(b),
        ...(b.kind === "trade" ? { kind: "trade" } : {}),
      });
      continue;
    }
    rows.push(
      toMarginInvoiceRow(
        bidToMarginIn({
          id: b.id,
          name: b.name,
          won_on: b.won_on,
          status_changed_at: b.status_changed_at,
          updated_at: b.updated_at,
          accountName: b.account_id ? accountName.get(b.account_id) : null,
          dataCustomerName: b.customer_name,
          estimator: b.created_by ? (estimatorName.get(b.created_by) ?? null) : null,
          estimatorId: b.created_by,
          figures,
          bidKind: b.kind,
          taxMaterialOnly: jsonFlag(b.own_tax_mode) ?? jsonFlag(b.priced_tax_mode),
        }),
      ),
    );
  }
  return { rows, bidsWithoutFigures };
}

/**
 * The refunds of Roof Care plans ended early (owner, Nov 19: "the refund should take if off of
 * roof cares income"): one row each, on the day the plan was ended and its refund confirmed,
 * with the refund as revenue below nothing. It is Roof Care's, so it comes off that line of
 * business and off the total. Paid once it is marked sent.
 */
export async function readCareRefunds(
  sb: Sb,
  from: string,
  to: string,
): Promise<MarginInvoiceRow[]> {
  const { data, error } = await sb
    .from("roof_care_plans")
    .select("id, plan_number, account_id, site_id, ended_on, refund_due, refund_sent_on")
    .gt("refund_due", 0)
    .gte("ended_on", from)
    .lte("ended_on", to);
  if (error) throw new Error(`Roof Care refunds: ${error.message}`);
  const plans = data ?? [];
  if (!plans.length) return [];
  const accounts = await readInChunks(uniq(plans.map((p) => p.account_id)), (chunk) =>
    sb.from("crm_accounts").select("id, name").in("id", chunk),
  );
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return plans.map((p) =>
    toMarginInvoiceRow({
      id: `refund:${p.id}`,
      kind: "service",
      carePlan: true,
      refundSite: p.site_id,
      number: `${p.plan_number != null ? `RC-${p.plan_number}` : "Roof Care"} refund`,
      day: p.ended_on ?? to,
      status: p.refund_sent_on ? "paid" : "final",
      subtotal: -(Number(p.refund_due) || 0),
      customer: accountName.get(p.account_id) ?? "",
      technician: null,
      technicianId: null,
      ticket: true,
      hours: 0,
      material: 0,
      labor: 0,
      other: 0,
      purchaseOrders: 0,
    }),
  );
}

/**
 * The refunds sent for a roof found smaller after a plan was paid (Nov 26;
 * roof_care_plans.size_refunds, written by roof_care_size_refund_sent). Each is money that went
 * back out of Roof Care's income, and until now none of them came off it: only the refund of a
 * plan ended early did. One row for each refund, on the day it was sent, as revenue below
 * nothing. Paid: it is recorded only once it is sent. The column is newer than the generated
 * types, so the read is loose.
 */
export async function readCareSizeRefunds(
  sb: Sb,
  from: string,
  to: string,
): Promise<MarginInvoiceRow[]> {
  const loose = sb as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        neq: (
          c: string,
          v: string,
        ) => Promise<{
          data:
            | {
                id: string;
                plan_number: number | null;
                account_id: string;
                site_id: string;
                size_refunds?: unknown;
              }[]
            | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const { data, error } = await loose
    .from("roof_care_plans")
    .select("id, plan_number, account_id, site_id, size_refunds")
    .neq("size_refunds", "[]");
  if (error) throw new Error(`Roof Care roof size refunds: ${error.message}`);
  const sent = (data ?? []).flatMap((p) =>
    readSizeRefunds(p.size_refunds)
      .map((r, n) => ({ plan: p, refund: r, n }))
      .filter((x) => x.refund.on >= from && x.refund.on <= to),
  );
  if (!sent.length) return [];
  const accounts = await readInChunks(uniq(sent.map((x) => x.plan.account_id)), (chunk) =>
    sb.from("crm_accounts").select("id, name").in("id", chunk),
  );
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return sent.map(({ plan: p, refund, n }) =>
    toMarginInvoiceRow({
      id: `size-refund:${p.id}:${n}`,
      kind: "service",
      carePlan: true,
      refundSite: p.site_id,
      number: `${p.plan_number != null ? `RC-${p.plan_number}` : "Roof Care"} roof size refund`,
      day: refund.on,
      status: "paid",
      subtotal: -refund.amount,
      customer: accountName.get(p.account_id) ?? "",
      technician: null,
      technicianId: null,
      ticket: true,
      hours: 0,
      material: 0,
      labor: 0,
      other: 0,
      purchaseOrders: 0,
    }),
  );
}

/** One period as Include asks for it: the invoices, the won bids, or both, in one list. */
async function readPeriod(
  sb: Sb,
  from: string,
  to: string,
  source: MarginSource,
): Promise<PeriodRead> {
  const [invoices, refunds, sizeRefunds, bids] = await Promise.all([
    source !== "bids" ? readInvoices(sb, from, to) : [],
    source !== "bids" ? readCareRefunds(sb, from, to) : [],
    source !== "bids" ? readCareSizeRefunds(sb, from, to) : [],
    source !== "service" ? readWonBids(sb, from, to) : { rows: [], bidsWithoutFigures: [] },
  ]);
  return {
    rows: [...invoices, ...refunds, ...sizeRefunds, ...bids.rows],
    bidsWithoutFigures: bids.bidsWithoutFigures,
  };
}

const periodOf = (
  from: string,
  to: string,
  invoices: MarginInvoiceRow[],
  groupBy: MarginGroupBy,
): MarginPeriod => ({ from, to, invoices, ...aggregateMarginRows(invoices, groupBy) });

/** The Roof Care plans in force today: how many, and what they bill a year. */
async function roofCareInForce(sb: Sb): Promise<RoofCareInForce> {
  const { data, error } = await sb.from("roof_care_plans").select("price").eq("status", "active");
  if (error) throw new Error(`Roof Care plans: ${error.message}`);
  const rows = data ?? [];
  return {
    plans: rows.length,
    yearly: Math.round(rows.reduce((n, r) => n + Number(r.price), 0) * 100) / 100,
  };
}

export const listMarginReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => INPUT.parse(d))
  .handler(async ({ data, context }): Promise<MarginReportResult> => {
    const sb: Sb = context.supabase;
    // The role comes from the caller's own profile row — never from the client.
    const { data: me, error: meErr } = await sb
      .from("profiles")
      .select("id, role")
      .eq("id", context.userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me || !isAdmin(me)) throw new Error("Forbidden: admin only");

    const source: MarginSource = data.source ?? "both";
    const line: MarginLineFilter = data.line ?? "all";
    const [current, earlier, roofCare] = await Promise.all([
      readPeriod(sb, data.from, data.to, source),
      data.compare ? readPeriod(sb, data.compare.from, data.compare.to, source) : null,
      roofCareInForce(sb),
    ]);

    // The table, the tiles and the older charts show the selected line alone; the three lines
    // side by side are worked from every row of the period, whatever is selected.
    return {
      ...periodOf(data.from, data.to, filterByLine(current.rows, line), data.groupBy),
      groupBy: data.groupBy,
      source,
      bidsWithoutFigures: current.bidsWithoutFigures,
      generatedAt: new Date().toISOString(),
      ...(earlier && data.compare
        ? {
            comparison: periodOf(
              data.compare.from,
              data.compare.to,
              filterByLine(earlier.rows, line),
              data.groupBy,
            ),
            earlierByLine: lineTotals(earlier.rows),
          }
        : {}),
      line,
      byLine: lineTotals(current.rows),
      lineMonths: lineMonthSeries(current.rows, data.from, data.to),
      roofCare,
    };
  });

/** The name in the invoice's bill_to snapshot (vendors.ts BillToSnapshot), "" when none. */
function billToName(billTo: unknown): string {
  const name = (billTo as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name.trim() : "";
}
