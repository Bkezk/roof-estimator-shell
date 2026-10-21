/**
 * The Margin report — the server side (owner, Oct 21; src/lib/margin-report.ts has the rules and
 * the definitions). Admins only: `listMarginReport` reads the caller's own profile row and throws
 * "Forbidden: admin only" unless its role is admin — never a flag from the client. Reads run under
 * the caller's own client (an admin reads everything by RLS, other users' profiles included).
 *
 * What is read, and why:
 *  - invoices with status final / sent / paid whose invoice_date is in From..To, every row a page
 *    at a time (read-all.ts: no 1,000-row ceiling). invoice_date is never null, so filtering on it
 *    loses nothing; invoiceDay still applies the finalized / created fallbacks for the grouping.
 *  - their tickets (technician, account, customer name), their lines (the cost split and the
 *    "po:<id>" sources), the tickets' APPROVED purchase orders, and — for tickets that have one —
 *    every invoice of the ticket whatever its status, because the PO counts toward the ticket's
 *    earliest LIVE invoice (a draft included; invoice-totals.ts poCostInvoice). Id lists go 100
 *    at a time (chunk-ids.ts), each chunk read to the end (readAll) so a chunk with over 1,000
 *    lines is not cut short.
 *  - names: the invoice's bill_to snapshot carries the customer's (or vendor's) name, as the
 *    Invoices list shows it (invoices.functions.ts listInvoices); a blank one falls back to the
 *    vendor, the account, then the ticket's customer_name. Technicians come from profiles.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { isAdmin } from "@/lib/access";
import { readInChunks } from "@/lib/chunk-ids";
import { invoiceLabel } from "@/lib/invoice-numbering";
import type { TicketInvoiceRef } from "@/lib/invoice-totals";
import {
  COUNTED_INVOICE_STATUSES,
  MARGIN_GROUPS,
  aggregateMargin,
  invoiceDay,
  lineCosts,
  poCostCarried,
  type MarginInvoiceIn,
  type MarginReportResult,
} from "@/lib/margin-report";
import { readAll } from "@/lib/read-all";

type Sb = SupabaseClient<Database>;

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a day as YYYY-MM-DD");
const INPUT = z
  .object({ from: YMD, to: YMD, groupBy: z.enum(MARGIN_GROUPS) })
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

/** Every row of `table` whose `column` is in `ids`: 100 ids a request, each read to its end. */
function byIds<T>(
  ids: readonly string[],
  page: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  return readInChunks(ids, (chunk) => readAll((from, to) => page(chunk, from, to)));
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

    const invoices = must(
      "invoices",
      await readAll((from, to) =>
        sb
          .from("invoices")
          .select(
            "id, number, display_number, status, invoice_date, finalized_at, created_at, subtotal, bill_to, bill_to_vendor_id, service_job_id",
          )
          .in("status", [...COUNTED_INVOICE_STATUSES])
          .gte("invoice_date", data.from)
          .lte("invoice_date", data.to)
          .order("id")
          .range(from, to),
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
      byIds(invoiceIds, (chunk, from, to) =>
        sb
          .from("invoice_lines")
          .select("id, invoice_id, kind, cost_total, source")
          .in("invoice_id", chunk)
          .order("id")
          .range(from, to),
      ),
      byIds(ticketIds, (chunk, from, to) =>
        sb
          .from("service_job_purchase_orders")
          .select("id, service_job_id, approved, price")
          .eq("approved", true)
          .in("service_job_id", chunk)
          .order("id")
          .range(from, to),
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
      readInChunks(accountIds, (chunk) =>
        sb.from("crm_accounts").select("id, name").in("id", chunk),
      ),
      readInChunks(techIds, (chunk) =>
        sb.from("profiles").select("id, full_name, email").in("id", chunk),
      ),
      byIds([...posByTicket.keys()], (chunk, from, to) =>
        sb
          .from("invoices")
          .select("id, number, display_number, status, created_at, service_job_id")
          .in("service_job_id", chunk)
          .order("id")
          .range(from, to),
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

    const rows: MarginInvoiceIn[] = invoices.map((i) => {
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
      return {
        id: i.id,
        day: invoiceDay(i),
        subtotal: Number(i.subtotal),
        customer,
        technician: ticket?.technician_id ? (techName.get(ticket.technician_id) ?? null) : null,
        ticket: !!ticket,
        ...costs,
        purchaseOrders: myPos.length
          ? poCostCarried(i.id, refsByTicket.get(i.service_job_id) ?? [], myPos, myLines)
          : 0,
      };
    });

    return {
      from: data.from,
      to: data.to,
      groupBy: data.groupBy,
      ...aggregateMargin(rows, data.groupBy),
      generatedAt: new Date().toISOString(),
    };
  });

/** The name in the invoice's bill_to snapshot (vendors.ts BillToSnapshot), "" when none. */
function billToName(billTo: unknown): string {
  const name = (billTo as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name.trim() : "";
}
