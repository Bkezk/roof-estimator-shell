/**
 * Invoices on a trade bid, the server side (rules and shapes: bid-invoices.ts).
 *
 *   createBidInvoice  a new draft invoice on a won trade bid, numbered from the bid's job number
 *   listBidInvoices   the bid's invoices and what is left to bill, for the bid screen
 *
 * Everything after that (lines, Finalize, Paid, Void, the PDF) is the invoice's own and lives
 * in invoices.functions.ts, where an invoice with no ticket skips every ticket step.
 *
 * Who: whoever may use invoices, by the one gate of the invoice functions (`office`: an admin,
 * a manager, the Invoices tick). The Invoices tick does not come with Estimate access, and
 * without it row level security answers no bid. So the bid's job number is asked of the
 * database first (`trade_bid_number` is SECURITY DEFINER: it sees the bid whoever asks, and
 * refuses a draft, a roofing or a deleted bid in plain words), and only then is the bid read; a
 * person who may make invoices but may not open bids is told exactly that.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Json } from "@/integrations/supabase/types";
import {
  BID_INVOICE_NEEDS_WON,
  BID_INVOICE_NOT_TRADE,
  BID_INVOICE_NOTHING_LEFT,
  nextBidInvoiceNumber,
  tradeJobLabel,
  unbilledAmount,
  type BidInvoiceRow,
  type BidInvoicesResult,
} from "@/lib/bid-invoices";
import { isTradeBid } from "@/lib/bid-kind";
import { siteAddressLine } from "@/lib/crm.functions";
import { invoiceLabel } from "@/lib/invoice-numbering";
import { bidJobLabelOf, nameOf, numberTaken, office } from "@/lib/invoices.functions";
import { asTradeBidData } from "@/lib/trade-bid";
import { accountBillTo } from "@/lib/vendors";

const bidInput = (d: unknown) => z.object({ bid_id: z.string().uuid() }).parse(d);

/** May make invoices, may not read bids (the Invoices tick without Estimate access). */
export const BID_INVOICE_CANNOT_OPEN_BID =
  "You can make invoices but cannot open bids. Ask an admin for Estimate access, or have someone who can open the bid make its invoice.";
/** The live unique index on the invoice number tripped twice running. */
export const BID_INVOICE_NUMBER_RACE =
  "Someone else made an invoice for this bid at the same moment. Try again.";

/** What the one line of a trade bid's invoice is called when the bid's trade has no name. */
const NAMELESS_TRADE = "Work";

/**
 * A new draft invoice on a won trade bid: numbered from the bid's job number ("T-1001", then
 * "T-1001.2"), billed to the bid's customer, for what the bid has left to bill, as one line
 * that carries its share of the bid's cost. The office edits it from there like any draft (a
 * deposit is the line typed down; the next invoice is then the balance).
 */
export const createBidInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(bidInput)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const p = await office(context);
    const sb = context.supabase;
    // The job number first: the database function sees the bid whoever asks, takes the number
    // from the series the first time, and refuses in plain words (not won, not a trade bid,
    // deleted, not someone who makes invoices). Its message is the answer.
    const { data: tradeNumber, error: nErr } = await sb.rpc("trade_bid_number", {
      p_bid: data.bid_id,
    });
    if (nErr) throw new Error(nErr.message);
    if (typeof tradeNumber !== "number") throw new Error("The bid was not given a job number");
    const { data: bid, error } = await sb
      .from("bids")
      .select("id, name, kind, status, deleted_at, grand_total, figures, data, account_id, site_id")
      .eq("id", data.bid_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // The database knows the bid (it just numbered it) and this person may not read it.
    if (!bid) throw new Error(BID_INVOICE_CANNOT_OPEN_BID);
    // The database refused these already; said again for a bid that changed in between.
    if (bid.deleted_at) throw new Error("Bid not found (it may have been deleted)");
    if (!isTradeBid(bid)) throw new Error(BID_INVOICE_NOT_TRADE);
    if (bid.status !== "won") throw new Error(BID_INVOICE_NEEDS_WON);

    const trade = asTradeBidData(bid.data);
    const price = Number(bid.grand_total ?? 0);
    const [{ data: account, error: aErr }, { data: site, error: sErr }] = await Promise.all([
      bid.account_id
        ? sb.from("crm_accounts").select("*").eq("id", bid.account_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      bid.site_id
        ? sb.from("crm_sites").select("*").eq("id", bid.site_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (aErr) throw new Error(aErr.message);
    if (sErr) throw new Error(sErr.message);
    const { loadSettings, totals } = await import("@/lib/invoices.server");
    const settings = await loadSettings(sb);
    // Whom it is billed to, snapshotted as a ticket's invoice takes it: the customer account,
    // else the customer's name as typed on the bid.
    const bill_to = accountBillTo(account, trade?.customer.name);
    // Where the work is: the bid's property when it has one (its name and address, as on a
    // ticket), else the job address typed on the bid, under the bid's own name.
    const typed = trade?.customer;
    const property = site
      ? { name: site.name || bid.name, address: siteAddressLine(site) }
      : {
          name: bid.name,
          address: siteAddressLine({
            address1: typed?.projectAddress ?? null,
            address2: null,
            city: typed?.jobCity ?? null,
            state: typed?.jobState ?? null,
            zip: typed?.jobZip ?? null,
          }),
        };
    const scope = (trade?.scope ?? "").trim();
    const tradeName = (trade?.trade_name ?? "").trim() || NAMELESS_TRADE;

    /**
     * One try: the bid's invoices read fresh, the number and the amount worked out from them,
     * the draft inserted. `made` is null when the live unique index on the number refused it.
     */
    const attempt = async () => {
      const { data: existing, error: eErr } = await sb
        .from("invoices")
        .select("display_number, number, status, subtotal")
        .eq("bid_id", bid.id);
      if (eErr) throw new Error(eErr.message);
      const siblings = existing ?? [];
      // What the bid has left to bill: its price less its live invoices' subtotals.
      const amount = unbilledAmount(
        price,
        siblings.map((i) => ({ status: i.status, subtotal: Number(i.subtotal) })),
      );
      if (!(amount > 0)) throw new Error(BID_INVOICE_NOTHING_LEFT);
      const first = !siblings.some((i) => i.status !== "void");
      const line = {
        sort: 1,
        kind: "other",
        description: `${tradeName} per proposal${first ? "" : ", balance"}`,
        qty: 1,
        unit: "ea",
        rate: amount,
        total: amount,
        // No cost on a bid's invoice. The job's cost and margin are the bid's: the Margin
        // report counts the won bid and never its invoices, and the invoice page shows no cost
        // for one. (A cost carried here read as a loss the moment the amount was cut to a
        // deposit: seen in the browser run.)
        cost_rate: 0,
        cost_total: 0,
        on_date: null,
        // As a line typed by hand: it comes from no ticket record.
        source: null,
        taxable: true,
        // It prints on the customer's invoice in its own words ("Painting per proposal"). Left
        // at the default it would be folded into "Services and materials", which is how a
        // ticket's cost lines are kept off the customer's copy (seen in the browser run).
        show_on_invoice: true,
      };
      // The price of a trade bid already holds the sales tax paid on its materials, so the
      // invoice starts at 0%; the Tax % box on the draft is still the office's to set.
      const taxRate = 0;
      const { data: made, error: insErr } = await sb
        .from("invoices")
        .insert({
          bid_id: bid.id,
          service_job_id: null,
          number: null,
          display_number: nextBidInvoiceNumber(tradeNumber, siblings),
          status: "draft",
          bill_to: bill_to as unknown as Json,
          bill_to_vendor_id: null,
          property: property as unknown as Json,
          description: scope || null,
          payment_terms: settings.payment_terms,
          tax_rate: taxRate,
          ...totals([line], taxRate),
          created_by: context.userId,
          updated_by_name: nameOf(p),
        })
        .select("*")
        .single();
      if (insErr && numberTaken(insErr)) return { made: null, line };
      if (insErr || !made) throw new Error(insErr?.message ?? "The invoice was not created");
      return { made, line };
    };
    // Two made at once trip the live unique index on the number: worked out again once, from a
    // fresh read (the other one's amount is then billed, so this one is the balance or refused).
    let { made, line } = await attempt();
    if (!made) ({ made, line } = await attempt());
    if (!made) throw new Error(BID_INVOICE_NUMBER_RACE);
    const { error: lErr } = await sb.from("invoice_lines").insert({ ...line, invoice_id: made.id });
    if (lErr) {
      // No draft is left without its line: it would hold the number and count as billed.
      await sb.from("invoices").delete().eq("id", made.id);
      throw new Error(lErr.message);
    }
    return { id: made.id };
  });

/**
 * The bid's invoices, oldest first, and what the bid has left to bill, for the bid screen's
 * Invoices block. Someone who may not use invoices gets `allowed: false` and nothing else (the
 * block is not shown), never a refusal. Someone who may but cannot read the bid (no Estimate
 * access) still gets the rows; the job's label is then read off the first invoice's number,
 * and `unbilled` is 0 because the price is the bid's.
 */
export const listBidInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(bidInput)
  .handler(async ({ data, context }): Promise<BidInvoicesResult> => {
    // The same gate as every invoice function; its refusal is the answer here, not an error.
    const allowed = await office(context).then(
      () => true,
      () => false,
    );
    if (!allowed) return { allowed: false, job_label: null, invoices: [], unbilled: 0 };
    const sb = context.supabase;
    const [{ data: bid, error: bErr }, { data: rows, error }] = await Promise.all([
      sb.from("bids").select("id, trade_number, grand_total").eq("id", data.bid_id).maybeSingle(),
      sb
        .from("invoices")
        .select(
          "id, number, display_number, status, invoice_date, subtotal, total, paid_amount, created_at",
        )
        .eq("bid_id", data.bid_id)
        .order("created_at"),
    ]);
    if (bErr) throw new Error(bErr.message);
    if (error) throw new Error(error.message);
    const invoices: BidInvoiceRow[] = [...(rows ?? [])]
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
      .map((r) => ({
        id: r.id,
        display_number: invoiceLabel(r),
        status: r.status,
        invoice_date: r.invoice_date,
        subtotal: Number(r.subtotal),
        total: Number(r.total),
        paid_amount: Number(r.paid_amount),
      }));
    const fromFirst = invoices[0] ? bidJobLabelOf(invoices[0].display_number) : "";
    return {
      allowed: true,
      job_label: bid?.trade_number != null ? tradeJobLabel(bid.trade_number) : fromFirst || null,
      invoices,
      unbilled: bid ? unbilledAmount(Number(bid.grand_total ?? 0), invoices) : 0,
    };
  });
