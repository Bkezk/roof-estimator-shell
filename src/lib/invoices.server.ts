/**
 * Invoice engine — SERVER ONLY (pdf-lib, storage downloads). Load inside handlers with
 * `await import("@/lib/invoices.server")`.
 *
 * Rules copied from CenterPoint (docs/service-module-design.md §4): every time entry becomes
 * one line per person (invoice-labor.ts: the named crew at each member's rate, or on an
 * old-style ticket the technician plus one Helper line per helper_count at the ticket's rate
 * kind) — travel and labor priced separately; every material used becomes a line at catalog
 * cost × (1 + markup); tax is a rate on the taxable subtotal unless the customer is tax exempt;
 * invoice number = ticket number, ".2", ".3" for further invoices (invoice-numbering.ts).
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { labelColOf, rowKeys } from "@/lib/catalog-row-key";
import { invoiceLabel } from "@/lib/invoice-numbering";
import { timeLines, type RateTable } from "@/lib/invoice-labor";
import { toBase64 } from "@/lib/webpush";

type Client = SupabaseClient<Database>;
export type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
export type InvoiceLineRow = Database["public"]["Tables"]["invoice_lines"]["Row"];
export type LineInsert = Omit<
  Database["public"]["Tables"]["invoice_lines"]["Insert"],
  "invoice_id"
>;

const r2 = (n: number) => Math.round(n * 100) / 100;

export type { RateTable } from "@/lib/invoice-labor";
export async function loadRates(sb: Client, rateKind: string): Promise<RateTable> {
  const { data, error } = await sb.from("service_rates").select("*").eq("rate_kind", rateKind);
  if (error) throw new Error(error.message);
  const t: RateTable = {};
  for (const r of data ?? [])
    t[`${r.role}:${r.time_kind}`] = { bill: Number(r.bill_rate), cost: Number(r.cost_rate) };
  if (!Object.keys(t).length)
    throw new Error(
      `No service rates for "${rateKind}" — set them on Admin › Settings › Service rates`,
    );
  return t;
}

export async function loadSettings(sb: Client) {
  const { data, error } = await sb.from("service_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (
    data ?? {
      id: 1,
      material_markup: 0.75,
      tax_rate: 0,
      payment_terms: "Payment is due upon receipt of invoice.",
      invoice_contact: null,
      email_subject: "Invoice #{number}",
      email_message: "Your invoice is ready. Thank you for your business.",
      updated_at: "",
    }
  );
}

/** The catalog cost of a stock cell: the priced column of its row, or the adhesive's price. */
export async function cellCost(
  sb: Client,
  cell: { screen_id: string; row_label: string; price_col: string },
): Promise<number | null> {
  const { data: screen } = await sb
    .from("pricing_catalog")
    .select("data")
    .eq("id", cell.screen_id)
    .maybeSingle();
  if (!screen) return null;
  const d = screen.data as {
    kind?: string;
    columns?: string[];
    rows?: Record<string, unknown>[];
    products?: { name: string; price?: unknown }[];
  };
  if (d.kind === "adhesives") {
    const p = (d.products ?? []).find((x) => x.name === cell.row_label);
    const v = p?.price;
    return typeof v === "number" ? v : v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  }
  const cols = d.columns ?? [];
  const keys = rowKeys(cols, d.rows ?? []);
  const idx = keys.indexOf(cell.row_label);
  if (idx < 0 || cell.price_col === labelColOf(cols)) return null;
  const v = (d.rows ?? [])[idx]?.[cell.price_col];
  return typeof v === "number" ? v : v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

/** Build the lines a ticket's time entries and materials produce today. */
export async function buildLinesFromJob(sb: Client, jobId: string): Promise<LineInsert[]> {
  const { data: job, error } = await sb
    .from("service_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Ticket not found");
  const [
    rates,
    settings,
    { data: times },
    { data: moves },
    { data: techs },
    { data: crew, error: crewErr },
    { data: profileRates, error: rateErr },
  ] = await Promise.all([
    loadRates(sb, job.labor_rate_kind),
    loadSettings(sb),
    sb
      .from("service_time_entries")
      .select("*")
      .eq("service_job_id", jobId)
      .order("on_date")
      .order("id"),
    sb
      .from("inventory_movements")
      .select("id, screen_id, row_label, price_col, item_no, qty, unit, reason, created_at")
      .eq("service_job_id", jobId)
      .in("reason", ["consumed", "released"]),
    sb.rpc("technician_options"),
    sb
      .from("service_job_techs")
      .select("technician_id, sort, bill_rate")
      .eq("service_job_id", jobId)
      .order("sort"),
    sb.rpc("technician_bill_rates"),
  ]);
  if (crewErr) throw new Error(crewErr.message);
  if (rateErr) throw new Error(`Technicians' bill rates: ${rateErr.message}`);
  const techName = new Map<string, string>();
  for (const t of techs ?? []) techName.set(t.id, (t.full_name ?? "").trim() || t.email);
  const profileRate = new Map<string, number>();
  for (const r of profileRates ?? [])
    if (r.default_bill_rate != null) profileRate.set(r.id, Number(r.default_bill_rate));
  const lines: LineInsert[] = timeLines({
    times: times ?? [],
    rates,
    crew: (crew ?? [])
      .filter((c): c is typeof c & { technician_id: string } => !!c.technician_id)
      .map((c) => ({
        technician_id: c.technician_id,
        sort: c.sort,
        bill_rate: c.bill_rate == null ? null : Number(c.bill_rate),
      })),
    techName,
    profileRates: profileRate,
  });
  let sort = lines.length;
  // Materials: net quantity per catalog cell (consumed is negative in the ledger).
  const byCell = new Map<
    string,
    {
      screen_id: string;
      row_label: string;
      price_col: string;
      item_no: string | null;
      unit: string;
      qty: number;
      last: string;
    }
  >();
  for (const m of moves ?? []) {
    const key = `${m.screen_id}\u0000${m.row_label}\u0000${m.price_col}`;
    const cur = byCell.get(key) ?? {
      screen_id: m.screen_id,
      row_label: m.row_label,
      price_col: m.price_col,
      item_no: m.item_no,
      unit: m.unit,
      qty: 0,
      last: m.created_at,
    };
    cur.qty += -Number(m.qty);
    if (m.created_at > cur.last) cur.last = m.created_at;
    byCell.set(key, cur);
  }
  const markup = Number(settings.material_markup);
  for (const c of byCell.values()) {
    if (!(c.qty > 0)) continue;
    const cost = (await cellCost(sb, c)) ?? 0;
    const rate = r2(cost * (1 + markup));
    lines.push({
      sort: sort++,
      kind: "material",
      description: `${c.row_label}${c.price_col && c.price_col !== c.row_label ? ` (${c.price_col})` : ""}${c.item_no ? ` #${c.item_no}` : ""}`,
      qty: r2(c.qty),
      unit: c.unit,
      rate,
      total: r2(c.qty * rate),
      cost_rate: cost,
      cost_total: r2(c.qty * cost),
      on_date: c.last.slice(0, 10),
      source: `cell:${c.screen_id}|${c.row_label}|${c.price_col}`,
      taxable: true,
    });
  }
  return lines;
}

/** Totals from lines and the tax rule. */
export function totals(
  lines: { total?: number | null; cost_total?: number | null; taxable?: boolean | null }[],
  taxRate: number,
) {
  const subtotal = r2(lines.reduce((n, l) => n + Number(l.total ?? 0), 0));
  const taxable = r2(lines.filter((l) => l.taxable).reduce((n, l) => n + Number(l.total ?? 0), 0));
  const tax_amount = r2(taxable * taxRate);
  const cost_total = r2(lines.reduce((n, l) => n + Number(l.cost_total ?? 0), 0));
  return { subtotal, tax_amount, total: r2(subtotal + tax_amount), cost_total };
}

// ---------------------------------------------------------------------------------------------
// PDF

const money = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${m}/${day}/${y}`;
};

class Doc {
  pdf!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  readonly W = 612;
  readonly H = 792;
  readonly M = 48;
  static async create() {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.font = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    d.newPage();
    return d;
  }
  newPage() {
    this.page = this.pdf.addPage([this.W, this.H]);
    this.y = this.H - this.M;
  }
  ensure(h: number) {
    if (this.y - h < this.M) this.newPage();
  }
  text(s: string, x: number, size = 10, bold = false, color = rgb(0.1, 0.1, 0.1)) {
    this.page.drawText(clean(s), { x, y: this.y, size, font: bold ? this.bold : this.font, color });
  }
  textRight(s: string, right: number, size = 10, bold = false) {
    const f = bold ? this.bold : this.font;
    const w = f.widthOfTextAtSize(clean(s), size);
    this.page.drawText(clean(s), { x: right - w, y: this.y, size, font: f });
  }
  wrap(s: string, width: number, size = 10, font = this.font): string[] {
    const out: string[] = [];
    for (const para of clean(s).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = "";
      for (const w of words) {
        const t = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(t, size) <= width) line = t;
        else {
          if (line) out.push(line);
          line = w;
        }
      }
      out.push(line);
    }
    return out;
  }
  paragraph(s: string, x: number, width: number, size = 10, bold = false, gap = 3) {
    for (const l of this.wrap(s, width, size, bold ? this.bold : this.font)) {
      this.ensure(size + gap);
      this.text(l, x, size, bold);
      this.y -= size + gap;
    }
  }
  line() {
    this.page.drawLine({
      start: { x: this.M, y: this.y },
      end: { x: this.W - this.M, y: this.y },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
  }
}
/** pdf-lib's standard fonts cover WinAnsi only; swap the few characters that break. */
const clean = (s: string) =>
  s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\u0020-\u00ff\n\r\t]/g, "?");

async function embed(doc: Doc, bytes: Uint8Array, name: string | null): Promise<PDFImage | null> {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  try {
    if (isPng) return await doc.pdf.embedPng(bytes);
    if (isJpg) return await doc.pdf.embedJpg(bytes);
  } catch {
    /* unreadable image */
  }
  void name;
  return null;
}

async function download(sb: Client, path: string): Promise<Uint8Array | null> {
  const { data, error } = await sb.storage.from("service").download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export interface InvoiceBundle {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  job: Database["public"]["Tables"]["service_jobs"]["Row"];
  repairs: Database["public"]["Tables"]["service_job_repairs"]["Row"][];
  photos: Database["public"]["Tables"]["service_job_photos"]["Row"][];
  company: {
    company_name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
  } | null;
  settings: Awaited<ReturnType<typeof loadSettings>>;
}

export async function loadBundle(sb: Client, invoiceId: string): Promise<InvoiceBundle> {
  const { data: invoice, error } = await sb
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invoice) throw new Error("Invoice not found");
  const [
    { data: lines },
    { data: job },
    { data: repairs },
    { data: photos },
    { data: company },
    settings,
  ] = await Promise.all([
    sb.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("sort"),
    sb.from("service_jobs").select("*").eq("id", invoice.service_job_id).maybeSingle(),
    sb
      .from("service_job_repairs")
      .select("*")
      .eq("service_job_id", invoice.service_job_id)
      .order("sort"),
    sb
      .from("service_job_photos")
      .select("*")
      .eq("service_job_id", invoice.service_job_id)
      .order("created_at"),
    sb
      .from("company_settings")
      .select("company_name, address, city, state, zip, phone")
      .eq("id", 1)
      .maybeSingle(),
    loadSettings(sb),
  ]);
  if (!job) throw new Error("The invoice's ticket is gone");
  return {
    invoice,
    lines: lines ?? [],
    job,
    repairs: repairs ?? [],
    photos: photos ?? [],
    company,
    settings,
  };
}

type BillTo = {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  instructions?: string;
  external_id?: string;
};
type Property = { name?: string; address?: string };

/** Page 1 + one Work Completed page per printed repair. Returns the PDF bytes. */
export async function renderInvoicePdf(sb: Client, b: InvoiceBundle): Promise<Uint8Array> {
  const doc = await Doc.create();
  const { invoice, job, company, settings } = b;
  const billTo = (invoice.bill_to ?? {}) as BillTo;
  const property = (invoice.property ?? {}) as Property;
  const M = doc.M;
  const right = doc.W - M;

  const header = (title: string) => {
    doc.y = doc.H - M;
    doc.text(company?.company_name ?? "Bid-O-Matic", M, 14, true);
    doc.y -= 14;
    for (const l of [
      company?.address,
      [company?.city, company?.state, company?.zip].filter(Boolean).join(" "),
      company?.phone,
    ]) {
      if (l) {
        doc.text(l, M, 9);
        doc.y -= 11;
      }
    }
    const top = doc.H - M;
    doc.y = top;
    doc.textRight(title, right, 20, true);
    doc.y -= 22;
    const rows: [string, string][] = [
      ["Invoice #", invoiceLabel(invoice)],
      ["Customer PO", invoice.po_number ?? ""],
      ["Invoice Date", fmtDate(invoice.invoice_date)],
      ["Job #", invoice.job_code ?? ""],
    ];
    for (const [k, v] of rows) {
      doc.page.drawText(k, { x: right - 200, y: doc.y, size: 9, font: doc.bold });
      doc.textRight(v, right, 9);
      doc.y -= 12;
    }
    doc.y = top - 78;
  };

  header("Service Invoice");
  doc.y -= 10;
  // Send to / property
  const colY = doc.y;
  doc.text("Send To", M, 9, true);
  doc.y -= 12;
  doc.paragraph(
    [
      billTo.name,
      billTo.address1,
      billTo.address2,
      [billTo.city, [billTo.state, billTo.zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", "),
    ]
      .filter(Boolean)
      .join("\n"),
    M,
    240,
    10,
  );
  const leftEnd = doc.y;
  doc.y = colY;
  doc.text("Property", M + 270, 9, true);
  doc.y -= 12;
  doc.paragraph([property.name, property.address].filter(Boolean).join("\n"), M + 270, 240, 10);
  doc.y = Math.min(leftEnd, doc.y) - 8;

  // Lines table
  const cols = { desc: M, qty: 340, rate: 420, total: right };
  doc.line();
  doc.y -= 12;
  doc.text("DESCRIPTION", cols.desc, 8, true);
  doc.text("QTY", cols.qty, 8, true);
  doc.text("RATE", cols.rate, 8, true);
  doc.textRight("AMOUNT", cols.total, 8, true);
  doc.y -= 6;
  doc.line();
  doc.y -= 12;
  for (const l of b.lines) {
    doc.ensure(14);
    const desc = doc.wrap(l.description + (l.on_date ? `  (${fmtDate(l.on_date)})` : ""), 280, 9);
    doc.text(desc[0] ?? "", cols.desc, 9);
    doc.text(`${Number(l.qty)} ${l.unit}`, cols.qty, 9);
    doc.text(money(Number(l.rate)), cols.rate, 9);
    doc.textRight(money(Number(l.total)), cols.total, 9);
    doc.y -= 12;
    for (const extra of desc.slice(1)) {
      doc.ensure(12);
      doc.text(extra, cols.desc, 9);
      doc.y -= 12;
    }
  }
  doc.line();
  doc.y -= 14;
  const tot: [string, string, boolean][] = [
    ["Subtotal", money(Number(invoice.subtotal)), false],
    [
      `Tax (${(Number(invoice.tax_rate) * 100).toFixed(2)}%)`,
      money(Number(invoice.tax_amount)),
      false,
    ],
    ["Grand Total", money(Number(invoice.total)), true],
  ];
  for (const [k, v, bold] of tot) {
    doc.ensure(14);
    doc.page.drawText(k, {
      x: cols.rate,
      y: doc.y,
      size: bold ? 11 : 9,
      font: bold ? doc.bold : doc.font,
    });
    doc.textRight(v, cols.total, bold ? 11 : 9, bold);
    doc.y -= bold ? 16 : 12;
  }
  doc.y -= 6;
  doc.paragraph(invoice.payment_terms ?? settings.payment_terms, M, right - M, 9, true);
  if (settings.invoice_contact) doc.paragraph(settings.invoice_contact, M, right - M, 9);
  if (invoice.description) {
    doc.y -= 6;
    doc.text("Description", M, 9, true);
    doc.y -= 12;
    doc.paragraph(invoice.description, M, right - M, 10);
  }

  // Work Completed pages
  const sig = job.signature_path ? await download(sb, job.signature_path) : null;
  const sigImg = sig ? await embed(doc, sig, "signature") : null;
  for (const rep of b.repairs.filter((x) => x.print_on_invoice)) {
    doc.newPage();
    header("Work Completed");
    doc.y -= 4;
    doc.text(
      `Check In/Out With: ${[job.checked_in_with, job.checked_out_with].filter(Boolean).join(" / ") || "NA"}`,
      M,
      9,
      true,
    );
    doc.y -= 16;
    doc.paragraph(rep.name, M, 260, 14, true);
    doc.text(`Completed ${fmtDate(rep.completed_on)}`, M, 9, true);
    doc.y -= 12;
    doc.text(`${Number(rep.quantity)} ${rep.unit}`, M, 9);
    doc.y -= 14;
    const textTop = doc.y;
    if (rep.problem_text) {
      doc.text("Description:", M, 9, true);
      doc.y -= 12;
      doc.paragraph(rep.problem_text, M, 250, 9);
      doc.y -= 6;
    }
    if (rep.resolution_text) {
      doc.text("Work Completed:", M, 9, true);
      doc.y -= 12;
      doc.paragraph(rep.resolution_text, M, 250, 9);
    }
    const textBottom = doc.y;
    // Photos on the right: Before over After, 200 px wide.
    let py = textTop;
    for (const role of ["before", "after"] as const) {
      const p = b.photos.find((x) => x.repair_id === rep.id && x.role === role);
      if (!p) continue;
      const bytes = await download(sb, p.storage_path);
      const img = bytes ? await embed(doc, bytes, p.file_name) : null;
      doc.page.drawText(role === "before" ? "Before:" : "After:", {
        x: M + 300,
        y: py,
        size: 9,
        font: doc.bold,
      });
      py -= 12;
      if (img) {
        const w = 200;
        const h = Math.min(160, (img.height / img.width) * w);
        const dw = (img.width / img.height) * h;
        py -= h;
        doc.page.drawImage(img, { x: M + 300, y: py, width: Math.min(w, dw), height: h });
        py -= 12;
      } else {
        doc.page.drawText("(photo not embeddable)", { x: M + 300, y: py, size: 8, font: doc.font });
        py -= 14;
      }
    }
    doc.y = Math.min(textBottom, py) - 20;
    if (sigImg) {
      doc.ensure(70);
      doc.text(
        `Signed${job.signed_by ? ` by ${job.signed_by}` : ""}${job.signed_at ? ` on ${fmtDate(job.signed_at)}` : ""}`,
        M,
        9,
        true,
      );
      doc.y -= 60;
      const h = 50;
      const w = Math.min(200, (sigImg.width / sigImg.height) * h);
      doc.page.drawImage(sigImg, { x: M, y: doc.y, width: w, height: h });
    }
  }
  if (!b.repairs.some((x) => x.print_on_invoice) && sigImg) {
    doc.y -= 20;
    doc.ensure(70);
    doc.text(`Signed${job.signed_by ? ` by ${job.signed_by}` : ""}`, M, 9, true);
    doc.y -= 60;
    const h = 50;
    const w = Math.min(200, (sigImg.width / sigImg.height) * h);
    doc.page.drawImage(sigImg, { x: M, y: doc.y, width: w, height: h });
  }
  return doc.pdf.save();
}

/** Email the invoice PDF through Resend (attachments are base64). */
export async function emailInvoice(input: {
  to: string[];
  subject: string;
  text: string;
  pdf: Uint8Array;
  fileName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set (Lovable Cloud › secrets)" };
  const { fromAddress } = await import("@/lib/notify.server");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddress(),
        to: input.to,
        subject: input.subject,
        text: input.text,
        attachments: [{ filename: input.fileName, content: toBase64(input.pdf) }],
      }),
    });
    if (!res.ok)
      return {
        ok: false,
        error: `Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`,
      };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One CSV for the bookkeeper: a header row per invoice and a line row per line. */
export function sageCsv(bundles: { invoice: InvoiceRow; lines: InvoiceLineRow[] }[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[][] = [
    [
      "RecordType",
      "InvoiceNumber",
      "InvoiceDate",
      "DueDate",
      "CustomerId",
      "CustomerName",
      "CustomerPO",
      "JobCode",
      "LineKind",
      "Description",
      "Qty",
      "Unit",
      "Rate",
      "Amount",
      "Taxable",
      "Subtotal",
      "Tax",
      "Total",
      "Status",
      "PaidOn",
      "PaidAmount",
    ],
  ];
  for (const { invoice, lines } of bundles) {
    const bt = (invoice.bill_to ?? {}) as BillTo;
    rows.push([
      "INVOICE",
      invoiceLabel(invoice),
      invoice.invoice_date,
      invoice.due_date ?? "",
      bt.external_id ?? "",
      bt.name ?? "",
      invoice.po_number ?? "",
      invoice.job_code ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      String(invoice.subtotal),
      String(invoice.tax_amount),
      String(invoice.total),
      invoice.status,
      invoice.paid_on ?? "",
      String(invoice.paid_amount),
    ]);
    for (const l of lines) {
      rows.push([
        "LINE",
        invoiceLabel(invoice),
        invoice.invoice_date,
        "",
        bt.external_id ?? "",
        bt.name ?? "",
        invoice.po_number ?? "",
        invoice.job_code ?? "",
        l.kind,
        l.description,
        String(l.qty),
        l.unit,
        String(l.rate),
        String(l.total),
        l.taxable ? "Y" : "N",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
    }
  }
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
