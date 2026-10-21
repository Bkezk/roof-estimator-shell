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
 *    from the labor and travel lines' qty, and the "po:<id>" sources), the tickets' APPROVED
 *    purchase orders, and — for tickets that have one — every invoice of the ticket whatever its
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
} from "@/lib/margin-report";
import { PAGE, afterId, readAll, type RowId } from "@/lib/read-all";

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
  const invoices = must(
    "invoices",
    await readAll((after) =>
      afterId(
        sb
          .from("invoices")
          .select(
            "id, number, display_number, status, invoice_date, finalized_at, created_at, subtotal, bill_to, bill_to_vendor_id, service_job_id",
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
  const invoiceIds = invoices.map((i) => i.id);
  const ticketIds = uniq(invoices.map((i) => i.service_job_id));

  const [tickets, lines, pos] = await Promise.all([
    readInChunks(ticketIds, (chunk) =>
      sb
        .from("service_jobs")
        .select("id, technician_id, account_id, customer_name")
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
          .select("id, service_job_id, approved, price")
          .eq("approved", true)
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
      .map((i) => ticketById.get(i.service_job_id)?.account_id),
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
  const refsByTicket = new Map<string, TicketInvoiceRef[]>();
  for (const r of ticketInvoices) {
    const list = refsByTicket.get(r.service_job_id) ?? [];
    list.push({ id: r.id, label: invoiceLabel(r), status: r.status, created_at: r.created_at });
    refsByTicket.set(r.service_job_id, list);
  }

  return invoices.map((i) => {
    const ticket = ticketById.get(i.service_job_id);
    const myLines = linesByInvoice.get(i.id) ?? [];
    const myPos = posByTicket.get(i.service_job_id) ?? [];
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
      // The read filtered on these statuses; the cast only names the narrower type.
      status: i.status as CountedInvoiceStatus,
      subtotal: Number(i.subtotal),
      customer,
      technician: technicianId ? (techName.get(technicianId) ?? null) : null,
      technicianId,
      ticket: !!ticket,
      ...costs,
      purchaseOrders: myPos.length
        ? poCostCarried(i.id, refsByTicket.get(i.service_job_id) ?? [], myPos, myLines)
        : 0,
    });
  });
}

/** A won bid as the read answers it (the select below; the JSON path alias is a plain text column). */
interface WonBidRead {
  id: string;
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
}

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
            "id, name, status, status_changed_at, updated_at, created_at, account_id, created_by, grand_total, figures, won_on, customer_name:data->customer->>name",
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
      bidsWithoutFigures.push({ id: b.id, name: b.name, day: bidWonDay(b) });
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
        }),
      ),
    );
  }
  return { rows, bidsWithoutFigures };
}

/** One period as Include asks for it: the invoices, the won bids, or both, in one list. */
async function readPeriod(
  sb: Sb,
  from: string,
  to: string,
  source: MarginSource,
): Promise<PeriodRead> {
  const [invoices, bids] = await Promise.all([
    source !== "bids" ? readInvoices(sb, from, to) : [],
    source !== "service" ? readWonBids(sb, from, to) : { rows: [], bidsWithoutFigures: [] },
  ]);
  return { rows: [...invoices, ...bids.rows], bidsWithoutFigures: bids.bidsWithoutFigures };
}

const periodOf = (
  from: string,
  to: string,
  invoices: MarginInvoiceRow[],
  groupBy: MarginGroupBy,
): MarginPeriod => ({ from, to, invoices, ...aggregateMarginRows(invoices, groupBy) });

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
    const [current, earlier] = await Promise.all([
      readPeriod(sb, data.from, data.to, source),
      data.compare ? readPeriod(sb, data.compare.from, data.compare.to, source) : null,
    ]);

    return {
      ...periodOf(data.from, data.to, current.rows, data.groupBy),
      groupBy: data.groupBy,
      source,
      bidsWithoutFigures: current.bidsWithoutFigures,
      generatedAt: new Date().toISOString(),
      ...(earlier && data.compare
        ? { comparison: periodOf(data.compare.from, data.compare.to, earlier.rows, data.groupBy) }
        : {}),
    };
  });

/** The name in the invoice's bill_to snapshot (vendors.ts BillToSnapshot), "" when none. */
function billToName(billTo: unknown): string {
  const name = (billTo as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name.trim() : "";
}
