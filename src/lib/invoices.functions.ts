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
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { canAccess, managesTickets, seesInvoices } from "@/lib/access";
import { invoiceFileStem, invoiceLabel, nextInvoiceNumber } from "@/lib/invoice-numbering";
import { siteAddressLine } from "@/lib/crm.functions";
import { accountBillTo, billToFor, vendorBillProblem } from "@/lib/vendors";
import { toBase64 } from "@/lib/webpush";
import { INVOICE_NEEDS_AUTH, INVOICE_STAGES } from "@/lib/ticket-stage";
import {
  lineFlagsChanged,
  mergeRebuild,
  savedLineRow,
  type RebuildLine,
} from "@/lib/invoice-rebuild";
import { stampSent } from "@/lib/invoice-sent";
import { mergeSendTo } from "@/lib/invoice-send-to";
import type { InvoiceBundle } from "@/lib/invoices.server";

export type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
export type InvoiceLineRow = Database["public"]["Tables"]["invoice_lines"]["Row"];
export type ServiceRateRow = Database["public"]["Tables"]["service_rates"]["Row"];
export type ServiceSettingsRow = Database["public"]["Tables"]["service_settings"]["Row"];
export const INVOICE_STATUSES = ["draft", "final", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const RATE_KINDS = ["standard", "urgent", "emergency"] as const;
export const RATE_KIND_LABELS: Record<(typeof RATE_KINDS)[number], string> = {
  standard: "Standard",
  urgent: "Urgent",
  emergency: "Emergency",
};

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
async function office(ctx: Ctx) {
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
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;
/** Who is making the invoice (created_by, updated_by_name). */
type Actor = { id: string; name: string };

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
 * Finalise a draft: the one routine behind Finalize and Send on a draft (audit, Oct 2: Send
 * skipped the no-lines check and left the ticket's follow-up open). Refuses an invoice with no
 * lines, or on a ticket not yet Authorized (finalizeStageProblem), before anything is written;
 * stores the PDF; stamps the invoice final; moves the ticket to Invoiced through the rpc
 * (ticketStageFromInvoice: sales / project managers too); runs the stage automation (the
 * invoice follow-up) and closes the ticket's follow-up.
 */
async function finalizeDraft(
  sb: SupabaseClient<Database>,
  b: InvoiceBundle,
  actor: Actor,
): Promise<InvoiceRow> {
  if (b.invoice.status !== "draft") throw new Error("Already final");
  if (!b.lines.length) throw new Error("The invoice has no lines");
  // The ticket's stage as loaded with the bundle (loadBundle reads it fresh for this call).
  const stageProblem = finalizeStageProblem(b.invoice.service_job_id ? b.job.stage : null);
  if (stageProblem) throw new Error(stageProblem);
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
  // The ticket goes Invoiced, also when a sales / project manager finalises (the rpc).
  await ticketStageFromInvoice(sb, b.invoice.service_job_id, "invoiced", updated.id);
  await stageEvent(sb, b.invoice.service_job_id, b.job.stage, actor);
  await closeTicketFollowup(sb, b.job, actor, "stage invoiced");
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
 * existing file) and a warning logged.
 */
async function invoicePdf(sb: SupabaseClient<Database>, b: InvoiceBundle): Promise<Uint8Array> {
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

/** The ticket's invoice, created as a draft from its time and materials on first call. */
export const getOrCreateInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    const sb = context.supabase;
    const [existing] = await liveInvoices(sb, data.job_id);
    if (existing) return withLines(sb, existing);
    return createInvoiceFor(sb, data.job_id, { id: context.userId, name: nameOf(p) }, true);
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
      { id: context.userId, name: nameOf(p) },
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
    return (rows ?? []).map((r) => ({
      id: r.id,
      label: invoiceLabel(r),
      status: r.status,
      total: Number(r.total),
      created_at: r.created_at,
    }));
  });

/** Postgres unique violation on the live display-number index (two creates at once). */
const numberTaken = (e: { code?: string; message: string }) =>
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
  const [lines, settings] = await Promise.all([buildLinesFromJob(sb, job.id), loadSettings(sb)]);
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
    const { error: lErr } = await sb
      .from("invoice_lines")
      .insert(lines.map((l) => ({ ...l, invoice_id: inv.id })));
    if (lErr) throw new Error(lErr.message);
  }
  await sb.from("service_jobs").update({ invoice_id: inv.id }).eq("id", job.id);
  return withLines(sb, inv);
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
    return withLines(context.supabase, inv);
  });

/**
 * Rebuild a draft's lines from the ticket (after its time or material was corrected). Lines
 * added by hand on the invoice and prices changed by hand are kept (invoice-rebuild.ts).
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
    if (inv.status !== "draft") throw new Error("Only a draft can be rebuilt");
    const { buildLinesFromJob, totals } = await import("@/lib/invoices.server");
    const built = await buildLinesFromJob(sb, inv.service_job_id, {
      markup: inv.material_markup == null ? null : Number(inv.material_markup),
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
      .update({ ...t, updated_by_name: nameOf(p) })
      .eq("id", inv.id)
      .select("*")
      .single();
    if (uErr) throw new Error(uErr.message);
    return withLines(sb, updated);
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
      const fresh: LineWrite[] = [];
      const edits: { id: number; row: LineWrite }[] = [];
      data.lines.forEach((l, i) => {
        const prev = l.id != null ? old.get(l.id) : undefined;
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
    const { data: lines } = await sb.from("invoice_lines").select("*").eq("invoice_id", inv.id);
    const taxRate = data.tax_rate ?? Number(inv.tax_rate);
    const t = totals(lines ?? [], taxRate);
    const patch: Database["public"]["Tables"]["invoices"]["Update"] = {
      ...t,
      tax_rate: taxRate,
      ...(data.material_markup === undefined ? {} : { material_markup: data.material_markup }),
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
      } else {
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

/** Email the (final) invoice PDF to the billing contacts; finalises a draft first. */
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
    // The PDF stored at finalising is the one attached (invoicePdf), not a fresh drawing.
    const pdf = await invoicePdf(sb, b);
    const label = invoiceLabel(b.invoice);
    const subject = b.settings.email_subject.replace("{number}", label);
    const text = `${data.message ?? b.settings.email_message}\n\nInvoice #${label} for ${(b.invoice.property as { name?: string }).name ?? b.job.customer_name}: $${Number(b.invoice.total).toFixed(2)}.\n${b.invoice.payment_terms ?? ""}`;
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
        status: b.invoice.status === "paid" ? "paid" : "sent",
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
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!cur || cur.status === "void") throw new Error("Invoice not found, or void");
    if (cur.status === "draft") throw new Error("Finalize the invoice first");
    const { data: inv, error } = await sb
      .from("invoices")
      .update({
        status: "paid",
        paid_on: data.paid_on,
        paid_amount: data.amount,
        paid_method: data.method ?? null,
        paid_ref: data.ref ?? null,
        updated_by_name: nameOf(p),
      })
      .eq("id", data.id)
      .in("status", ["final", "sent", "paid"])
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found, or void");
    // The ticket keeps its stage (owner, Oct 5: a manager closes it by hand).
    return { ...(await withLines(sb, inv)), ticket_closed: false };
  });

/** Void an invoice (a mistake); the ticket goes back to Authorized and a new draft can be made. */
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
    // The ticket's stage before this, for the stage automation (audit, Oct 2: a hard-coded
    // "invoiced" re-sent "done — invoice ready" when a draft was deleted on a Done ticket).
    const { data: jobBefore, error: jErr } = await sb
      .from("service_jobs")
      .select("stage")
      .eq("id", inv.service_job_id)
      .maybeSingle();
    if (jErr) throw new Error(jErr.message);
    const prevStage = jobBefore?.stage ?? null;
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
    if (backToAuthorized) {
      const { error: sErr } = await sb.rpc("set_ticket_stage_from_invoice", {
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
    // "unpaid" (the Unpaid chip / the Owner view's tile): final or sent, not yet marked paid.
    if (data.status === "unpaid") q = q.in("status", ["final", "sent"]);
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

/** The Sage CSV for a date range (finals and later); stamps sage_exported_at. */
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
    async ({ data, context }): Promise<{ csv: string; count: number; file_name: string }> => {
      await office(context);
      const sb = context.supabase;
      let q = sb
        .from("invoices")
        .select("*")
        .in("status", ["final", "sent", "paid"])
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
      const { sageCsv } = await import("@/lib/invoices.server");
      const csv = sageCsv(
        (invs ?? []).map((invoice) => ({
          invoice,
          lines: (lines ?? []).filter((l) => l.invoice_id === invoice.id),
        })),
      );
      if (ids.length) {
        const now = new Date().toISOString();
        // Logged by the database as "Invoice 6012 exported to Sage".
        const { error: xErr } = await sb
          .from("invoices")
          .update({ sage_exported_at: now })
          .in("id", ids);
        if (xErr) console.error("Could not stamp the Sage export", xErr.message);
      }
      return { csv, count: ids.length, file_name: `sage-invoices-${data.from}-to-${data.to}.csv` };
    },
  );

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
