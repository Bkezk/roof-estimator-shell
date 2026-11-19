/**
 * Invoices (phase C, docs/service-module-design.md §5.4–§5.5): numbered like the ticket — the
 * first "6012", further invoices on the same ticket "6012.2", "6012.3", a deleted or voided one
 * freeing its number (owner, Sep 30; invoice-numbering.ts) — built from time entries and
 * materials (invoices.server.ts), reviewed and sent by the office, marked paid by hand, exported
 * for Sage as CSV. Admins, managers and sales / project managers see and edit them
 * (`seesInvoices`; RLS: invoices_office) — owner, Oct 1: "Sales and PMs should be able to see
 * customers and invoices. However whatever is changed needs to be logged somewhere showing what
 * they did, when, and who." Every write to an invoice or its lines is logged by the database
 * (trigger audit_row → audit_log, migration 20261001080000), by everyone; nothing here logs.
 *
 * The ticket's stage: finalising (or sending a draft) marks it Invoiced, marking the invoice paid
 * marks it Closed. Those two stages are a manager's (ticket-stage.ts), so the invoice path sets
 * them through `set_ticket_stage_from_invoice` (ticketStageFromInvoice below).
 *
 * An invoice may belong to a won trade bid instead of a ticket (owner, Nov 17; invoices.bid_id
 * with service_job_id null, made by bid-invoices.functions.ts createBidInvoice). It is the same
 * invoice in every other way. Everything here that reads or moves a ticket sits behind one check,
 * `ofTicket`: an invoice with no ticket skips those steps and is never refused for lacking one.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { tradeJobLabel, type InvoiceBidRef } from "@/lib/bid-invoices";
import { planName, planNumberLabel } from "@/lib/roof-care-plan";
import { isPlanLine } from "@/lib/roof-care-travel";
import { databaseRpc } from "@/lib/database-rpc";
import { canAccess, managesTickets, seesInvoices } from "@/lib/access";
import { invoiceFileStem, invoiceLabel, nextInvoiceNumber } from "@/lib/invoice-numbering";
import { poIdOfLine } from "@/lib/invoice-po-lines";
import { clearsPayment, hasPayment, paidStatusFor } from "@/lib/invoice-payment";
import { siteAddressLine } from "@/lib/crm.functions";
import { accountBillTo, billToFor, vendorBillProblem } from "@/lib/vendors";
import { toBase64 } from "@/lib/webpush";
import {
  INSPECTION_BILL_MANAGER,
  INVOICE_NEEDS_AUTH,
  INVOICE_STAGES,
  isInspectionType,
} from "@/lib/ticket-stage";
import { stopClocksForOffice } from "@/lib/clock-close.server";
import {
  lineFlagsChanged,
  mergeRebuild,
  savedLineRow,
  type RebuildLine,
} from "@/lib/invoice-rebuild";
import { stampSent } from "@/lib/invoice-sent";
import {
  ALLOWANCE_UNANSWERED,
  allowanceAfterChange,
  allowanceTaken,
  allowanceUnanswered,
  billableBefore,
  isAllowanceLine,
} from "@/lib/roof-care-allowance";
import { mergeSendTo } from "@/lib/invoice-send-to";
import {
  canShareInvoice,
  SHARE_TOKEN_BYTES,
  shareBase,
  shareLinkLine,
  shareProblem,
  shareStateOf,
  shareUrl,
  type InvoiceShareState,
} from "@/lib/invoice-share";
import type { InvoiceBundle } from "@/lib/invoices.server";
import {
  fillSageIds,
  missingSageIds,
  type MissingSageId,
  type SageLookups,
} from "@/lib/sage-export";

export type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
export type InvoiceLineRow = Database["public"]["Tables"]["invoice_lines"]["Row"];
export type ServiceRateRow = Database["public"]["Tables"]["service_rates"]["Row"];
export type ServiceSettingsRow = Database["public"]["Tables"]["service_settings"]["Row"];
/**
 * Draft → Final → Paid, with Void to the side (owner, Nov 9: "condense the invoice statuses").
 * Sent is no longer a status: sending stamps sent_at / sent_to / sent_by_name on a final invoice
 * (the editor's "Sent Oct 3 to …", the list's Sent column), and a legacy "sent" row reads as
 * final (invoice-utils.ts asInvoiceStatus; 20261109090000 folds the stored rows).
 */
export const INVOICE_STATUSES = ["draft", "final", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const RATE_KINDS = ["standard", "urgent", "emergency"] as const;
export const RATE_KIND_LABELS: Record<(typeof RATE_KINDS)[number], string> = {
  standard: "Standard",
  urgent: "Urgent",
  emergency: "Emergency",
};

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
/**
 * The gate of every invoice function: the caller's profile, or a refusal. Exported for the
 * invoices made from a trade bid (bid-invoices.functions.ts), so the rule is one, not a copy.
 */
export async function office(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data || !(canAccess(data, "service") || canAccess(data, "customers")))
    throw new Error("Forbidden: Service access required");
  // Owner, Oct 1: managers / admins, and sales / project managers ("Sales and PMs should be
  // able to see customers and invoices"); every change is logged by the database.
  if (!seesInvoices(data)) throw new Error("Invoices are a manager's or sales'");
  return data;
}
export const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;

/**
 * Does the invoice belong to a service ticket? Every invoice has exactly one parent (the check
 * invoices_one_parent, 20261117090000): a ticket, or a won trade bid (bid_id). The ticket steps
 * (the ticket's stage and `set_ticket_stage_from_invoice`, its pointer service_jobs.invoice_id,
 * its stage events and follow-up, its clocks, Rebuild from ticket, its photos and purchase
 * orders) all sit behind this one check; a bid's invoice skips them and is never refused for
 * having no ticket. True also tells the compiler the ticket's id is there.
 */
export function ofTicket<T extends { service_job_id: string | null }>(
  inv: T,
): inv is T & { service_job_id: string } {
  return inv.service_job_id !== null;
}

/** Rebuild from ticket on an invoice that has no ticket. */
export const INVOICE_NO_TICKET_TO_REBUILD =
  "This invoice was made from a trade bid. It has no ticket to rebuild from.";
/** The same on a Roof Care plan year's invoice (Nov 19). */
export const INVOICE_PLAN_NOT_REBUILT =
  "This is a Roof Care plan's invoice for the year. It has no ticket to rebuild from.";

/**
 * The trade job's label read off one of its invoice numbers: "T-1001.2" is job "T-1001". For
 * someone who may not read the bid itself (no Estimate access), whose own number is then not
 * to be had; "" when there is no number to go by.
 */
export const bidJobLabelOf = (displayNumber: string | null | undefined): string =>
  (displayNumber ?? "").trim().replace(/\.\d+$/, "");

/** The name in a Bill To snapshot (vendors.ts BillToSnapshot), "" when none. */
const billToName = (billTo: unknown): string => {
  const name = (billTo as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
};

/**
 * Whom the emailed invoice says it is for (sendInvoice): the property's name, else the ticket's
 * customer. An invoice with no ticket (a trade bid's, Nov 17) names its Bill To there instead.
 */
const emailedFor = (b: InvoiceBundle): string =>
  (b.invoice.property as { name?: string }).name ??
  (b.job ? b.job.customer_name : billToName(b.invoice.bill_to));
/** Who is making the invoice (created_by, updated_by_name). */
type Actor = {
  id: string;
  name: string;
  /** An admin or a manager: who may start an inspection's first invoice (Nov 16). */
  manages?: boolean;
};

/**
 * Mark the invoice's ticket Invoiced (finalised; the ticket then points at this invoice) or
 * Closed (paid). Those stages are a manager's (ticket-stage.ts; trigger service_jobs_stage_rule),
 * but whoever may finalise an invoice (`seesInvoices`, a sales / project manager too) sets them
 * this one way: `public.set_ticket_stage_from_invoice` is SECURITY DEFINER, re-checks that the
 * caller sees invoices and that the ticket has such an invoice, and is the path the trigger lets
 * through. A refusal is reported (the invoice itself is already saved).
 */
async function ticketStageFromInvoice(
  sb: SupabaseClient<Database>,
  jobId: string,
  stage: "invoiced" | "closed",
  invoiceId: string,
) {
  const { error } = await sb.rpc("set_ticket_stage_from_invoice", {
    p_job: jobId,
    p_stage: stage,
    p_invoice: invoiceId,
  });
  if (error)
    throw new Error(
      `The invoice is saved, but the ticket was not marked ${stage === "invoiced" ? "Invoiced" : "Closed"}: ${error.message}`,
    );
}
/**
 * Re-read the ticket after a stage change and run the stage automation (ticket-events: the
 * office's "Invoice ticket #…" follow-up). Returns the ticket as it is now (null when gone).
 */
async function stageEvent(
  sb: SupabaseClient<Database>,
  jobId: string,
  prevStage: string | null,
  actor: { id: string; name: string | null },
  // A void says so, so the office reads "back to Authorized — its invoice was voided" rather
  // than "authorized — ready to invoice" (owner, Oct 6).
  opts?: { reason?: "void" },
) {
  const { data: row } = await sb.from("service_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!row) return null;
  const { afterTicketStage } = await import("@/lib/ticket-events.server");
  await afterTicketStage(row, prevStage, actor, sb, opts);
  return row;
}

/**
 * Close the ticket's own follow-up ("Follow up: Ticket #…", its technician's): a ticket's timer
 * ends once it is Invoiced or Closed (followups.server.ts). The stage automation above syncs
 * only the office's invoice follow-up, so every path that invoices or closes a ticket calls this.
 */
async function closeTicketFollowup(
  sb: SupabaseClient<Database>,
  job: { id: string; account_id: string | null; technician_id: string | null },
  actor: Actor,
  reason: "stage invoiced" | "stage closed",
) {
  const { syncFollowup } = await import("@/lib/followups.server");
  await syncFollowup(
    {
      kind: "ticket",
      itemId: job.id,
      accountId: job.account_id,
      assigneeId: job.technician_id,
      title: "",
      url: "",
      closing: true,
      closeReason: reason,
      dueDate: null,
      actorId: actor.id,
      actorName: actor.name,
    },
    sb,
  );
}

/**
 * Why a draft on a ticket at `stage` may not be finalised (null = it may): a Done ticket is
 * reviewed (Authorized) before it is invoiced (INVOICE_STAGES; owner, Oct 5). createInvoiceFor
 * checks this when the draft is made; finalizeDraft checks it again (owner, Oct 6, QA audit: an
 * older draft on a ticket still at Done was finalised straight past Authorized). An invoice with
 * no ticket (stage null) is unaffected. Pure: tested in invoice-finalize-authorized.test.ts.
 */
export function finalizeStageProblem(stage: string | null | undefined): string | null {
  if (stage == null) return null;
  return INVOICE_STAGES.includes(stage) ? null : INVOICE_NEEDS_AUTH;
}

/**
 * Does finalising an invoice leave the ticket's stage alone (owner, Oct 12, item 6)? A Closed
 * ticket stays Closed when a second invoice on it is finalised — it used to go back to Invoiced.
 * An Authorized or Invoiced ticket is set (or kept) Invoiced, pointing at the new invoice. The
 * database guard says the same (set_ticket_stage_from_invoice, the Oct 12 migration).
 */
export function invoiceKeepsTicketStage(stage: string | null | undefined): boolean {
  return stage === "closed";
}

/**
 * Finalise a draft: the one routine behind Finalize and Send on a draft (audit, Oct 2: Send
 * skipped the no-lines check and left the ticket's follow-up open). Refuses an invoice with no
 * lines, or on a ticket not yet Authorized (finalizeStageProblem), before anything is written;
 * stores the PDF; stamps the invoice final; moves the ticket to Invoiced through the rpc
 * (ticketStageFromInvoice: sales / project managers too); runs the stage automation (the
 * invoice follow-up) and closes the ticket's follow-up.
 *
 * An invoice made from a trade bid (Nov 17) has no ticket: it is checked, drawn, stored and
 * stamped final the same way, and every ticket step below is skipped (`ofTicket`).
 */
async function finalizeDraft(
  sb: SupabaseClient<Database>,
  b: InvoiceBundle,
  actor: Actor,
): Promise<InvoiceRow> {
  if (b.invoice.status !== "draft") throw new Error("Already final");
  if (!b.lines.length) throw new Error("The invoice has no lines");
  // The ticket's stage as loaded with the bundle (loadBundle reads it fresh for this call).
  const stageProblem = finalizeStageProblem(ofTicket(b.invoice) ? b.job?.stage : null);
  if (stageProblem) throw new Error(stageProblem);
  // A repair at a property whose Roof Care plan has minor repairs left (owner, Nov 19): the
  // office answers on the invoice whether it uses the plan, before it is final. Asked here, ahead
  // of the PDF, so nothing is stored for an invoice that is refused; the database refuses it too.
  if (ofTicket(b.invoice)) {
    const { invoiceAllowanceOf } = await import("@/lib/roof-care-allowance.functions");
    const allowance = await invoiceAllowanceOf(sb, b.invoice, b.lines);
    if (allowanceUnanswered(allowance)) throw new Error(ALLOWANCE_UNANSWERED(allowance.left));
  }
  const { renderInvoicePdf } = await import("@/lib/invoices.server");
  const pdf = await renderInvoicePdf(sb, b);
  const path = pdfPath(b.invoice);
  const { error: upErr } = await sb.storage
    .from("service")
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`Could not store the PDF: ${upErr.message}`);
  const { data: updated, error } = await sb
    .from("invoices")
    .update({
      status: "final",
      finalized_at: new Date().toISOString(),
      pdf_path: path,
      updated_by_name: actor.name,
    })
    .eq("id", b.invoice.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  // The ticket's steps, for an invoice that has a ticket (a trade bid's has none: it is final
  // now and that is all).
  if (ofTicket(b.invoice) && b.job) {
    // The ticket goes Invoiced, also when a sales / project manager finalises (the rpc) —
    // unless it is Closed already: a second invoice never reopens it (owner, Oct 12, item 6). A
    // technician's clock still running on it is stopped first and its time written
    // (clock-close.server.ts, Oct 28); a clock that cannot be stopped refuses the stage change,
    // the invoice itself being saved already.
    if (!invoiceKeepsTicketStage(b.job.stage)) {
      try {
        await stopClocksForOffice(sb, { id: b.job.id, number: b.job.number }, "invoiced", {
          id: actor.id,
          name: actor.name,
        });
      } catch (e) {
        throw new Error(
          `The invoice is saved, but the ticket was not marked Invoiced: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await ticketStageFromInvoice(sb, b.invoice.service_job_id, "invoiced", updated.id);
    }
    await stageEvent(sb, b.invoice.service_job_id, b.job.stage, actor);
    await closeTicketFollowup(sb, b.job, actor, "stage invoiced");
  }
  return updated;
}

/** Where the final PDF is stored: by number, plus the id so a void keeps its own file. */
const pdfPath = (inv: InvoiceRow) => `invoices/${invoiceFileStem(inv)}-${inv.id.slice(0, 8)}.pdf`;

/**
 * The invoice's PDF as it is downloaded and emailed (audit, Oct 2: a "frozen" invoice changed
 * after later ticket edits, because download and send drew it again from the live ticket). A
 * draft is drawn fresh (it is a preview). A final, sent, paid or void invoice is the PDF stored
 * when it was finalised (pdf_path in the "service" bucket), never drawn again — unless that file
 * is missing: then it is drawn once from the invoice as it stands, stored (never over an
 * existing file) and a warning logged. Exported for the public share-link route
 * (src/routes/i.$token.ts), which serves the same bytes with the admin client.
 */
export async function invoicePdf(
  sb: SupabaseClient<Database>,
  b: InvoiceBundle,
): Promise<Uint8Array> {
  const { renderInvoicePdf } = await import("@/lib/invoices.server");
  if (b.invoice.status === "draft") return renderInvoicePdf(sb, b);
  const stored = b.invoice.pdf_path;
  if (stored) {
    const { data, error } = await sb.storage.from("service").download(stored);
    if (!error && data) return new Uint8Array(await data.arrayBuffer());
  }
  const path = stored ?? pdfPath(b.invoice);
  console.warn(
    `Invoice ${invoiceLabel(b.invoice)} (${b.invoice.id}): the stored PDF ${stored ?? "(none recorded)"} is missing; drawn again from the invoice and stored at ${path}`,
  );
  const pdf = await renderInvoicePdf(sb, b);
  const { error: upErr } = await sb.storage
    .from("service")
    .upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    console.warn(`Invoice ${b.invoice.id}: could not store the redrawn PDF: ${upErr.message}`);
  } else if (!stored) {
    const { error } = await sb.from("invoices").update({ pdf_path: path }).eq("id", b.invoice.id);
    if (error) console.warn(`Invoice ${b.invoice.id}: could not record pdf_path: ${error.message}`);
  }
  return pdf;
}

export interface InvoiceWithLines {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  /**
   * The trade bid the invoice belongs to (Nov 17, bid-invoices.ts); null or absent on a ticket's
   * invoice. Set by getInvoice.
   */
  bid?: InvoiceBidRef | null;
}
async function withLines(
  sb: SupabaseClient<Database>,
  invoice: InvoiceRow,
): Promise<InvoiceWithLines> {
  const { data: lines, error } = await sb
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", invoice.id)
    .order("sort");
  if (error) throw new Error(error.message);
  return { invoice: shown(invoice), lines: lines ?? [] };
}
type LineWrite = Database["public"]["Tables"]["invoice_lines"]["Insert"];
const LINE_COLS = [
  "sort",
  "kind",
  "description",
  "qty",
  "unit",
  "rate",
  "total",
  "cost_rate",
  "cost_total",
  "on_date",
  "source",
  "taxable",
] as const;
/**
 * Does the line as saved differ from the stored one (numbers compared as numbers)? A flip of
 * the typed-by-hand flag alone counts (owner, Oct 6): it is what Rebuild from ticket reads.
 */
function lineChanged(prev: InvoiceLineRow, next: LineWrite): boolean {
  // The typed-price flag and Show on invoice count too (owner, Oct 8: Show did not stay).
  if (lineFlagsChanged(prev, next)) return true;
  return LINE_COLS.some((k) => {
    const a = prev[k] ?? null;
    const b = next[k] ?? null;
    if (typeof a === "number" || typeof b === "number") return Number(a) !== Number(b);
    return a !== b;
  });
}

/** A voided legacy invoice keeps its number as a negative; the screens show the original. */
const shown = (inv: InvoiceRow): InvoiceRow => ({
  ...inv,
  number: inv.number == null ? null : Math.abs(inv.number),
});

/** The ticket's live invoices, the newest first. */
async function liveInvoices(sb: SupabaseClient<Database>, jobId: string) {
  const { data, error } = await sb
    .from("invoices")
    .select("*")
    .eq("service_job_id", jobId)
    .neq("status", "void") // a voided invoice has released its number
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The draft invoice of a Roof Care plan inspection, made when the ticket is authorized (owner,
 * Nov 18: "billed half at first visit half at second visit and invoiced"), so nobody has to
 * remember to start it: with an invoice the ticket sits in the waiting-for-invoice lists like
 * any other. Nothing is made for a ticket that is not a plan's, one that already has a live
 * invoice, or a visit that bills nothing (a storm inspection). Answers whether it made one.
 */
export async function ensureCarePlanInvoice(
  sb: SupabaseClient<Database>,
  jobId: string,
  actor: { id: string; name: string | null },
): Promise<boolean> {
  const { data: job, error } = await sb
    .from("service_jobs")
    .select("id, roof_care_visit_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job?.roof_care_visit_id) return false;
  const { carePlanVisit } = await import("@/lib/invoices.server");
  const visit = await carePlanVisit(sb, job.roof_care_visit_id);
  const { billsItself } = await import("@/lib/roof-care-invoice");
  if (!billsItself(visit)) return false;
  if ((await liveInvoices(sb, jobId)).length) return false;
  await createInvoiceFor(sb, jobId, { id: actor.id, name: actor.name ?? "", manages: true }, true);
  return true;
}

/**
 * After an invoice is deleted or voided the ticket must not keep pointing at it (audit, Nov 16,
 * fix 5). A person with Customers and Invoices but no Service access cannot write the ticket:
 * the update above then changes no row and reports no error, and an inspection stayed "billed"
 * for good. The database now moves the pointer itself (trigger invoices_ticket_pointer); this
 * reads the ticket back and says so if it still names the dead invoice.
 */
async function pointerCleared(
  sb: SupabaseClient<Database>,
  jobId: string,
  deadInvoiceId: string,
  failed: (m: string) => Error,
) {
  const { data: t, error } = await sb
    .from("service_jobs")
    .select("invoice_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw failed(error.message);
  if (t && t.invoice_id === deadInvoiceId)
    throw failed("it still points at this invoice. Tell a manager");
}

/** The ticket's invoice, created as a draft from its time and materials on first call. */
export const getOrCreateInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    const sb = context.supabase;
    const [existing] = await liveInvoices(sb, data.job_id);
    if (existing) return withLines(sb, existing);
    return createInvoiceFor(
      sb,
      data.job_id,
      { id: context.userId, name: nameOf(p), manages: managesTickets(p) },
      true,
    );
  });

/**
 * Another invoice on the same ticket ("6012.2", "6012.3", …), a draft from the ticket. Billed to
 * the customer account, or to a vendor picked up front (owner, Oct 1: "Sometimes it's both a
 * customer and a vendor, so we could make two invoices for that if needed").
 */
export const createAnotherInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        bill_to_vendor_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    return createInvoiceFor(
      context.supabase,
      data.job_id,
      { id: context.userId, name: nameOf(p), manages: managesTickets(p) },
      false,
      data.bill_to_vendor_id ?? null,
    );
  });

/**
 * The vendor an invoice may be billed to (owner, Oct 1: "Sometimes invoices go to vendors"):
 * found, not archived and billable (vendorBillProblem), else a plain message.
 */
async function billableVendor(sb: SupabaseClient<Database>, vendorId: string) {
  const { data: vendor, error } = await sb
    .from("vendors")
    .select("*")
    .eq("id", vendorId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const problem = vendorBillProblem(vendor);
  if (problem || !vendor) throw new Error(problem ?? "That vendor was not found");
  return vendor;
}

/** A ticket's invoices for the chips on the ticket (void ones too, greyed). */
export interface TicketInvoiceSummary {
  id: string;
  label: string;
  status: string;
  total: number;
  created_at: string;
  /** The purchase orders billed as a line on this invoice (invoice-totals.ts posBilledElsewhere). */
  po_ids: string[];
}
export const listTicketInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TicketInvoiceSummary[]> => {
    await office(context);
    const { data: rows, error } = await context.supabase
      .from("invoices")
      .select("id, number, display_number, status, total, created_at")
      .eq("service_job_id", data.job_id)
      .order("created_at");
    if (error) throw new Error(error.message);
    // Which purchase orders each invoice bills as a line (Nov 16): the Internal fold must not
    // also carry those on the ticket's first invoice.
    const ids = (rows ?? []).map((r) => r.id);
    const poIds = new Map<string, string[]>();
    if (ids.length) {
      const { data: poLines, error: lErr } = await context.supabase
        .from("invoice_lines")
        .select("invoice_id, source")
        .in("invoice_id", ids)
        .not("source", "is", null);
      if (lErr) throw new Error(lErr.message);
      for (const l of poLines ?? []) {
        const id = poIdOfLine(l);
        if (id) poIds.set(l.invoice_id, [...(poIds.get(l.invoice_id) ?? []), id]);
      }
    }
    return (rows ?? []).map((r) => ({
      id: r.id,
      label: invoiceLabel(r),
      status: r.status,
      total: Number(r.total),
      created_at: r.created_at,
      po_ids: poIds.get(r.id) ?? [],
    }));
  });

/** Postgres unique violation on the live display-number index (two creates at once). */
export const numberTaken = (e: { code?: string; message: string }) =>
  e.code === "23505" && /display_number/.test(e.message);

/**
 * Make a new draft invoice for the ticket: the lowest free number (invoice-numbering.ts),
 * its lines from the ticket's time and materials. A race for the same number trips the live
 * unique index; the number is worked out again once.
 */
async function createInvoiceFor(
  sb: SupabaseClient<Database>,
  jobId: string,
  actor: Actor,
  /** getOrCreate: a draft made meanwhile by another tab is the one to open, not a ".2". */
  onlyIfNone = false,
  /** Bill a vendor instead of the customer account (invoices.bill_to_vendor_id). */
  billToVendorId: string | null = null,
): Promise<InvoiceWithLines> {
  const userId = actor.id;
  const byName = actor.name;
  const { data: job, error } = await sb
    .from("service_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Ticket not found");
  // M9 (owner, Oct 5): a Done ticket is reviewed (Authorized) before it is invoiced.
  if (!INVOICE_STAGES.includes(job.stage)) throw new Error(INVOICE_NEEDS_AUTH);
  // An inspection is not invoiced unless a manager chooses to bill it (owner, Nov 16): its
  // first invoice is a manager's to start ("Invoice this inspection" on the ticket). Once it
  // has one, it is billed like any ticket. "Has one" is read from the invoices themselves, not
  // from the ticket's pointer (audit, Nov 16, fix 4): a pointer left on a deleted invoice let
  // anyone through. The database says the same (trigger invoices_inspection_rule).
  // A Roof Care plan inspection is billed as a matter of course (owner, Nov 18: half the plan
  // at each visit), so anyone who makes invoices starts its first one.
  if (isInspectionType(job.service_type) && !job.roof_care_visit_id && !actor.manages) {
    const live = await liveInvoices(sb, job.id);
    if (!live.length) throw new Error(INSPECTION_BILL_MANAGER);
  }
  const [{ data: account }, { data: site }] = await Promise.all([
    job.account_id
      ? sb.from("crm_accounts").select("*").eq("id", job.account_id).maybeSingle()
      : Promise.resolve({ data: null }),
    job.site_id
      ? sb.from("crm_sites").select("*").eq("id", job.site_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const { buildLinesFromJob, loadSettings, totals } = await import("@/lib/invoices.server");
  const vendor = billToVendorId ? await billableVendor(sb, billToVendorId) : null;
  // A new draft marks its PO lines up (invoices.po_markup defaults true; owner, Oct 14).
  const [lines, settings] = await Promise.all([
    buildLinesFromJob(sb, job.id, { poMarkup: true }),
    loadSettings(sb),
  ]);
  // The customer's tax exemption is the customer's: an invoice to a vendor takes the standard
  // rate (the draft's Tax % can still be changed).
  const taxRate = !vendor && account?.tax_exempt ? 0 : Number(settings.tax_rate);
  const t = totals(lines, taxRate);
  // Who it is billed to, snapshotted: the vendor, or the customer account (as always).
  const bill_to = billToFor(vendor, account, job.customer_name);
  const property = {
    name: site?.name ?? job.site_name ?? "",
    address: site ? siteAddressLine(site) : (job.site_address ?? ""),
  };
  const insert = async () => {
    const { data: siblings, error: sErr } = await sb
      .from("invoices")
      .select("display_number, number, status")
      .eq("service_job_id", job.id);
    if (sErr) throw new Error(sErr.message);
    return sb
      .from("invoices")
      .insert({
        service_job_id: job.id,
        number: null,
        display_number: nextInvoiceNumber(job.number, siblings ?? []),
        po_number: job.po_number,
        job_code: job.job_number,
        bill_to: bill_to as unknown as Json,
        bill_to_vendor_id: vendor?.id ?? null,
        property: property as unknown as Json,
        description: job.closing_notes,
        payment_terms: settings.payment_terms,
        tax_rate: taxRate,
        // Its own material markup from today's default (owner, Oct 6: per invoice).
        material_markup: Number(settings.material_markup),
        ...t,
        created_by: userId,
        updated_by_name: byName,
      })
      .select("*")
      .single();
  };
  let { data: inv, error: insErr } = await insert();
  if (insErr && numberTaken(insErr)) {
    if (onlyIfNone) {
      const [made] = await liveInvoices(sb, job.id);
      if (made) return withLines(sb, made);
    }
    ({ data: inv, error: insErr } = await insert());
  }
  if (insErr || !inv) throw new Error(insErr?.message ?? "The invoice was not created");
  if (lines.length) {
    // Every row names the same columns (roof-care-invoice.ts withLineSwitches): the plan's own
    // line and the ticket's lines did not, and the database refused them all (Nov 19).
    const { withLineSwitches } = await import("@/lib/roof-care-invoice");
    const { error: lErr } = await sb
      .from("invoice_lines")
      .insert(lines.map((l) => ({ ...withLineSwitches(l), invoice_id: inv.id })));
    if (lErr) {
      // An invoice with a total and no lines is not left behind (Nov 19: each press left one).
      const { error: dErr } = await sb.from("invoices").delete().eq("id", inv.id);
      throw new Error(
        dErr
          ? `${lErr.message}. An empty invoice ${inv.display_number ?? ""} was left behind and could not be removed (${dErr.message}): delete it on the Invoices page`
          : lErr.message,
      );
    }
  }
  // The ticket points at its newest invoice. The database sets the pointer too when the ticket
  // had none (trigger invoices_ticket_pointer), so someone without Service access still leaves
  // the ticket right; a refusal here is said, never dropped (audit, Nov 16, fix 5).
  const { error: pErr } = await sb
    .from("service_jobs")
    .update({ invoice_id: inv.id })
    .eq("id", job.id);
  if (pErr)
    throw new Error(`The invoice was made, but the ticket was not updated: ${pErr.message}`);
  return withPlanAllowance(sb, inv);
}

/**
 * A draft just made or rebuilt, with the property's Roof Care plan taken into account (owner,
 * Nov 19: "can we have the tick auto ticked if there is still any allowance left?"): while the
 * plan has minor repairs left it covers the invoice by itself, and the office unticks it or
 * types a smaller amount in the plan box.
 */
async function withPlanAllowance(
  sb: SupabaseClient<Database>,
  inv: InvoiceRow,
): Promise<InvoiceWithLines> {
  const made = await withLines(sb, inv);
  if (!ofTicket(inv)) return made;
  // The leak call's travel first, then the minor repairs credit over what is still charged.
  const { syncPlanLines } = await import("@/lib/roof-care-travel.functions");
  if (!(await syncPlanLines(sb, inv, made.lines))) return made;
  const { data: again, error } = await sb.from("invoices").select("*").eq("id", inv.id).single();
  if (error) throw new Error(error.message);
  return withLines(sb, again);
}

export const getInvoice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    await office(context);
    const { data: inv, error } = await context.supabase
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found");
    const [shownInvoice, bid] = await Promise.all([
      withLines(context.supabase, inv),
      invoiceBidRef(context.supabase, inv),
    ]);
    return { ...shownInvoice, bid };
  });

/**
 * The trade bid an invoice belongs to, for the invoice page (Nov 17); null for a ticket's
 * invoice. Read with the caller's own client: the Invoices tick does not come with Estimate
 * access, and row level security then answers no bid. That person still opens the invoice; the
 * page is told the bid is not theirs to open (`readable: false`) and the job's label is read
 * off the invoice's own number.
 */
async function invoiceBidRef(
  sb: SupabaseClient<Database>,
  inv: InvoiceRow,
): Promise<InvoiceBidRef | null> {
  if (inv.roof_care_plan_id) return invoicePlanRef(sb, inv, inv.roof_care_plan_id);
  if (!inv.bid_id) return null;
  const { data, error } = await sb
    .from("bids")
    .select("id, name, account_id, trade_number, trade_name:data->>trade_name")
    .eq("id", inv.bid_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // The JSON path's alias is a plain text column in the answer.
  const bid = data as unknown as {
    id: string;
    name: string | null;
    account_id: string | null;
    trade_number: number | null;
    trade_name: string | null;
  } | null;
  const fromNumber = bidJobLabelOf(invoiceLabel(inv));
  if (!bid)
    return {
      id: inv.bid_id,
      name: "",
      trade_name: "",
      job_label: fromNumber,
      account_id: null,
      readable: false,
    };
  return {
    id: bid.id,
    name: bid.name ?? "",
    trade_name: bid.trade_name ?? "",
    job_label: bid.trade_number != null ? tradeJobLabel(bid.trade_number) : fromNumber,
    account_id: bid.account_id ?? null,
    readable: true,
  };
}

/**
 * The Roof Care plan a plan year's invoice belongs to (Nov 19), in the shape the page already
 * reads for a trade bid: the label is the plan's number, the name is the property's, and `plan`
 * says it is a plan and where its property is. A reader who cannot read the plan still opens
 * the invoice; the label is then read off the invoice's own number.
 */
async function invoicePlanRef(
  sb: SupabaseClient<Database>,
  inv: InvoiceRow,
  planId: string,
): Promise<InvoiceBidRef> {
  const { data: plan, error } = await sb
    .from("roof_care_plans")
    .select("id, plan, plan_number, account_id, site_id")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const property = ((inv.property ?? {}) as { name?: string }).name ?? "";
  if (!plan)
    return {
      id: planId,
      name: property,
      trade_name: "Roof Care plan",
      job_label: invoiceLabel(inv),
      account_id: null,
      readable: false,
    };
  return {
    id: plan.id,
    name: property,
    trade_name: `${planName(plan.plan)} plan`,
    job_label: plan.plan_number != null ? planNumberLabel(plan.plan_number) : invoiceLabel(inv),
    account_id: plan.account_id,
    readable: true,
    plan: { site_id: plan.site_id },
  };
}

/**
 * Rebuild a draft's lines from the ticket (after its time or material was corrected). Lines
 * added by hand on the invoice and prices changed by hand are kept (invoice-rebuild.ts). An
 * invoice made from a trade bid has no ticket to rebuild from: refused in plain words.
 */
export const rebuildInvoiceLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    const sb = context.supabase;
    const { data: inv, error } = await sb
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found");
    if (!ofTicket(inv))
      throw new Error(
        inv.roof_care_plan_id ? INVOICE_PLAN_NOT_REBUILT : INVOICE_NO_TICKET_TO_REBUILD,
      );
    if (inv.status !== "draft") throw new Error("Only a draft can be rebuilt");
    const { buildLinesFromJob, totals } = await import("@/lib/invoices.server");
    const built = await buildLinesFromJob(sb, inv.service_job_id, {
      markup: inv.material_markup == null ? null : Number(inv.material_markup),
      // The PO lines follow this draft's Mark up switch (owner, Oct 14).
      poMarkup: inv.po_markup !== false,
      // A care plan inspection's own line stays on the invoice that has it (Nov 19).
      invoiceId: inv.id,
    });
    const { data: oldLines, error: oErr } = await sb
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", inv.id);
    if (oErr) throw new Error(oErr.message);
    // Owner, Oct 5: the hand-added lines and the prices changed by hand stay.
    const hasFlag = (oldLines ?? []).some((l) => "rate_overridden" in l);
    // Show on invoice is kept too, once 20261008151500 is applied (owner, Oct 8).
    const hasShow = (oldLines ?? []).some((l) => "show_on_invoice" in l);
    const hasHide = (oldLines ?? []).some((l) => "hide_price" in l);
    const lines = mergeRebuild((oldLines ?? []) as RebuildLine[], built as RebuildLine[]).map(
      (l) => {
        const { rate_overridden, show_on_invoice, hide_price, ...rest } = l;
        const row = {
          sort: rest.sort,
          kind: rest.kind,
          description: rest.description,
          qty: rest.qty,
          unit: rest.unit,
          rate: rest.rate,
          total: rest.total,
          cost_rate: rest.cost_rate,
          cost_total: rest.cost_total,
          on_date: rest.on_date,
          source: rest.source,
          taxable: rest.taxable,
          invoice_id: inv.id,
        };
        return {
          ...row,
          ...(hasFlag ? { rate_overridden: !!rate_overridden } : {}),
          ...(hasShow ? { show_on_invoice: !!show_on_invoice } : {}),
          ...(hasHide ? { hide_price: !!hide_price } : {}),
        };
      },
    );
    // The Roof Care plan's allowance line is not the ticket's, so the builder does not make it
    // (Nov 19): it is carried over, held to what the rebuilt invoice bills. With nothing left to
    // cover it goes, and the question is open again.
    const allowanceOld = (oldLines ?? []).filter(isAllowanceLine);
    const allowanceKept = allowanceOld.length
      ? allowanceAfterChange(allowanceTaken(allowanceOld), billableBefore(lines))
      : 0;
    if (allowanceKept > 0) {
      const from = allowanceOld[0]!;
      lines.push({
        sort: lines.reduce((m, l) => Math.max(m, l.sort), -1) + 1,
        kind: from.kind,
        description: from.description,
        qty: 1,
        unit: from.unit,
        rate: -allowanceKept,
        total: -allowanceKept,
        cost_rate: 0,
        cost_total: 0,
        on_date: null,
        source: from.source,
        taxable: false,
        invoice_id: inv.id,
        ...(hasFlag ? { rate_overridden: true } : {}),
        ...(hasShow ? { show_on_invoice: true } : {}),
        ...(hasHide ? { hide_price: false } : {}),
      });
    }
    const allowanceGone = allowanceOld.length > 0 && !(allowanceKept > 0);
    // The lines are thrown away and made again (new ids): the log shows each removed and added.
    const { error: dErr } = await sb.from("invoice_lines").delete().eq("invoice_id", inv.id);
    if (dErr) throw new Error(dErr.message);
    if (lines.length) {
      const { error: lErr } = await sb.from("invoice_lines").insert(lines);
      if (lErr) throw new Error(lErr.message);
    }
    const t = totals(lines, Number(inv.tax_rate));
    const { data: updated, error: uErr } = await sb
      .from("invoices")
      .update({
        ...t,
        updated_by_name: nameOf(p),
        ...(allowanceGone ? { care_allowance_choice: null, care_allowance_plan_id: null } : {}),
      })
      .eq("id", inv.id)
      .select("*")
      .single();
    if (uErr) throw new Error(uErr.message);
    return withPlanAllowance(sb, updated);
  });

const lineSchema = z.object({
  id: z.number().int().optional(),
  kind: z.enum(["travel", "labor", "material", "other"]),
  description: z.string().trim().min(1).max(300),
  qty: z.number().finite().min(0),
  unit: z.string().trim().min(1).max(20).default("ea"),
  rate: z.number().finite(),
  cost_rate: z.number().finite().default(0),
  on_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  taxable: z.boolean().default(true),
  source: z.string().max(200).nullable().optional(),
  /**
   * Typed by hand (owner, Oct 6): the editor sets it when the Rate box of a ticket line is
   * edited and clears it when a markup change re-prices the line. Saved as sent, so a markup
   * change and Rebuild from ticket leave the typed price alone.
   */
  rate_overridden: z.boolean().default(false),
  /** Listed on its own on the customer's PDF (owner, Oct 8); off = in the one summary row. */
  show_on_invoice: z.boolean().default(false),
  /** Listed without its rate and amount (owner, Oct 8: "hide the price"). */
  hide_price: z.boolean().default(false),
});
const saveSchema = z.object({
  id: z.string().uuid(),
  invoice_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  po_number: z.string().trim().max(60).nullable().optional(),
  job_code: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  payment_terms: z.string().trim().max(500).nullable().optional(),
  tax_rate: z.number().min(0).max(1).optional(),
  /** This invoice's material markup (0.75 = 75 %; owner, Oct 6). */
  material_markup: z.number().min(0).max(10).optional(),
  /**
   * Mark up the PO lines (owner, Oct 14): true = cost plus material_markup, false = at cost.
   * The editor re-prices the lines itself and sends them; the switch is stored so Rebuild from
   * ticket prices them the same way.
   */
  po_markup: z.boolean().optional(),
  /**
   * The Send To printed on this invoice only (owner, Oct 8): its name and address lines, laid
   * over the invoice's own copy (mergeSendTo). Instructions and the Sage id are never sent.
   */
  send_to: z
    .object({
      name: z.string().max(200),
      address1: z.string().max(200),
      address2: z.string().max(200),
      city: z.string().max(100),
      state: z.string().max(40),
      zip: z.string().max(20),
    })
    .partial()
    .optional(),
  /** Bill To on a draft: a billable vendor's id, or null for the customer account. */
  bill_to_vendor_id: z.string().uuid().nullable().optional(),
  lines: z.array(lineSchema).max(500).optional(),
});
export type InvoiceSaveInput = z.input<typeof saveSchema>;

/** Edit a draft's header and lines; totals are recomputed here. */
export const saveInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    const sb = context.supabase;
    const { data: inv, error } = await sb
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "draft") throw new Error("This invoice is final; void it to change it");
    const { totals } = await import("@/lib/invoices.server");
    if (data.lines) {
      const { data: oldLines, error: oErr } = await sb
        .from("invoice_lines")
        .select("*")
        .eq("invoice_id", inv.id);
      if (oErr) throw new Error(oErr.message);
      // Each saved line carries its old id (the editor sends it): a kept line is updated in
      // place (only if it changed), a new one inserted, a dropped one deleted. The database's
      // audit log (audit_row) then records each line that changed, not every line removed and
      // added again. An id that is not this invoice's counts as a new line.
      const old = new Map((oldLines ?? []).map((l) => [l.id, l]));
      const kept = new Set<number>();
      // The Roof Care plan's allowance line is the plan box's (Nov 19): the editor's save never
      // types over it, adds one or drops it, whatever it sent.
      // (The leak call's travel line is the plan's too, and is kept the same way.)
      for (const l of oldLines ?? []) if (isPlanLine(l)) kept.add(l.id);
      const fresh: LineWrite[] = [];
      const edits: { id: number; row: LineWrite }[] = [];
      data.lines.forEach((l, i) => {
        const prev = l.id != null ? old.get(l.id) : undefined;
        if (isPlanLine(l) || (prev && isPlanLine(prev))) {
          if (prev && isPlanLine(prev) && prev.sort !== i)
            edits.push({ id: prev.id, row: { sort: i } as LineWrite });
          return;
        }
        // A price typed by hand is remembered as the editor says (rate_overridden), so Rebuild
        // from ticket keeps it (owner, Oct 5; Oct 6: the flag, not a ratio test). Only once the
        // column exists (20261005170000): before that the row has no such key (savedLineRow).
        const row: LineWrite = savedLineRow(inv.id, i, l, prev);
        if (prev && !kept.has(prev.id)) {
          kept.add(prev.id);
          if (lineChanged(prev, row)) edits.push({ id: prev.id, row });
        } else fresh.push(row);
      });
      const removed = (oldLines ?? []).filter((l) => !kept.has(l.id)).map((l) => l.id);
      if (removed.length) {
        const { error: dErr } = await sb
          .from("invoice_lines")
          .delete()
          .in("id", removed)
          .eq("invoice_id", inv.id);
        if (dErr) throw new Error(dErr.message);
      }
      const updates = await Promise.all(
        edits.map((e) =>
          sb.from("invoice_lines").update(e.row).eq("id", e.id).eq("invoice_id", inv.id),
        ),
      );
      const upErr = updates.find((r) => r.error)?.error;
      if (upErr) throw new Error(upErr.message);
      if (fresh.length) {
        const { error: lErr } = await sb.from("invoice_lines").insert(fresh);
        if (lErr) throw new Error(lErr.message);
      }
    }
    const readLines = async () =>
      (await sb.from("invoice_lines").select("*").eq("invoice_id", inv.id)).data ?? [];
    let lines = await readLines();
    // The property's Roof Care plan (Nov 19): while it has minor repairs left it covers this
    // invoice by itself, a typed amount never takes more than the invoice now bills, and an
    // invoice switched to a vendor takes nothing. Whom it is billed to is as this save leaves it.
    if (ofTicket(inv)) {
      const { syncPlanLines } = await import("@/lib/roof-care-travel.functions");
      const billedTo =
        data.bill_to_vendor_id === undefined
          ? (inv.bill_to_vendor_id ?? null)
          : data.bill_to_vendor_id;
      if (await syncPlanLines(sb, { ...inv, bill_to_vendor_id: billedTo }, lines)) {
        lines = await readLines();
        const { data: again } = await sb
          .from("invoices")
          .select("care_allowance_choice, care_allowance_plan_id, care_travel_choice")
          .eq("id", inv.id)
          .maybeSingle();
        if (again) Object.assign(inv, again);
      }
    }
    const taxRate = data.tax_rate ?? Number(inv.tax_rate);
    const t = totals(lines, taxRate);
    const patch: Database["public"]["Tables"]["invoices"]["Update"] = {
      ...t,
      tax_rate: taxRate,
      ...(data.material_markup === undefined ? {} : { material_markup: data.material_markup }),
      ...(data.po_markup === undefined ? {} : { po_markup: data.po_markup }),
      updated_by_name: nameOf(p),
    };
    if (data.invoice_date) patch.invoice_date = data.invoice_date;
    if (data.due_date !== undefined) patch.due_date = data.due_date;
    if (data.po_number !== undefined) patch.po_number = data.po_number;
    if (data.job_code !== undefined) patch.job_code = data.job_code;
    if (data.description !== undefined) patch.description = data.description;
    if (data.payment_terms !== undefined) patch.payment_terms = data.payment_terms;
    // Bill To changed on the draft (account ↔ vendor, or another vendor): the column, and the
    // snapshot taken again from whoever it is billed to now. A final invoice never gets here.
    if (
      data.bill_to_vendor_id !== undefined &&
      data.bill_to_vendor_id !== (inv.bill_to_vendor_id ?? null)
    ) {
      patch.bill_to_vendor_id = data.bill_to_vendor_id;
      if (data.bill_to_vendor_id) {
        const vendor = await billableVendor(sb, data.bill_to_vendor_id);
        patch.bill_to = billToFor(vendor, null, null) as unknown as Json;
      } else if (ofTicket(inv)) {
        const { data: job, error: jErr } = await sb
          .from("service_jobs")
          .select("account_id, customer_name")
          .eq("id", inv.service_job_id)
          .maybeSingle();
        if (jErr) throw new Error(jErr.message);
        if (!job) throw new Error("The invoice's ticket is gone");
        const { data: account, error: aErr } = job.account_id
          ? await sb.from("crm_accounts").select("*").eq("id", job.account_id).maybeSingle()
          : { data: null, error: null };
        if (aErr) throw new Error(aErr.message);
        patch.bill_to = accountBillTo(account, job.customer_name) as unknown as Json;
      } else {
        // A trade bid's invoice (Nov 17): the customer is the bid's account, else the name
        // typed on the bid. Someone who may not read the bid (no Estimate access) cannot be
        // told who that is, so the Bill To stays as stored, the vendor and its snapshot
        // together (the column set above is taken back), rather than a customer column over a
        // vendor's address.
        const customer = inv.roof_care_plan_id
          ? await planCustomer(sb, inv.roof_care_plan_id)
          : await bidCustomer(sb, inv.bid_id);
        if (customer) {
          const { data: account, error: aErr } = customer.account_id
            ? await sb.from("crm_accounts").select("*").eq("id", customer.account_id).maybeSingle()
            : { data: null, error: null };
          if (aErr) throw new Error(aErr.message);
          patch.bill_to = accountBillTo(account, customer.customer_name) as unknown as Json;
        } else delete patch.bill_to_vendor_id;
      }
    }
    // Send To edited on this invoice only: over the copy just taken, else the saved one.
    if (data.send_to) {
      const base = (patch.bill_to ?? inv.bill_to ?? {}) as Record<string, unknown>;
      patch.bill_to = mergeSendTo(base, data.send_to) as unknown as Json;
    }
    const { data: updated, error: uErr } = await sb
      .from("invoices")
      .update(patch)
      .eq("id", inv.id)
      .select("*")
      .single();
    if (uErr) throw new Error(uErr.message);
    return withLines(sb, updated);
  });

/**
 * Whom a trade bid's work is for: its customer account and the customer's name as typed on the
 * bid (the JSON path, so the bid's whole data never crosses the wire). Null when the caller may
 * not read the bid (row level security: no Estimate access) or it is gone.
 */
async function bidCustomer(
  sb: SupabaseClient<Database>,
  bidId: string | null,
): Promise<{ account_id: string | null; customer_name: string | null } | null> {
  if (!bidId) return null;
  const { data, error } = await sb
    .from("bids")
    .select("account_id, customer_name:data->customer->>name")
    .eq("id", bidId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const bid = data as unknown as { account_id: string | null; customer_name: string | null } | null;
  return bid
    ? { account_id: bid.account_id ?? null, customer_name: bid.customer_name ?? null }
    : null;
}

/** Whom a Roof Care plan year's invoice is for: the plan's customer account (Nov 19). */
async function planCustomer(
  sb: SupabaseClient<Database>,
  planId: string,
): Promise<{ account_id: string | null; customer_name: string | null } | null> {
  const { data, error } = await sb
    .from("roof_care_plans")
    .select("account_id")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { account_id: data.account_id, customer_name: null } : null;
}

/** The PDF as base64 (for preview / download in the browser). */
export const renderInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ base64: string; file_name: string }> => {
    await office(context);
    const { loadBundle } = await import("@/lib/invoices.server");
    const b = await loadBundle(context.supabase, data.id);
    // A draft is drawn now; anything later is the PDF stored at finalising (invoicePdf).
    const pdf = await invoicePdf(context.supabase, b);
    return {
      base64: toBase64(pdf),
      file_name: `Invoice-${invoiceFileStem(b.invoice)}.pdf`,
    };
  });

// ---- The share link (owner, Oct 13) ----------------------------------------------------------

/** A fresh share token: 32 random bytes as base64url (43 characters; isShareToken). */
async function newShareToken(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

/** The invoice row, or a plain "not found". */
async function invoiceRow(sb: SupabaseClient<Database>, id: string): Promise<InvoiceRow> {
  const { data, error } = await sb.from("invoices").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Invoice not found");
  return data;
}

/**
 * The invoice with a share token: the one it has, else a new one stored now (share_token,
 * share_created_at). Written only where the row still has none, so two tabs making the link at
 * once end up with the same token (the loser re-reads). Refuses a draft or a void invoice
 * (shareProblem). The database logs the change (audit_row: "share token — → …").
 */
async function ensureShareToken(
  sb: SupabaseClient<Database>,
  inv: InvoiceRow,
  byName: string,
): Promise<InvoiceRow> {
  const problem = shareProblem(inv.status);
  if (problem) throw new Error(problem);
  if (inv.share_token) return inv;
  const { data, error } = await sb
    .from("invoices")
    .update({
      share_token: await newShareToken(),
      share_created_at: new Date().toISOString(),
      updated_by_name: byName,
    })
    .eq("id", inv.id)
    .is("share_token", null)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;
  // Made meanwhile by someone else: theirs is the link.
  const again = await invoiceRow(sb, inv.id);
  if (!again.share_token) throw new Error("The share link was not saved");
  return again;
}

/**
 * Make the invoice's share link (or return the one it has): the token and its view counts. The
 * screen builds the URL from its own origin (shareUrl), so APP_URL is not needed for this. Office
 * only; a draft or a void invoice is refused with a plain message.
 */
export const createInvoiceShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceShareState> => {
    const p = await office(context);
    const inv = await invoiceRow(context.supabase, data.id);
    return shareStateOf(await ensureShareToken(context.supabase, inv, nameOf(p)));
  });

/**
 * Turn the share link off: the token (and when it was made) cleared, so the link answers "no
 * longer active" from now on; the view counts stay. A new link can be made later. Office only.
 */
export const revokeInvoiceShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceShareState> => {
    const p = await office(context);
    const sb = context.supabase;
    const inv = await invoiceRow(sb, data.id);
    if (!inv.share_token) return shareStateOf(inv);
    const { data: updated, error } = await sb
      .from("invoices")
      .update({ share_token: null, share_created_at: null, updated_by_name: nameOf(p) })
      .eq("id", inv.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return shareStateOf(updated);
  });

/** Freeze the invoice: status final, PDF stored, the ticket Invoiced (finalizeDraft). */
export const finalizeInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    const sb = context.supabase;
    const { loadBundle } = await import("@/lib/invoices.server");
    const b = await loadBundle(sb, data.id);
    const updated = await finalizeDraft(sb, b, { id: context.userId, name: nameOf(p) });
    return withLines(sb, updated);
  });

/**
 * Email the (final) invoice PDF to the billing contacts; finalises a draft first.
 *
 * The email carries the share link too (owner, Oct 13: customers should have the link): the
 * invoice's token, made here when it has none yet (every invoice that can be sent can be shared,
 * canShareInvoice). The link needs the app's public address, APP_URL (as the reminder emails do,
 * notify.server.ts appUrl): when APP_URL is not set the line is left out altogether — never a
 * broken link — and the token still exists, so the office can copy the link from the invoice.
 */
export const sendInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        to: z.array(z.string().email()).min(1).max(10),
        message: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    const sb = context.supabase;
    const { loadBundle, emailInvoice } = await import("@/lib/invoices.server");
    let b = await loadBundle(sb, data.id);
    if (b.invoice.status === "draft") {
      // Finalised exactly as Finalize does (no lines refused, the ticket's follow-up closed).
      await finalizeDraft(sb, b, { id: context.userId, name: nameOf(p) });
      b = await loadBundle(sb, data.id);
    }
    if (b.invoice.status === "void") throw new Error("This invoice is void");
    // The share link goes with the email (made now when the invoice has none); the line is
    // left out when APP_URL is not set (see the doc comment above).
    let shareLine = "";
    if (canShareInvoice(b.invoice.status)) {
      const shared = await ensureShareToken(sb, b.invoice, nameOf(p));
      b = { ...b, invoice: shared };
      const base = shareBase(process.env["APP_URL"]);
      if (base && shared.share_token)
        shareLine = `\n\n${shareLinkLine(shareUrl(base, shared.share_token))}`;
    }
    // The PDF stored at finalising is the one attached (invoicePdf), not a fresh drawing.
    const pdf = await invoicePdf(sb, b);
    const label = invoiceLabel(b.invoice);
    const subject = b.settings.email_subject.replace("{number}", label);
    const text = `${data.message ?? b.settings.email_message}\n\nInvoice #${label} for ${emailedFor(b)}: $${Number(b.invoice.total).toFixed(2)}.\n${b.invoice.payment_terms ?? ""}${shareLine}`;
    const r = await emailInvoice({
      to: data.to,
      subject,
      text,
      pdf,
      fileName: `Invoice-${invoiceFileStem(b.invoice)}.pdf`,
    });
    if (!r.ok) throw new Error(`The invoice was not sent: ${r.error}`);
    // Who sent it, for the list's Sent column (stampSent copes with a database not yet migrated).
    const { data: updated, error } = await stampSent(
      (patch) => sb.from("invoices").update(patch).eq("id", b.invoice.id).select("*").single(),
      {
        // The status stays (final, or paid when sent again after payment): Sent is a stamp.
        sent_at: new Date().toISOString(),
        sent_to: data.to as unknown as Json,
        updated_by_name: nameOf(p),
      },
      nameOf(p),
    );
    if (error || !updated) throw new Error(error?.message ?? "The invoice was not updated");
    return withLines(sb, updated);
  });

/**
 * Record the payment (Sage stays the ledger). The ticket is not closed here any more (owner,
 * Oct 5: "close by hand"): a manager moves it to Closed from its stage. `ticket_closed` is
 * always false; kept for the screen that reads it.
 */
export const markInvoicePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number().finite().min(0),
        method: z.string().trim().max(40).nullable().optional(),
        ref: z.string().trim().max(80).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<InvoiceWithLines & { ticket_closed: boolean }> => {
    const p = await office(context);
    const sb = context.supabase;
    // A draft is not paid on the server either (the screen offers Mark paid only once final):
    // it has no stored PDF and never went through the finalise rules (finalizeDraft).
    const { data: cur, error: rErr } = await sb
      .from("invoices")
      .select("id, status, total")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!cur || cur.status === "void") throw new Error("Invoice not found, or void");
    if (cur.status === "draft") throw new Error("Finalize the invoice first");
    // Paid means paid in full (owner, Nov 9): a smaller amount is recorded and the invoice stays
    // Final with the balance due (invoice-payment.ts).
    // A $0 amount takes the payment off (owner, Nov 10): the day, the method and the reference
    // go with it, so the invoice is a plain Final again — Mark paid and Void are back.
    const off = clearsPayment(cur.total, data.amount);
    const { data: inv, error } = await sb
      .from("invoices")
      .update(
        off
          ? {
              status: "final",
              paid_on: null,
              paid_amount: 0,
              paid_method: null,
              paid_ref: null,
              updated_by_name: nameOf(p),
            }
          : {
              status: paidStatusFor(cur.total, data.amount),
              paid_on: data.paid_on,
              paid_amount: data.amount,
              paid_method: data.method ?? null,
              paid_ref: data.ref ?? null,
              updated_by_name: nameOf(p),
            },
      )
      .eq("id", data.id)
      .in("status", ["final", "paid"])
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found, or void");
    // A Roof Care plan year's invoice paid in full (Nov 19): the database has just started the
    // plan and made the tickets that are due (invoices_plan_paid). They are announced as a
    // ticket made by hand is. Best effort: the plan is started either way.
    if (inv.roof_care_plan_id && inv.status === "paid" && cur.status !== "paid") {
      try {
        const [{ ticketIdsOfPlan }, { announceCarePlanTickets }] = await Promise.all([
          import("@/lib/roof-care-plan.functions"),
          import("@/lib/service.functions"),
        ]);
        await announceCarePlanTickets(sb, await ticketIdsOfPlan(sb, inv.roof_care_plan_id), {
          id: context.userId,
          name: nameOf(p),
        });
      } catch (e) {
        console.error("Could not announce the plan's tickets", e instanceof Error ? e.message : e);
      }
    }
    // The ticket keeps its stage (owner, Oct 5: a manager closes it by hand).
    return { ...(await withLines(sb, inv)), ticket_closed: false };
  });

/**
 * Void an invoice (a mistake); the ticket goes back to Authorized and a new draft can be made.
 * An invoice made from a trade bid (Nov 17) is deleted or voided the same way and that is all:
 * it has no ticket to point elsewhere or to send back (`ofTicket`), and its number and its
 * amount are the bid's to bill again.
 */
export const voidInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await office(context);
    const sb = context.supabase;
    const { data: inv, error } = await sb
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found");
    // The screen never offers Void on a paid invoice; the server says the same (Nov 4, bug 8).
    if (inv.status === "paid")
      throw new Error("A paid invoice cannot be voided — edit the payment first");
    // Nor one with a payment recorded on it (a partial payment, Nov 9): the money is on record.
    if (hasPayment(inv))
      throw new Error("A payment is recorded on this invoice, so it cannot be voided");
    // The ticket's stage before this, for the stage automation (audit, Oct 2: a hard-coded
    // "invoiced" re-sent "done — invoice ready" when a draft was deleted on a Done ticket).
    let prevStage: string | null = null;
    if (ofTicket(inv)) {
      const { data: jobBefore, error: jErr } = await sb
        .from("service_jobs")
        .select("stage")
        .eq("id", inv.service_job_id)
        .maybeSingle();
      if (jErr) throw new Error(jErr.message);
      prevStage = jobBefore?.stage ?? null;
    }
    if (inv.status === "draft") {
      // A draft is deleted outright; its number is free for the next invoice on the ticket.
      const { error: dErr } = await sb.from("invoices").delete().eq("id", inv.id);
      if (dErr) throw new Error(dErr.message);
    } else {
      // Release the number: the void stays on record under it (a legacy integer number is kept
      // as a negative), and the next invoice on the ticket takes it again. If this one was
      // already exported to Sage, the bookkeeper needs a credit there — the list shows the void
      // row with its export stamp.
      const { error: vErr } = await sb
        .from("invoices")
        .update({
          status: "void",
          ...(inv.number != null ? { number: -Math.abs(inv.number) } : {}),
          updated_by_name: nameOf(p),
        })
        .eq("id", inv.id);
      if (vErr) throw new Error(vErr.message);
    }
    // Everything below is the ticket's (its pointer, its stage): a trade bid's invoice has none.
    if (!ofTicket(inv)) return;
    const gone = inv.status === "draft" ? "deleted" : "void";
    const ticketFailed = (m: string) =>
      new Error(`The invoice is ${gone}, but the ticket was not updated: ${m}`);
    // Another live invoice on the ticket keeps it where it is; the last one sends an Invoiced or
    // Closed ticket back to Done (a ticket at Done or earlier keeps its stage).
    const [other] = await liveInvoices(sb, inv.service_job_id);
    if (other) {
      const { error: oErr } = await sb
        .from("service_jobs")
        .update({ invoice_id: other.id, updated_by_name: nameOf(p) })
        .eq("id", inv.service_job_id);
      if (oErr) throw ticketFailed(oErr.message);
      await pointerCleared(sb, inv.service_job_id, inv.id, ticketFailed);
      return;
    }
    // Back to Authorized, not Done (owner, Oct 5): the work was reviewed already. Authorized is
    // a manager's stage, so it goes through set_ticket_stage_from_invoice (a sales / PM may void).
    const backToAuthorized = prevStage === "invoiced" || prevStage === "closed";
    const { error: uErr } = await sb
      .from("service_jobs")
      .update({ invoice_id: null, updated_by_name: nameOf(p) })
      .eq("id", inv.service_job_id);
    if (uErr) throw ticketFailed(uErr.message);
    await pointerCleared(sb, inv.service_job_id, inv.id, ticketFailed);
    if (backToAuthorized) {
      const { error: sErr } = await databaseRpc(sb)("set_ticket_stage_from_invoice", {
        p_job: inv.service_job_id,
        p_stage: "authorized",
        p_invoice: null,
      });
      if (sErr) throw ticketFailed(sErr.message);
      await stageEvent(
        sb,
        inv.service_job_id,
        prevStage,
        { id: context.userId, name: nameOf(p) },
        { reason: "void" },
      );
    }
  });

export interface InvoiceListRow extends InvoiceRow {
  customer_name: string;
  site_name: string | null;
  /** The number as shown: display_number, else the legacy integer. */
  label: string;
}
export const listInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        status: z.enum([...INVOICE_STATUSES, "unpaid"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<InvoiceListRow[]> => {
    await office(context);
    let q = context.supabase
      .from("invoices")
      .select("*")
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);
    // "unpaid" (the Unpaid chip / the Owner view's tile): final, not yet marked paid.
    if (data.status === "unpaid") q = q.eq("status", "final");
    else if (data.status) q = q.eq("status", data.status);
    if (data.from) q = q.gte("invoice_date", data.from);
    if (data.to) q = q.lte("invoice_date", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => {
      const bt = (r.bill_to ?? {}) as { name?: string };
      const pr = (r.property ?? {}) as { name?: string };
      return {
        ...shown(r),
        customer_name: bt.name ?? "",
        site_name: pr.name ?? null,
        label: invoiceLabel(r),
      };
    });
  });

/**
 * The Sage CSV for a date range (finals and later). Nothing is stamped here (Nov 4, bug 6 of the
 * Nov 3 review): the file used to be stamped exported inside this request, before it reached the
 * browser, so a dropped connection marked every invoice exported with no file — and "only new"
 * then hid them on the retry. The dialog downloads the file, then calls markSageExported with
 * the ids. Blank Sage customer numbers are filled from the current vendor / customer records
 * (lib/sage-export.ts; bug 7) and what is still blank comes back as `missing` for the warning.
 */
export const exportSageCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        only_unexported: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      csv: string;
      count: number;
      file_name: string;
      ids: string[];
      missing: MissingSageId[];
    }> => {
      await office(context);
      const sb = context.supabase;
      let q = sb
        .from("invoices")
        .select("*")
        .in("status", ["final", "paid"])
        .gte("invoice_date", data.from)
        .lte("invoice_date", data.to)
        .order("invoice_date")
        .order("created_at");
      if (data.only_unexported) q = q.is("sage_exported_at", null);
      const { data: invs, error } = await q;
      if (error) throw new Error(error.message);
      const ids = (invs ?? []).map((i) => i.id);
      const { data: lines } = ids.length
        ? await sb.from("invoice_lines").select("*").in("invoice_id", ids).order("sort")
        : { data: [] as InvoiceLineRow[] };
      // Keyed by parent for the lookup (sageKeyed): a trade bid's invoice has no ticket.
      const keyed = (invs ?? []).map(sageKeyed);
      const filled = fillSageIds(keyed, await sageLookups(sb, keyed));
      const { sageCsv } = await import("@/lib/invoices.server");
      const csv = sageCsv(
        filled.map((invoice) => ({
          invoice,
          lines: (lines ?? []).filter((l) => l.invoice_id === invoice.id),
        })),
      );
      return {
        csv,
        count: ids.length,
        file_name: `sage-invoices-${data.from}-to-${data.to}.csv`,
        ids,
        missing: missingSageIds(filled),
      };
    },
  );

/**
 * The key an invoice's customer is looked up under in the Sage export. sage-export.ts looks a
 * blank customer number up by the invoice's ticket (`service_job_id`, SageLookups
 * accountIdsByJob). An invoice made from a trade bid (Nov 17) has no ticket; it is looked up by
 * its bid instead, under "bid:<id>", which no ticket's id can be. Only the lookup reads this
 * copy's service_job_id: the CSV never prints it and nothing is written back.
 */
const SAGE_BID_KEY = "bid:";
/** A Roof Care plan year's invoice (Nov 19) is looked up by its plan, under "plan:<id>". */
const SAGE_PLAN_KEY = "plan:";
type SageKeyed = InvoiceRow & { service_job_id: string };
const sageKeyed = (i: InvoiceRow): SageKeyed => ({
  ...i,
  service_job_id:
    i.service_job_id ??
    (i.roof_care_plan_id
      ? `${SAGE_PLAN_KEY}${i.roof_care_plan_id}`
      : `${SAGE_BID_KEY}${i.bid_id ?? ""}`),
});

/** The current Sage numbers for the invoices whose snapshot has none (the vendor's, or the ticket's customer's; for a trade bid's invoice, the bid's customer's). */
async function sageLookups(sb: Ctx["supabase"], invs: readonly SageKeyed[]): Promise<SageLookups> {
  const blank = invs.filter(
    (i) => !((i.bill_to ?? {}) as { external_id?: string }).external_id?.trim(),
  );
  const vendorIds = [
    ...new Set(blank.map((i) => i.bill_to_vendor_id).filter((v): v is string => !!v)),
  ];
  const toCustomer = blank.filter((i) => !i.bill_to_vendor_id);
  const jobIds = [
    ...new Set(
      toCustomer.filter((i) => !i.bid_id && !i.roof_care_plan_id).map((i) => i.service_job_id),
    ),
  ];
  const planIds = [
    ...new Set(toCustomer.map((i) => i.roof_care_plan_id).filter((x): x is string => !!x)),
  ];
  const plans = planIds.length
    ? await sb.from("roof_care_plans").select("id, account_id").in("id", planIds)
    : { data: [] as { id: string; account_id: string | null }[] };
  // The bids' accounts, read with the caller's client: someone who may not read bids (no
  // Estimate access) gets none, and the number then stays blank and is listed as missing.
  const bidIds = [...new Set(toCustomer.map((i) => i.bid_id).filter((b): b is string => !!b))];
  const bids = bidIds.length
    ? await sb.from("bids").select("id, account_id").in("id", bidIds)
    : { data: [] as { id: string; account_id: string | null }[] };
  const [vendors, jobs] = await Promise.all([
    vendorIds.length
      ? // sage_customer_id (20261104150000) is newer than the generated types: a loose read.
        (sb as unknown as SupabaseClient)
          .from("vendors")
          .select("id, sage_customer_id")
          .in("id", vendorIds)
      : Promise.resolve({ data: [] as { id: string; sage_customer_id: string | null }[] }),
    jobIds.length
      ? sb.from("service_jobs").select("id, account_id").in("id", jobIds)
      : Promise.resolve({ data: [] as { id: string; account_id: string | null }[] }),
  ]);
  const accountIds = [
    ...new Set(
      [...(jobs.data ?? []), ...(bids.data ?? []), ...(plans.data ?? [])]
        .map((j) => j.account_id)
        .filter((a): a is string => !!a),
    ),
  ];
  const accounts = accountIds.length
    ? await sb.from("crm_accounts").select("id, external_id").in("id", accountIds)
    : { data: [] as { id: string; external_id: string | null }[] };
  const byAccount = new Map((accounts.data ?? []).map((a) => [a.id, a.external_id]));
  return {
    vendorIds: new Map(
      ((vendors.data ?? []) as { id: string; sage_customer_id: string | null }[]).map((v) => [
        v.id,
        v.sage_customer_id,
      ]),
    ),
    accountIdsByJob: new Map([
      ...(jobs.data ?? []).map(
        (j) => [j.id, j.account_id ? byAccount.get(j.account_id) : null] as const,
      ),
      ...(bids.data ?? []).map(
        (b) =>
          [`${SAGE_BID_KEY}${b.id}`, b.account_id ? byAccount.get(b.account_id) : null] as const,
      ),
      ...(plans.data ?? []).map(
        (pl) =>
          [
            `${SAGE_PLAN_KEY}${pl.id}`,
            pl.account_id ? byAccount.get(pl.account_id) : null,
          ] as const,
      ),
    ]),
  };
}

/**
 * Stamp the invoices of a downloaded Sage file as exported (Nov 4, bug 6): called by the dialog
 * once the file is in the browser's hands. Only rows with no stamp yet are stamped — an invoice
 * exported before keeps its first date. Logged by the database as "Invoice 6012 exported to Sage".
 */
export const markSageExported = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).max(5000) }).parse(d))
  .handler(async ({ data, context }): Promise<{ stamped: number }> => {
    await office(context);
    if (!data.ids.length) return { stamped: 0 };
    const { data: rows, error } = await context.supabase
      .from("invoices")
      .update({ sage_exported_at: new Date().toISOString() })
      .in("id", data.ids)
      .is("sage_exported_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    return { stamped: (rows ?? []).length };
  });

/**
 * The Service rates tab of Setup (was Admin › Service Rates): ticket money, so an admin's or a manager's
 * (owner, Oct 1; RLS service_rates_read / service_rates_write). Not Estimate Pricing.
 */
async function ratesManager(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!managesTickets(data)) throw new Error("Service rates are a manager's");
  return data;
}

export const getServiceRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      rates: ServiceRateRow[];
      settings: ServiceSettingsRow;
      /**
       * Admins and managers: who may be the authorizer (M9). [] until its migration. The email
       * lets the picker say whether the default authorizer is a user yet (default-authorizer.ts).
       */
      managers: { id: string; name: string; email: string }[];
    }> => {
      await ratesManager(context);
      const [{ data: rates, error }, { data: settings }, mgrs] = await Promise.all([
        context.supabase
          .from("service_rates")
          .select("*")
          .order("rate_kind")
          .order("role")
          .order("time_kind"),
        context.supabase.from("service_settings").select("*").eq("id", 1).maybeSingle(),
        context.supabase.rpc("manager_options"),
      ]);
      if (error) throw new Error(error.message);
      if (!settings) throw new Error("Service settings row is missing");
      const managers = (mgrs.error ? [] : (mgrs.data ?? [])).map((m) => ({
        id: m.id,
        name: (m.full_name ?? "").trim() || m.email,
        email: m.email,
      }));
      return { rates: rates ?? [], settings, managers };
    },
  );

const ratesSchema = z.object({
  rates: z
    .array(
      z.object({
        id: z.number().int(),
        bill_rate: z.number().finite().min(0),
        cost_rate: z.number().finite().min(0),
      }),
    )
    .max(50),
  settings: z
    .object({
      material_markup: z.number().min(0).max(10),
      tax_rate: z.number().min(0).max(1),
      payment_terms: z.string().trim().max(500),
      invoice_contact: z.string().trim().max(500).nullable(),
      email_subject: z.string().trim().min(1).max(200),
      email_message: z.string().trim().max(2000),
      /** Who reviews Done tickets (M9); null = every admin. */
      authorizer_id: z.string().uuid().nullable(),
    })
    .partial(),
});
export const AUTHORIZER_NOT_MANAGER = "Pick an admin or a manager to authorize tickets";

/**
 * "These rates are confirmed" (Setup › Service rates; owner, Nov 4): the CenterPoint note on the
 * page stays until an admin or a manager presses it, which stamps who and when
 * (20261104220000_rates_confirmed.sql). Nothing else changes.
 */
export const confirmServiceRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rates_confirmed_at: string; by: string }> => {
    await ratesManager(context);
    const { data: p } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const by = p ? nameOf(p) : "";
    const at = new Date().toISOString();
    const { error } = await context.supabase
      .from("service_settings")
      .update({ rates_confirmed_at: at, rates_confirmed_by_name: by, updated_at: at })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { rates_confirmed_at: at, by };
  });
export type ServiceRatesInput = z.input<typeof ratesSchema>;
export const setServiceRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ratesSchema.parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await ratesManager(context);
    // Only an admin or a manager may set Authorized (ticket-stage.ts), so only they authorize.
    if (data.settings.authorizer_id) {
      const { data: mgrs, error: mErr } = await context.supabase.rpc("manager_options");
      if (mErr) throw new Error(mErr.message);
      if (!(mgrs ?? []).some((m) => m.id === data.settings.authorizer_id))
        throw new Error(AUTHORIZER_NOT_MANAGER);
    }
    for (const r of data.rates) {
      const { error } = await context.supabase
        .from("service_rates")
        .update({
          bill_rate: r.bill_rate,
          cost_rate: r.cost_rate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      if (error) throw new Error(error.message);
    }
    if (Object.keys(data.settings).length) {
      const patch: Database["public"]["Tables"]["service_settings"]["Update"] = {
        updated_at: new Date().toISOString(),
      };
      for (const [k, v] of Object.entries(data.settings))
        if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
      const { error } = await context.supabase.from("service_settings").update(patch).eq("id", 1);
      if (error) throw new Error(error.message);
    }
  });
