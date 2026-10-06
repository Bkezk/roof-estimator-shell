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
  type RGB,
} from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { labelColOf, rowKeys } from "@/lib/catalog-row-key";
import { invoiceLabel } from "@/lib/invoice-numbering";
import {
  materialLineFor,
  pieceFromCatalog,
  rateText,
  unitText,
  type CatalogData,
} from "@/lib/invoice-materials";
import {
  chosenPhotoIds,
  invoicePhotoCaption,
  invoicePhotoRoleLabel,
  planInvoicePhotos,
  storedPhotoIds,
} from "@/lib/invoice-photos";
import {
  arrowGeom,
  ellipseGeom,
  parsePhotoMarks,
  photoColorRgb,
  photoTagNumbers,
  rectGeom,
  strokeFor,
  tagGeom,
  textSizeFor,
  type PhotoMark,
} from "@/lib/photo-annotations";
import { pieceFromCountedNotes, type PieceDef } from "@/lib/stock-units";
import { timeLines, type RateTable } from "@/lib/invoice-labor";
import { easternYmd } from "@/lib/field-day";
import {
  SERVICE_STOCK_SCREEN,
  materialForCell,
  materialsByCell,
  packCostFor,
  servicePiece,
} from "@/lib/service-materials";
import { loadServiceMaterials } from "@/lib/service-materials.server";
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

/**
 * The pieces one pack of a stock cell holds, from the catalog: the row's "Fasteners/Box" /
 * "Parts/Bag" / "Parts/Package", or the adhesive's unit type ("4-Cartridge Case"). Null when
 * the catalog does not say.
 */
export async function cellPiece(
  sb: Client,
  cell: { screen_id: string; row_label: string; price_col: string },
): Promise<PieceDef | null> {
  const { data: screen } = await sb
    .from("pricing_catalog")
    .select("data")
    .eq("id", cell.screen_id)
    .maybeSingle();
  return screen ? pieceFromCatalog(screen.data as CatalogData, cell) : null;
}

/**
 * Build the lines a ticket's time entries and materials produce today. `markup` is the invoice's
 * own material markup (owner, Oct 6: per invoice); without it, Setup › Material pricing's.
 */
export async function buildLinesFromJob(
  sb: Client,
  jobId: string,
  opts: { markup?: number | null } = {},
): Promise<LineInsert[]> {
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
      .select(
        "id, screen_id, row_label, price_col, item_no, qty, unit, reason, counted_note, created_at",
      )
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
      notes: { qty: number; counted_note: string | null }[];
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
      notes: [],
    };
    cur.qty += -Number(m.qty);
    if (m.counted_note) cur.notes.push({ qty: Number(m.qty), counted_note: m.counted_note });
    if (m.created_at > cur.last) cur.last = m.created_at;
    byCell.set(key, cur);
  }
  const markup = opts.markup ?? Number(settings.material_markup);
  // Service materials are priced from Setup › Material pricing, not Estimate Pricing (owner,
  // Oct 6: "they price differently"). A cell no service material covers (stock from the bid
  // catalog only) keeps the catalog's cost.
  const byMaterial = materialsByCell(await loadServiceMaterials(sb));
  for (const c of byCell.values()) {
    if (!(c.qty > 0)) continue;
    const material = materialForCell(byMaterial, c);
    const own = c.screen_id === SERVICE_STOCK_SCREEN;
    const [catalogCost, catalogPiece] = await Promise.all([
      material ? null : cellCost(sb, c),
      own ? null : cellPiece(sb, c),
    ]);
    // Counted in pieces when the catalog says how many a pack holds (else what the tech's
    // counted_note "50 fasteners" beside -0.05 box says); otherwise in packs as before.
    // A material counted in its own unit against the catalog's stock (an ISO board = 32 sq ft)
    // bills in that unit.
    const piece = servicePiece(material) ?? catalogPiece ?? pieceFromCountedNotes(c.notes);
    // The service price is per piece / unit as CenterPoint lists it; the ledger is in packs.
    const cost = material ? packCostFor(material.cost, piece) : (catalogCost ?? 0);
    const named = material ? { ...c, row_label: material.name, price_col: "" } : c;
    lines.push({
      sort: sort++,
      kind: "material",
      ...materialLineFor(named, c.qty, cost, markup, piece),
      // The day the material was last taken, in the office's time zone (not UTC's day).
      on_date: easternYmd(new Date(c.last)),
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

/**
 * Page 1 + one Work Completed page per printed repair (with its chosen photos) + a closing
 * Photos page when other photos were chosen (invoice-photos.ts); photos carry their marks.
 * Returns the PDF bytes.
 */
export async function renderInvoicePdf(sb: Client, b: InvoiceBundle): Promise<Uint8Array> {
  const doc = await Doc.create();
  const { invoice, job, company, settings } = b;
  const billTo = (invoice.bill_to ?? {}) as BillTo;
  const property = (invoice.property ?? {}) as Property;
  const M = doc.M;
  const right = doc.W - M;

  // The logo (owner, Oct 1: "the logo we have on the site instead of just text") at the top
  // left of every page, the company name and address beside it.
  const { jbkLogoPng, JBK_LOGO_PNG_WIDTH, JBK_LOGO_PNG_HEIGHT } =
    await import("@/lib/jbk-logo.server");
  const logo = await embed(doc, jbkLogoPng(), "jbk-logo.png");
  const LOGO_H = 44;
  const LOGO_W = Math.round((LOGO_H * JBK_LOGO_PNG_WIDTH) / JBK_LOGO_PNG_HEIGHT);
  const header = (title: string) => {
    const top = doc.H - M;
    let textX = M;
    if (logo) {
      doc.page.drawImage(logo, { x: M, y: top - LOGO_H + 12, width: LOGO_W, height: LOGO_H });
      textX = M + LOGO_W + 10;
    }
    doc.y = top;
    doc.text(company?.company_name ?? "JBK Commercial Roofing", textX, 14, true);
    doc.y -= 14;
    for (const l of [
      company?.address,
      [company?.city, company?.state, company?.zip].filter(Boolean).join(" "),
      company?.phone,
    ]) {
      if (l) {
        doc.text(l, textX, 9);
        doc.y -= 11;
      }
    }
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
    doc.text(`${Number(l.qty)} ${unitText(Number(l.qty), l.unit)}`, cols.qty, 9);
    doc.text(rateText(Number(l.rate)), cols.rate, 9);
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

  // Work Completed pages. The photos are the invoice's chosen ones (invoices.photo_ids, or the
  // default: each printed repair's first Before and After), with their marks.
  const photoPlan = planInvoicePhotos(
    chosenPhotoIds(storedPhotoIds(invoice), b.repairs, b.photos),
    b.repairs,
    b.photos,
  );
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
    // Photos on the right: the chosen ones of this repair (Before over After), 200 px wide,
    // each with its marks drawn over it.
    let py = textTop;
    for (const p of photoPlan.byRepair.get(rep.id) ?? []) {
      const bytes = await download(sb, p.storage_path);
      const img = bytes ? await embed(doc, bytes, p.file_name) : null;
      doc.page.drawText(`${invoicePhotoRoleLabel(p.role)}:`, {
        x: M + 300,
        y: py,
        size: 9,
        font: doc.bold,
      });
      py -= 12;
      if (img) {
        const w = 200;
        const h = Math.min(160, (img.height / img.width) * w);
        const dw = Math.min(w, (img.width / img.height) * h);
        py -= h;
        doc.page.drawImage(img, { x: M + 300, y: py, width: dw, height: h });
        drawPhotoMarks(doc, parsePhotoMarks(p.annotations), { x: M + 300, y: py, w: dw, h });
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

  // The closing "Photos" page(s): chosen photos of no printed repair (and a repair's overflow),
  // two to a row, each captioned and with its marks.
  if (photoPlan.extra.length) {
    const GAP = 20;
    const cellW = (doc.W - 2 * M - GAP) / 2;
    const CELL_H = 165;
    const ROW_H = 12 + CELL_H + 18;
    const photosPage = () => {
      doc.newPage();
      header("Photos");
      doc.y -= 4;
    };
    photosPage();
    for (let i = 0; i < photoPlan.extra.length; i += 2) {
      if (doc.y - ROW_H < M) photosPage();
      const rowTop = doc.y;
      for (const [k, p] of photoPlan.extra.slice(i, i + 2).entries()) {
        const x = M + k * (cellW + GAP);
        doc.y = rowTop;
        doc.text(
          doc.wrap(invoicePhotoCaption(p, b.repairs), cellW, 9, doc.bold)[0] ?? "",
          x,
          9,
          true,
        );
        const bytes = await download(sb, p.storage_path);
        const img = bytes ? await embed(doc, bytes, p.file_name) : null;
        if (!img) {
          doc.page.drawText("(photo not embeddable)", {
            x,
            y: rowTop - 24,
            size: 8,
            font: doc.font,
          });
          continue;
        }
        const scale = Math.min(cellW / img.width, CELL_H / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const y = rowTop - 12 - h;
        doc.page.drawImage(img, { x, y, width: w, height: h });
        drawPhotoMarks(doc, parsePhotoMarks(p.annotations), { x, y, w, h });
      }
      doc.y = rowTop - ROW_H;
    }
  }
  return doc.pdf.save();
}

/**
 * Draw a photo's marks over it on the PDF: the photo's box is (x, y) its bottom-left corner,
 * w × h points. Marks are 0..1 from the picture's top-left (photo-annotations.ts); the line
 * width and the lettering scale with the box as on screen. Circles are ellipses, arrows a line
 * with a filled triangle head, boxes rectangles, text and tags words on a dark band so they read
 * on any roof. Returns how many marks were drawn.
 */
export function drawPhotoMarks(
  doc: { page: PDFPage; bold: PDFFont },
  marks: PhotoMark[],
  box: { x: number; y: number; w: number; h: number },
): number {
  if (!marks.length || !(box.w > 0) || !(box.h > 0)) return 0;
  const { page, bold } = doc;
  const sw = strokeFor(box.w, box.h);
  // Image px (top-left origin, the box's own size) → PDF points.
  const X = (x: number) => box.x + x;
  const Y = (y: number) => box.y + box.h - y;
  const halo = rgb(0, 0, 0);
  const tags = photoTagNumbers(marks);
  const words = (text: string, x: number, yMid: number, size: number, color: RGB) => {
    const t = clean(text);
    const w = bold.widthOfTextAtSize(t, size);
    page.drawRectangle({
      x: X(x) - 1.5,
      y: Y(yMid) - size * 0.6,
      width: w + 3,
      height: size * 1.2,
      color: halo,
      opacity: 0.55,
    });
    page.drawText(t, { x: X(x), y: Y(yMid) - size * 0.35, size, font: bold, color });
  };
  for (const m of marks) {
    const color = rgb(...photoColorRgb(m.color));
    if (m.kind === "ellipse") {
      const g = ellipseGeom(m, box.w, box.h);
      page.drawEllipse({
        x: X(g.cx),
        y: Y(g.cy),
        xScale: Math.max(g.rx, 0.5),
        yScale: Math.max(g.ry, 0.5),
        borderColor: color,
        borderWidth: sw,
      });
    } else if (m.kind === "rect") {
      const g = rectGeom(m, box.w, box.h);
      page.drawRectangle({
        x: X(g.x),
        y: Y(g.y + g.h),
        width: g.w,
        height: g.h,
        borderColor: color,
        borderWidth: sw,
      });
    } else if (m.kind === "arrow") {
      const g = arrowGeom(m, box.w, box.h, sw);
      page.drawLine({
        start: { x: X(g.tail[0]), y: Y(g.tail[1]) },
        end: { x: X(g.base[0]), y: Y(g.base[1]) },
        thickness: sw,
        color,
      });
      // drawSvgPath flips y about its origin: a point (px, py) lands at (px, -py).
      const head = [g.tip, g.left, g.right]
        .map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(2)} ${(-Y(y)).toFixed(2)}`)
        .join(" ");
      page.drawSvgPath(`${head} Z`, { x: 0, y: 0, color });
    } else if (m.kind === "text") {
      const [x, y] = [m.at[0] * box.w, m.at[1] * box.h];
      words(m.text, x, y, textSizeFor(box.w, box.h), color);
    } else {
      const g = tagGeom(m, box.w, box.h);
      page.drawCircle({
        x: X(g.x),
        y: Y(g.y),
        size: g.r,
        color,
        borderColor: halo,
        borderWidth: 0.5,
      });
      const n = String(tags.get(m.id) ?? "");
      const ns = g.r * 1.1;
      page.drawText(n, {
        x: X(g.x) - bold.widthOfTextAtSize(n, ns) / 2,
        y: Y(g.y) - ns * 0.35,
        size: ns,
        font: bold,
        color: m.color === "red" ? rgb(1, 1, 1) : halo,
      });
      words(m.label, g.label.x, g.y, g.labelSize, rgb(1, 1, 1));
    }
  }
  return marks.length;
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
