/**
 * Invoices (phase C, docs/service-module-design.md §5.4–§5.5): numbered like the ticket — the
 * first "6012", further invoices on the same ticket "6012.2", "6012.3", a deleted or voided one
 * freeing its number (owner, Sep 30; invoice-numbering.ts) — built from time entries and
 * materials (invoices.server.ts), reviewed and sent by the office, marked paid by hand, exported
 * for Sage as CSV. Admins, managers and sales / project managers see and edit them
 * (`seesInvoices`; RLS: invoices_office) — owner, Oct 1: "Sales and PMs should be able to see
 * customers and invoices. However whatever is changed needs to be logged somewhere showing what
 * they did, when, and who." Every write here is logged (logAudit → audit_log), by everyone.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { canAccess, managesTickets, seesInvoices } from "@/lib/access";
import {
  INVOICE_FIELDS,
  auditActor,
  diffForAudit,
  diffInvoiceLines,
  type AuditActor,
  type AuditEntry,
} from "@/lib/audit";
import { invoiceFileStem, invoiceLabel, nextInvoiceNumber } from "@/lib/invoice-numbering";
import { siteAddressLine } from "@/lib/crm.functions";
import { toBase64 } from "@/lib/webpush";

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
  // able to see customers and invoices"); every change is logged below.
  if (!seesInvoices(data)) throw new Error("Invoices are a manager's or sales'");
  return data;
}
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;
/** "Invoice 6012" for the audit summaries. */
const invName = (inv: Pick<InvoiceRow, "display_number" | "number">) =>
  `Invoice ${invoiceLabel(inv)}`.trim();
/** Write the audit rows (audit.server.ts; never throws). */
async function logAudit(
  sb: SupabaseClient<Database>,
  actor: AuditActor,
  e: AuditEntry | AuditEntry[],
) {
  const audit = await import("@/lib/audit.server");
  await audit.logAudit(sb, actor, e);
}
/** Re-read the ticket after a stage change and run the stage automation (ticket-events). */
async function stageEvent(
  sb: SupabaseClient<Database>,
  jobId: string,
  prevStage: string | null,
  actor: { id: string; name: string | null },
) {
  const { data: row } = await sb.from("service_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!row) return;
  const { afterTicketStage } = await import("@/lib/ticket-events.server");
  await afterTicketStage(row, prevStage, actor, sb);
}

/** Where the final PDF is stored: by number, plus the id so a void keeps its own file. */
const pdfPath = (inv: InvoiceRow) => `invoices/${invoiceFileStem(inv)}-${inv.id.slice(0, 8)}.pdf`;

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
    return createInvoiceFor(sb, data.job_id, auditActor(context.userId, p), true);
  });

/** Another invoice on the same ticket ("6012.2", "6012.3", …), a draft from the ticket. */
export const createAnotherInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    return createInvoiceFor(context.supabase, data.job_id, auditActor(context.userId, p));
  });

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
  actor: AuditActor,
  /** getOrCreate: a draft made meanwhile by another tab is the one to open, not a ".2". */
  onlyIfNone = false,
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
  const [{ data: account }, { data: site }] = await Promise.all([
    job.account_id
      ? sb.from("crm_accounts").select("*").eq("id", job.account_id).maybeSingle()
      : Promise.resolve({ data: null }),
    job.site_id
      ? sb.from("crm_sites").select("*").eq("id", job.site_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const { buildLinesFromJob, loadSettings, totals } = await import("@/lib/invoices.server");
  const [lines, settings] = await Promise.all([buildLinesFromJob(sb, job.id), loadSettings(sb)]);
  const taxRate = account?.tax_exempt ? 0 : Number(settings.tax_rate);
  const t = totals(lines, taxRate);
  const bill_to = {
    name: account?.name ?? job.customer_name,
    address1: account?.address1 ?? "",
    address2: account?.address2 ?? "",
    city: account?.city ?? "",
    state: account?.state ?? "",
    zip: account?.zip ?? "",
    instructions: account?.billing_instructions ?? "",
    external_id: account?.external_id ?? "",
  };
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
        property: property as unknown as Json,
        description: job.closing_notes,
        payment_terms: settings.payment_terms,
        tax_rate: taxRate,
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
  await logAudit(sb, actor, {
    entity: "invoice",
    entity_id: inv.id,
    action: "create",
    label: invName(inv),
    changes: {
      ...diffForAudit(null, inv, ["subtotal", "tax_rate", "tax_amount", "total", "cost_total"]),
      lines: { from: null, to: lines.length },
    },
  });
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

/** Throw away a draft's lines and rebuild them from the ticket (after more time or material). */
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
    const lines = await buildLinesFromJob(sb, inv.service_job_id);
    const { count: oldCount } = await sb
      .from("invoice_lines")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", inv.id);
    await sb.from("invoice_lines").delete().eq("invoice_id", inv.id);
    if (lines.length) {
      const { error: lErr } = await sb
        .from("invoice_lines")
        .insert(lines.map((l) => ({ ...l, invoice_id: inv.id })));
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
    // The lines are thrown away and made again (new ids): logged as one entry on the invoice,
    // the line count and the totals before → after.
    const changes = {
      ...(oldCount !== lines.length ? { lines: { from: oldCount ?? 0, to: lines.length } } : {}),
      ...diffForAudit(inv, updated, INVOICE_FIELDS),
    };
    await logAudit(sb, auditActor(context.userId, p), {
      entity: "invoice",
      entity_id: inv.id,
      action: "update",
      label: `${invName(inv)} lines rebuilt from the ticket:`,
      changes,
      ...(Object.keys(changes).length
        ? {}
        : {
            summary: `${invName(inv)} lines rebuilt from the ticket (no change in lines or totals)`,
          }),
    });
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
  bill_to: z.record(z.string(), z.string()).optional(),
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
    const audit: AuditEntry[] = [];
    if (data.lines) {
      const { data: oldLines, error: oErr } = await sb
        .from("invoice_lines")
        .select("*")
        .eq("invoice_id", inv.id)
        .order("sort");
      if (oErr) throw new Error(oErr.message);
      await sb.from("invoice_lines").delete().eq("invoice_id", inv.id);
      const rows = data.lines.map((l, i) => ({
        invoice_id: inv.id,
        sort: i,
        kind: l.kind,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        rate: l.rate,
        total: Math.round(l.qty * l.rate * 100) / 100,
        cost_rate: l.cost_rate,
        cost_total: Math.round(l.qty * l.cost_rate * 100) / 100,
        on_date: l.on_date ?? null,
        source: l.source ?? null,
        taxable: l.taxable,
      }));
      if (rows.length) {
        const { error: lErr } = await sb.from("invoice_lines").insert(rows);
        if (lErr) throw new Error(lErr.message);
      }
      // Each saved line carries its old id (the editor sends it): added / edited / removed.
      const sent = data.lines;
      const saved = rows.map((r, i) => ({ ...r, id: sent[i]?.id ?? null }));
      for (const c of diffInvoiceLines(oldLines ?? [], saved))
        audit.push({
          entity: "invoice_line",
          entity_id: inv.id,
          action: c.action,
          label: `${invName(inv)} line '${c.description}'`,
          changes: c.changes,
        });
    }
    const { data: lines } = await sb.from("invoice_lines").select("*").eq("invoice_id", inv.id);
    const taxRate = data.tax_rate ?? Number(inv.tax_rate);
    const t = totals(lines ?? [], taxRate);
    const patch: Database["public"]["Tables"]["invoices"]["Update"] = {
      ...t,
      tax_rate: taxRate,
      updated_by_name: nameOf(p),
    };
    if (data.invoice_date) patch.invoice_date = data.invoice_date;
    if (data.due_date !== undefined) patch.due_date = data.due_date;
    if (data.po_number !== undefined) patch.po_number = data.po_number;
    if (data.job_code !== undefined) patch.job_code = data.job_code;
    if (data.description !== undefined) patch.description = data.description;
    if (data.payment_terms !== undefined) patch.payment_terms = data.payment_terms;
    if (data.bill_to) patch.bill_to = data.bill_to as unknown as Json;
    const { data: updated, error: uErr } = await sb
      .from("invoices")
      .update(patch)
      .eq("id", inv.id)
      .select("*")
      .single();
    if (uErr) throw new Error(uErr.message);
    audit.push({
      entity: "invoice",
      entity_id: inv.id,
      action: "update",
      label: invName(inv),
      changes: diffForAudit(inv, updated, INVOICE_FIELDS),
    });
    await logAudit(sb, auditActor(context.userId, p), audit);
    return withLines(sb, updated);
  });

/** The PDF as base64 (for preview / download in the browser). */
export const renderInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ base64: string; file_name: string }> => {
    await office(context);
    const { loadBundle, renderInvoicePdf } = await import("@/lib/invoices.server");
    const b = await loadBundle(context.supabase, data.id);
    const pdf = await renderInvoicePdf(context.supabase, b);
    return {
      base64: toBase64(pdf),
      file_name: `Invoice-${invoiceFileStem(b.invoice)}.pdf`,
    };
  });

/** Freeze the invoice: status final, PDF stored, the ticket Invoiced. */
export const finalizeInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    const sb = context.supabase;
    const { loadBundle, renderInvoicePdf } = await import("@/lib/invoices.server");
    const b = await loadBundle(sb, data.id);
    if (b.invoice.status !== "draft") throw new Error("Already final");
    if (!b.lines.length) throw new Error("The invoice has no lines");
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
        updated_by_name: nameOf(p),
      })
      .eq("id", b.invoice.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logAudit(sb, auditActor(context.userId, p), {
      entity: "invoice",
      entity_id: updated.id,
      action: "finalize",
      label: invName(updated),
      changes: diffForAudit(b.invoice, updated, INVOICE_FIELDS),
    });
    await sb
      .from("service_jobs")
      .update({ stage: "invoiced", invoice_id: updated.id, updated_by_name: nameOf(p) })
      .eq("id", b.invoice.service_job_id);
    await stageEvent(sb, b.invoice.service_job_id, b.job.stage, {
      id: context.userId,
      name: nameOf(p),
    });
    const { syncFollowup } = await import("@/lib/followups.server");
    await syncFollowup(
      {
        kind: "ticket",
        itemId: b.job.id,
        accountId: b.job.account_id,
        assigneeId: b.job.technician_id,
        title: "",
        url: "",
        closing: true,
        closeReason: "stage invoiced",
        dueDate: null,
        actorId: context.userId,
        actorName: nameOf(p),
      },
      sb,
    );
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
    const actor = auditActor(context.userId, p);
    const { loadBundle, renderInvoicePdf, emailInvoice } = await import("@/lib/invoices.server");
    let b = await loadBundle(sb, data.id);
    if (b.invoice.status === "draft") {
      const pdf = await renderInvoicePdf(sb, b);
      const path = pdfPath(b.invoice);
      const { error: upErr } = await sb.storage
        .from("service")
        .upload(path, pdf, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new Error(`Could not store the PDF: ${upErr.message}`);
      const { error: fErr } = await sb
        .from("invoices")
        .update({ status: "final", finalized_at: new Date().toISOString(), pdf_path: path })
        .eq("id", b.invoice.id);
      if (!fErr)
        await logAudit(sb, actor, {
          entity: "invoice",
          entity_id: b.invoice.id,
          action: "finalize",
          label: invName(b.invoice),
          changes: { status: { from: b.invoice.status, to: "final" } },
        });
      await sb
        .from("service_jobs")
        .update({ stage: "invoiced", invoice_id: b.invoice.id })
        .eq("id", b.invoice.service_job_id);
      await stageEvent(sb, b.invoice.service_job_id, b.job.stage, {
        id: context.userId,
        name: nameOf(p),
      });
      b = await loadBundle(sb, data.id);
    }
    if (b.invoice.status === "void") throw new Error("This invoice is void");
    const pdf = await renderInvoicePdf(sb, b);
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
    const { data: updated, error } = await sb
      .from("invoices")
      .update({
        status: b.invoice.status === "paid" ? "paid" : "sent",
        sent_at: new Date().toISOString(),
        sent_to: data.to as unknown as Json,
        updated_by_name: nameOf(p),
      })
      .eq("id", b.invoice.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logAudit(sb, actor, {
      entity: "invoice",
      entity_id: updated.id,
      action: "send",
      label: invName(updated),
      changes: {
        ...diffForAudit(b.invoice, updated, ["status"]),
        sent_to: { from: b.invoice.sent_to ?? null, to: data.to },
      },
    });
    return withLines(sb, updated);
  });

/** Record the payment (Sage stays the ledger) and close the ticket. */
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
  .handler(async ({ data, context }): Promise<InvoiceWithLines> => {
    const p = await office(context);
    const sb = context.supabase;
    const { data: before } = await sb.from("invoices").select("*").eq("id", data.id).maybeSingle();
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
      .neq("status", "void")
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Invoice not found, or void");
    await logAudit(sb, auditActor(context.userId, p), {
      entity: "invoice",
      entity_id: inv.id,
      action: "paid",
      label: invName(inv),
      changes: diffForAudit(before, inv, INVOICE_FIELDS),
    });
    await sb
      .from("service_jobs")
      .update({ stage: "closed", updated_by_name: nameOf(p) })
      .eq("id", inv.service_job_id);
    await stageEvent(sb, inv.service_job_id, null, { id: context.userId, name: nameOf(p) });
    return withLines(sb, inv);
  });

/** Void an invoice (a mistake); the ticket goes back to Done and a new draft can be made. */
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
    if (inv.status === "draft") {
      // A draft is deleted outright; its number is free for the next invoice on the ticket.
      const { error: dErr } = await sb.from("invoices").delete().eq("id", inv.id);
      if (dErr) throw new Error(dErr.message);
      await logAudit(sb, auditActor(context.userId, p), {
        entity: "invoice",
        entity_id: inv.id,
        action: "delete",
        label: `Draft ${invName(inv)}`,
        changes: diffForAudit(inv, null, ["status", "total"]),
      });
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
      await logAudit(sb, auditActor(context.userId, p), {
        entity: "invoice",
        entity_id: inv.id,
        action: "void",
        label: invName(inv),
        changes: { status: { from: inv.status, to: "void" } },
      });
    }
    // Another live invoice on the ticket keeps it where it is; the last one sends it back to Done.
    const [other] = await liveInvoices(sb, inv.service_job_id);
    if (other) {
      await sb
        .from("service_jobs")
        .update({ invoice_id: other.id, updated_by_name: nameOf(p) })
        .eq("id", inv.service_job_id);
      return;
    }
    await sb
      .from("service_jobs")
      .update({ stage: "done", invoice_id: null, updated_by_name: nameOf(p) })
      .eq("id", inv.service_job_id);
    await stageEvent(sb, inv.service_job_id, "invoiced", { id: context.userId, name: nameOf(p) });
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
        status: z.enum(INVOICE_STATUSES).optional(),
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
    if (data.status) q = q.eq("status", data.status);
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
      const p = await office(context);
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
        const { error: xErr } = await sb
          .from("invoices")
          .update({ sage_exported_at: now })
          .in("id", ids);
        if (!xErr)
          await logAudit(
            sb,
            auditActor(context.userId, p),
            (invs ?? []).map((i) => ({
              entity: "invoice" as const,
              entity_id: i.id,
              action: "update" as const,
              summary: `${invName(i)} exported to Sage`,
              changes: { sage_exported_at: { from: i.sage_exported_at, to: now } },
            })),
          );
      }
      return { csv, count: ids.length, file_name: `sage-invoices-${data.from}-to-${data.to}.csv` };
    },
  );

/**
 * The Service Rates page (Admin › Service Rates): ticket money, so an admin's or a manager's
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
    async ({ context }): Promise<{ rates: ServiceRateRow[]; settings: ServiceSettingsRow }> => {
      await ratesManager(context);
      const [{ data: rates, error }, { data: settings }] = await Promise.all([
        context.supabase
          .from("service_rates")
          .select("*")
          .order("rate_kind")
          .order("role")
          .order("time_kind"),
        context.supabase.from("service_settings").select("*").eq("id", 1).maybeSingle(),
      ]);
      if (error) throw new Error(error.message);
      if (!settings) throw new Error("Service settings row is missing");
      return { rates: rates ?? [], settings };
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
    })
    .partial(),
});
export type ServiceRatesInput = z.input<typeof ratesSchema>;
export const setServiceRates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ratesSchema.parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await ratesManager(context);
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
