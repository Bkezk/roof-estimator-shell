/**
 * Purchase orders on service tickets (owner, Oct 1: replacing CenterPoint, whose close-out page
 * has "PO Information": Date, PO #, Title, Price, Notes, Upload Receipt, Approved?, Submit /
 * Back). The pure rules (purchase-orders.ts), the invoice's internal cost (invoice-totals.ts),
 * the migration 20261001100000_ticket_purchase_orders.sql, the generated types, the server
 * functions (service-pos.functions.ts), the section (purchase-orders-section.tsx) and where it
 * is mounted (the ticket page, the close-out), the invoice's Internal fold, and the customer's
 * PDF (no purchase orders, no cost, no margin).
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { AUDIT_ENTITIES } from "@/lib/audit";
import { computeTotals, storedTotals } from "@/lib/invoice-totals";
import {
  approvedPoTotal,
  canAddPo,
  canApprovePo,
  canEditPo,
  isReceiptPathFor,
  parsePrice,
  poFormProblem,
  poMoney,
  poSummary,
  poTotal,
  receiptContentType,
  receiptFileProblem,
  receiptObjectName,
  RECEIPT_MAX_BYTES,
} from "@/lib/purchase-orders";
import { renderInvoicePdf, type InvoiceBundle } from "@/lib/invoices.server";

const read = (p: string) => readFileSync(p, "utf8");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const JOB = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const SOMEONE = "33333333-3333-4333-8333-333333333333";

const admin = { role: "admin", access: [] };
const manager = { role: "manager", access: [], technician: true };
const office = { role: "user", access: ["service"] };
const tech = { role: "user", access: ["service"], technician: true };
const customersOnly = { role: "user", access: ["customers"] };
const salesPm = { role: "user", access: ["estimate", "customers"] };
const nobody = { lead: false, crew: false };

// ---------------------------------------------------------------------------------------------

describe("receiptObjectName: the photos' naming, with a po- prefix", () => {
  it("<job id>/po-<time>-<random>.<ext>", () => {
    expect(receiptObjectName(JOB, "Lowes Receipt.JPG", 1759300000000, () => 0.123456789)).toBe(
      `${JOB}/po-1759300000000-${(0.123456789).toString(36).slice(2, 8)}.jpg`,
    );
  });
  it("a PDF keeps .pdf; odd characters go; no extension = jpg", () => {
    expect(receiptObjectName(JOB, "receipt.P D F", 1, () => 0.5)).toMatch(/\.pdf$/);
    expect(receiptObjectName(JOB, "scan.pdf", 1, () => 0.5)).toMatch(
      new RegExp(`^${JOB}/po-1-[a-z0-9]+\\.pdf$`),
    );
    expect(receiptObjectName(JOB, "IMG_0001", 1, () => 0.5)).toMatch(/\.jpg$/);
    expect(receiptObjectName(JOB, "../../x.png")).toMatch(new RegExp(`^${JOB}/po-\\d+-`));
  });
  it("two receipts picked at once get different names", () => {
    expect(receiptObjectName(JOB, "a.jpg")).not.toBe(receiptObjectName(JOB, "a.jpg"));
  });
  it("only a receipt under the ticket's own folder is accepted", () => {
    expect(isReceiptPathFor(JOB, receiptObjectName(JOB, "a.jpg"))).toBe(true);
    expect(isReceiptPathFor(JOB, `${JOB}/1759-abc.jpg`)).toBe(false); // a photo, not a receipt
    expect(isReceiptPathFor(JOB, `${SOMEONE}/po-1-abc.jpg`)).toBe(false);
    expect(isReceiptPathFor(JOB, `${JOB}/po-1/../../invoices/x.pdf`)).toBe(false);
    expect(isReceiptPathFor(JOB, `invoices/${JOB}/po-1.pdf`)).toBe(false);
  });
});

describe("receipt files: a photo or a PDF, up to the bucket's 25 MB", () => {
  it("accepts the bucket's types (HEIC with a blank type by its extension)", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"])
      expect(receiptFileProblem({ name: "r", type, size: 1000 })).toBeNull();
    expect(receiptContentType({ name: "IMG_1.HEIC", type: "" })).toBe("image/heic");
    expect(receiptFileProblem({ name: "IMG_1.HEIC", type: "", size: 1000 })).toBeNull();
  });
  it("refuses anything else, an empty file and one over 25 MB", () => {
    expect(receiptFileProblem({ name: "r.docx", type: "application/msword", size: 10 })).toMatch(
      /photo .* or a PDF/,
    );
    expect(receiptFileProblem({ name: "r.pdf", type: "application/pdf", size: 0 })).toMatch(
      /empty/,
    );
    expect(
      receiptFileProblem({ name: "r.pdf", type: "application/pdf", size: RECEIPT_MAX_BYTES + 1 }),
    ).toMatch(/25 MB/);
  });
});

describe("totals and the summary", () => {
  const rows = [
    { price: 312.5, approved: true },
    { price: "99.50", approved: false },
    { price: 0.01, approved: true },
  ];
  it("poTotal sums every PO; approvedPoTotal only the approved ones", () => {
    expect(poTotal(rows)).toBe(412.01);
    expect(approvedPoTotal(rows)).toBe(312.51);
    expect(approvedPoTotal(rows.map((r) => ({ ...r, approved: false })))).toBe(0);
    expect(poTotal([])).toBe(0);
  });
  it("adds to the cent (no float drift)", () => {
    expect(
      poTotal([
        { price: 0.1, approved: true },
        { price: 0.2, approved: true },
      ]),
    ).toBe(0.3);
  });
  it("the header: count · total · awaiting approval", () => {
    expect(
      poSummary([
        { price: 312.5, approved: true },
        { price: 99.5, approved: false },
      ]),
    ).toBe("2 · $412.00 · 1 awaiting approval");
    expect(poSummary([{ price: 1234.5, approved: true }])).toBe("1 · $1,234.50");
    expect(poSummary([])).toBe("None");
    expect(poMoney(5)).toBe("$5.00");
  });
});

describe("the form: Date, PO # and Price required; Price starts blank", () => {
  const ok = { po_date: "2026-10-01", po_number: "Jbk24-0255", title: "", price: "412", notes: "" };
  it("parsePrice: blank is null (not 0), money text is read, junk is NaN", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("  ")).toBeNull();
    expect(parsePrice("$1,234.5")).toBe(1234.5);
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice(".5")).toBe(0.5);
    expect(parsePrice("12.345")).toBe(12.35);
    expect(parsePrice("-3")).toBeNaN();
    expect(parsePrice("abc")).toBeNaN();
    expect(parsePrice(".")).toBeNaN();
  });
  it("poFormProblem names the first thing missing", () => {
    expect(poFormProblem(ok)).toBeNull();
    expect(poFormProblem({ ...ok, po_date: "" })).toBe("Pick the date");
    expect(poFormProblem({ ...ok, po_number: "   " })).toBe("Enter the PO #");
    expect(poFormProblem({ ...ok, po_number: "x".repeat(61) })).toMatch(/at most 60/);
    expect(poFormProblem({ ...ok, price: "" })).toBe("Enter the price");
    expect(poFormProblem({ ...ok, price: "twelve" })).toMatch(/dollar amount/);
  });
});

describe("who: add, edit / delete, approve (twins of the RLS and the guard trigger)", () => {
  it("adding: the office, the ticket's lead or crew; not a technician off the job", () => {
    expect(canAddPo(admin, nobody)).toBe(true);
    expect(canAddPo(manager, nobody)).toBe(true);
    expect(canAddPo(office, nobody)).toBe(true);
    expect(canAddPo(tech, nobody)).toBe(false);
    expect(canAddPo(tech, { lead: true, crew: false })).toBe(true);
    expect(canAddPo(tech, { lead: false, crew: true })).toBe(true);
    expect(canAddPo(customersOnly, nobody)).toBe(false);
    expect(canAddPo(salesPm, nobody)).toBe(false);
    expect(canAddPo(null, { lead: true, crew: true })).toBe(false);
  });
  it("editing / deleting: managers any PO; others their own, not approved", () => {
    const mine = { created_by: ME, approved: false };
    const theirs = { created_by: SOMEONE, approved: false };
    const approvedMine = { created_by: ME, approved: true };
    expect(canEditPo(manager, ME, theirs, nobody)).toBe(true);
    expect(canEditPo(admin, ME, approvedMine, nobody)).toBe(true);
    expect(canEditPo(tech, ME, mine, { lead: false, crew: true })).toBe(true);
    expect(canEditPo(tech, ME, theirs, { lead: true, crew: false })).toBe(false);
    expect(canEditPo(tech, ME, approvedMine, { lead: true, crew: false })).toBe(false);
    expect(canEditPo(tech, ME, mine, nobody)).toBe(false); // taken off the job
    expect(canEditPo(office, ME, mine, nobody)).toBe(true);
    expect(canEditPo(office, null, mine, nobody)).toBe(false);
  });
  it("approving: admins and managers only", () => {
    expect(canApprovePo(admin)).toBe(true);
    expect(canApprovePo(manager)).toBe(true);
    for (const p of [office, tech, customersOnly, salesPm, null])
      expect(canApprovePo(p)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the invoice's Internal fold: approved POs are cost, never the customer's total", () => {
  const lines = [
    { kind: "labor", qty: 3, rate: 95, cost_rate: 40, taxable: false },
    { kind: "material", qty: 2, rate: 50, cost_rate: 30, taxable: true },
    { kind: "other", qty: null, rate: null, cost_rate: 0, taxable: false },
  ];
  it("cost and margin move by exactly the PO total; subtotal, tax and total do not", () => {
    const before = computeTotals(lines, 0.06);
    const after = computeTotals(lines, 0.06, 312.51);
    expect(before.po_cost).toBe(0);
    expect(after.po_cost).toBe(312.51);
    expect(after.subtotal).toBe(before.subtotal);
    expect(after.tax).toBe(before.tax);
    expect(after.total).toBe(before.total);
    expect(after.cost_total).toBe(Math.round((before.cost_total + 312.51) * 100) / 100);
    expect(after.margin).toBe(Math.round((before.margin - 312.51) * 100) / 100);
    expect(after.hours).toBe(3);
    expect(after.perHour).toBeCloseTo(after.margin / 3, 10);
    // The numbers: 385 + 6 tax = 391; cost 180 (+ 312.51 POs).
    expect(before).toMatchObject({
      subtotal: 385,
      tax: 6,
      total: 391,
      cost_total: 180,
      margin: 211,
    });
    expect(after).toMatchObject({ cost_total: 492.51, margin: -101.51 });
  });
  it("only the approved ones: approvedPoTotal feeds it", () => {
    const pos = [
      { price: 300, approved: true },
      { price: 999, approved: false },
    ];
    expect(computeTotals(lines, 0, approvedPoTotal(pos)).cost_total).toBe(480);
  });
  it("a final invoice: its stored figures plus the POs' cost", () => {
    const live = computeTotals(lines, 0.06, 100);
    const t = storedTotals(
      { subtotal: "385", tax_amount: "6", total: "391", cost_total: "180" },
      live,
    );
    expect(t).toMatchObject({ subtotal: 385, tax: 6, total: 391, po_cost: 100, cost_total: 280 });
    expect(t.margin).toBe(111);
    expect(t.perHour).toBeCloseTo(37, 10);
  });

  const ed = read("src/components/service/invoice-editor.tsx");
  const totals = ed.slice(ed.indexOf("function Totals("), ed.indexOf("// ---- Final / sent"));
  it("the editor uses the pure helper with the ticket's approved PO total", () => {
    expect(ed).not.toMatch(/\nfunction computeTotals\(/);
    expect(ed).toContain(
      'import { computeTotals, storedTotals, type InvoiceTotals } from "@/lib/invoice-totals";',
    );
    expect(ed).toContain("return { cost: approvedPoTotal(q.data?.pos ?? []), error: q.error };");
    expect(ed).toContain("enabled: !!session && managesTickets(profile),");
    expect(ed).toContain("computeTotals(lines, fromPct(head.tax_pct), po.cost)");
    expect(ed).toContain("const stored = storedTotals(inv, t);");
    expect(ed).toMatch(/Number\(inv\.tax_rate\),\s*po\.cost,\s*\)/);
  });
  it('"Purchase orders (approved)" is its own line inside the closed Internal fold', () => {
    const line = totals.indexOf("<dt>Purchase orders (approved)</dt>");
    expect(line).toBeGreaterThan(totals.indexOf("{internal && ("));
    expect(line).toBeGreaterThan(totals.indexOf("{open && ("));
    expect(line).toBeLessThan(totals.indexOf("<dt>Cost</dt>"));
    expect(totals).toContain("money(t.po_cost)");
    // Above the fold (what a sales / PM sees, and what matches the customer's copy): no PO.
    expect(totals.slice(totals.indexOf("return ("), totals.indexOf("{internal && ("))).not.toMatch(
      /purchase|po_cost/i,
    );
  });
});

/** The text a PDF draws (pdf-lib writes standard-font text as hex strings in flate streams). */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.get(PDFName.of("Filter"));
    let raw: Buffer;
    try {
      raw =
        filter === PDFName.of("FlateDecode")
          ? inflateSync(Buffer.from(obj.contents))
          : Buffer.from(obj.contents);
    } catch {
      continue;
    }
    const ops = raw.toString("latin1");
    for (const m of ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g))
      out.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    for (const m of ops.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(m[1]!);
  }
  return out.join("\n");
}

describe("the customer's invoice PDF: no purchase orders, no cost, no margin", () => {
  const server = read("src/lib/invoices.server.ts");
  it("the bundle and the renderer never read purchase orders", () => {
    const bundle = server.slice(
      server.indexOf("export interface InvoiceBundle"),
      server.indexOf("export async function renderInvoicePdf"),
    );
    const pdf = server.slice(
      server.indexOf("export async function renderInvoicePdf"),
      server.indexOf("export function sageCsv"),
    );
    for (const part of [bundle, pdf]) {
      expect(part.length).toBeGreaterThan(500);
      expect(part).not.toMatch(/purchase_order|purchase order|approvedPoTotal|po_cost/i);
    }
    expect(pdf).not.toMatch(/cost_rate|cost_total|margin/i);
    expect(read("src/lib/invoices.functions.ts")).not.toMatch(/purchase_order|po_cost/i);
  });
  it("rendered: the lines and the Grand Total print; no PO, cost or margin text", async () => {
    const b = {
      invoice: {
        id: "inv",
        number: 6012,
        display_number: null,
        invoice_date: "2026-10-01",
        po_number: "CUST-77",
        job_code: "J-1",
        bill_to: { name: "Acme Schools", address1: "1 Main St", city: "Pineville", state: "KY" },
        property: { name: "Pineville High", address: "2 School Rd" },
        subtotal: 385,
        tax_rate: 0.06,
        tax_amount: 6,
        total: 391,
        cost_total: 180,
        payment_terms: "Payment is due upon receipt of invoice.",
        description: "Roof leak over the gym",
      },
      lines: [
        { description: "Labor", qty: 3, unit: "HR", rate: 95, total: 285, on_date: null },
        { description: "Pipe boot", qty: 2, unit: "EA", rate: 50, total: 100, on_date: null },
      ],
      job: { signature_path: null, checked_in_with: null, checked_out_with: null },
      repairs: [],
      photos: [],
      company: { company_name: "JBK Roofing" },
      settings: { payment_terms: "Due on receipt", invoice_contact: null },
    } as unknown as InvoiceBundle;
    const text = await pdfText(await renderInvoicePdf({} as never, b));
    expect(text).toContain("Grand Total");
    expect(text).toContain("Pipe boot");
    expect(text).toContain("$391.00");
    expect(text).toContain("CUST-77"); // the customer's own PO # (not ours) stays
    expect(text).not.toMatch(/purchase order|approved|cost|margin|internal/i);
  });
});

// ---------------------------------------------------------------------------------------------

describe("migration 20261001100000_ticket_purchase_orders.sql", () => {
  const flat = flatSql("supabase/migrations/20261001100000_ticket_purchase_orders.sql");
  it("the table, exactly the agreed columns", () => {
    expect(flat).toContain(
      "create table if not exists public.service_job_purchase_orders ( id uuid primary key default gen_random_uuid(), service_job_id uuid not null references public.service_jobs(id) on delete cascade, po_date date not null default current_date, po_number text not null check (length(btrim(po_number)) between 1 and 60), title text, price numeric(12,2) not null check (price >= 0), notes text, receipt_path text, receipt_name text, receipt_size bigint, approved boolean not null default false, approved_by uuid references public.profiles(id) on delete set null, approved_at timestamptz, created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now() );",
    );
    expect(flat).toContain(
      "create index if not exists service_job_purchase_orders_job_idx on public.service_job_purchase_orders (service_job_id);",
    );
    expect(flat).toContain(
      "create trigger service_job_purchase_orders_updated_at before update on public.service_job_purchase_orders for each row execute function public.update_updated_at_column();",
    );
  });
  const works =
    "(not public.is_technician() or public.is_admin() or public.is_manager() or public.leads_job(service_job_id) or public.is_on_crew(service_job_id))";
  const own =
    "public.has_access('service') and (public.is_admin() or public.is_manager() or (created_by = auth.uid() and (not public.is_technician() or public.leads_job(service_job_id) or public.is_on_crew(service_job_id))))";
  it("RLS: read = whoever reads the ticket; add = Service and working it; change = own or a manager", () => {
    expect(flat).toContain(
      "alter table public.service_job_purchase_orders enable row level security;",
    );
    expect(flat).toContain(
      `create policy service_job_purchase_orders_read on public.service_job_purchase_orders for select to authenticated using ( public.has_access('customers') or (public.has_access('service') and ${works}) );`,
    );
    expect(flat).toContain(
      `create policy service_job_purchase_orders_insert on public.service_job_purchase_orders for insert to authenticated with check ( public.has_access('service') and ${works} );`,
    );
    expect(flat).toContain(
      `create policy service_job_purchase_orders_update on public.service_job_purchase_orders for update to authenticated using ( ${own} ) with check ( ${own} );`,
    );
    expect(flat).toContain(
      `create policy service_job_purchase_orders_delete on public.service_job_purchase_orders for delete to authenticated using ( ${own} );`,
    );
    expect(flat).not.toMatch(/on public\.service_job_purchase_orders for all/);
    // Idempotent: every policy dropped first.
    for (const [, name] of flat.matchAll(/create policy (\w+) on/g))
      expect(flat).toContain(
        `drop policy if exists ${name} on public.service_job_purchase_orders;`,
      );
  });
  it("approval guard: managers only; stamps who / when; an approved PO is locked", () => {
    expect(flat).toContain(
      "create or replace function public.service_job_purchase_orders_guard() returns trigger language plpgsql security definer set search_path = public as $$",
    );
    expect(flat).toContain(
      "v_boss boolean := auth.uid() is null or coalesce(auth.role(), '') = 'service_role' or public.is_admin() or public.is_manager();",
    );
    expect(flat).toContain(
      "if new.approved and not v_boss then raise exception 'Only a manager approves a PO' using errcode = '42501';",
    );
    expect(flat).toContain(
      "if new.approved is distinct from old.approved and not v_boss then raise exception 'Only a manager approves a PO' using errcode = '42501';",
    );
    expect(flat).toContain(
      "if old.approved and not v_boss then raise exception 'An approved PO is locked; ask a manager' using errcode = '42501';",
    );
    expect(flat).toContain(
      "if new.approved and not old.approved then new.approved_by := coalesce(v_uid, new.approved_by); new.approved_at := now(); elsif old.approved and not new.approved then new.approved_by := null; new.approved_at := null; else new.approved_by := old.approved_by; new.approved_at := old.approved_at; end if;",
    );
    expect(flat).toContain("new.created_by := old.created_by;");
    expect(flat).toContain("raise exception 'A PO stays on its ticket'");
    expect(flat).toContain(
      "create trigger service_job_purchase_orders_guard before insert or update or delete on public.service_job_purchase_orders for each row execute function public.service_job_purchase_orders_guard();",
    );
    expect(flat).toContain(
      "revoke all on function public.service_job_purchase_orders_guard() from public;",
    );
  });
  it("audit: the entity check and audit_row's purchase_order branch and trigger", () => {
    expect(flat).toContain(
      "alter table public.audit_log add constraint audit_log_entity_check check (entity in ('invoice', 'invoice_line', 'account', 'site', 'contact', 'purchase_order'));",
    );
    expect(flat).toContain(
      "when 'service_job_purchase_orders' then v_entity := 'purchase_order'; v_entity_id := (v_row ->> 'id')::uuid; v_parent := 'service_job_id'; v_label := 'PO ''' || coalesce(v_old ->> 'po_number', v_new ->> 'po_number', '') || '''';",
    );
    expect(flat).toContain(
      "drop trigger if exists service_job_purchase_orders_audit on public.service_job_purchase_orders; create trigger service_job_purchase_orders_audit after insert or update or delete on public.service_job_purchase_orders for each row execute function public.audit_row();",
    );
    // The constraint and AUDIT_ENTITIES agree (less 'vendor', which 20261001110000_vendors.sql
    // added after this migration; vendors.test.ts checks that one against the whole list).
    const listed = /check \(entity in \(([^)]*)\)\)/.exec(flat)![1]!;
    expect(listed.split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual(
      AUDIT_ENTITIES.filter((e) => e !== "vendor"),
    );
  });
  it("audit_row is 20261001080000's, plus only the PO branch and the approval stamps skipped", () => {
    const fn = (sql: string) =>
      sql.slice(
        sql.indexOf("create or replace function public.audit_row()"),
        sql.indexOf("revoke all on function public.audit_row() from public;"),
      );
    const before = fn(flatSql("supabase/migrations/20261001080000_audit_triggers_stage_rule.sql"));
    const after = fn(flat);
    const branch =
      "when 'service_job_purchase_orders' then v_entity := 'purchase_order'; v_entity_id := (v_row ->> 'id')::uuid; v_parent := 'service_job_id'; v_label := 'PO ''' || coalesce(v_old ->> 'po_number', v_new ->> 'po_number', '') || ''''; ";
    expect(before.length).toBeGreaterThan(3000);
    expect(
      after.replace(branch, "").replace(", 'sort', 'approved_by', 'approved_at'];", ", 'sort'];"),
    ).toBe(before);
    expect(flat).toContain("revoke all on function public.audit_row() from public;");
  });
});

describe("generated types: service_job_purchase_orders", () => {
  const types = read("src/integrations/supabase/types.ts");
  const block = types.slice(
    types.indexOf("      service_job_purchase_orders: {"),
    types.indexOf("      service_job_repairs: {"),
  );
  it("Row, Insert and Update in the table's shape, between photos and repairs", () => {
    expect(types.indexOf("      service_job_photos: {")).toBeLessThan(
      types.indexOf("      service_job_purchase_orders: {"),
    );
    expect(block).toContain(
      "Row: {\n          approved: boolean;\n          approved_at: string | null;\n          approved_by: string | null;\n          created_at: string;\n          created_by: string | null;\n          id: string;\n          notes: string | null;\n          po_date: string;\n          po_number: string;\n          price: number;\n          receipt_name: string | null;\n          receipt_path: string | null;\n          receipt_size: number | null;\n          service_job_id: string;\n          title: string | null;\n          updated_at: string;\n          vendor_id: string | null;\n        };",
    );
    const insert = block.slice(block.indexOf("Insert: {"), block.indexOf("Update: {"));
    for (const req of ["po_number: string;", "price: number;", "service_job_id: string;"])
      expect(insert).toContain(`          ${req}`);
    expect(insert).toContain("approved?: boolean;");
    expect(insert).toContain("po_date?: string;");
    const update = block.slice(block.indexOf("Update: {"), block.indexOf("Relationships:"));
    expect(update).not.toMatch(/^\s+\w+: /m); // every Update field optional
    expect(block).toContain('foreignKeyName: "service_job_purchase_orders_service_job_id_fkey";');
    expect(block).toContain('foreignKeyName: "service_job_purchase_orders_approved_by_fkey";');
  });
});

// ---------------------------------------------------------------------------------------------

describe("server functions (service-pos.functions.ts)", () => {
  const src = read("src/lib/service-pos.functions.ts");
  it("list, save, approve and delete, each signed in and validated with zod", () => {
    for (const name of [
      "listPurchaseOrders",
      "savePurchaseOrder",
      "setPurchaseOrderApproved",
      "deletePurchaseOrder",
    ]) {
      const fn = serverFn(src, name);
      expect(fn).toContain(".middleware([requireSupabaseAuth])");
      expect(fn).toMatch(/\.validator\(\(d: unknown\) =>/);
    }
    expect(src).toContain("export { receiptObjectName };");
  });
  it("save: the receipt must be the ticket's own; adding / editing follow canAddPo / canEditPo", () => {
    const fn = serverFn(src, "savePurchaseOrder");
    expect(fn).toContain("if (data.receipt_path && !isReceiptPathFor(job.id, data.receipt_path))");
    expect(fn).toContain("if (!canAddPo(p, works))");
    expect(fn).toContain("if (!canEditPo(p, context.userId, prev, works))");
    expect(fn).toContain('"An approved PO is locked; ask a manager"');
    expect(fn).not.toMatch(/approved:/); // save never sets approval
  });
  it("approve: managers only, through its own call", () => {
    const fn = serverFn(src, "setPurchaseOrderApproved");
    expect(fn).toContain('if (!canApprovePo(p)) throw new Error("Only a manager approves a PO");');
    expect(fn).toContain(".update({ approved: data.approved })");
  });
  it("delete: removes the row, then its receipt from the bucket (loudly if that fails)", () => {
    const fn = serverFn(src, "deletePurchaseOrder");
    const del = fn.indexOf('.from("service_job_purchase_orders")\n      .delete()');
    const rm = fn.indexOf(".remove([prev.receipt_path])");
    expect(del).toBeGreaterThan(-1);
    expect(rm).toBeGreaterThan(del);
    expect(fn).toContain("The PO is deleted but its receipt was not");
  });
  it("errors are plain messages (the screens toast them)", () => {
    expect(src).not.toMatch(/console\.(log|error)/);
    expect(src.match(/throw new Error\(/g)!.length).toBeGreaterThan(8);
  });
});

describe("the section (purchase-orders-section.tsx)", () => {
  const src = read("src/components/service/purchase-orders-section.tsx");
  it('a collapsible Box "Purchase orders" with the summary', () => {
    expect(src).toContain('import { Box } from "@/components/service/field-shared";');
    expect(src).toMatch(
      /<Box\s+title="Purchase orders"\s+icon=\{Receipt\}\s+collapsible\s+storageKey="purchase-orders"/,
    );
    expect(src).toContain("summary={q.data ? poSummary(pos) : undefined}");
  });
  it("each row: date, PO #, title, price, approval, receipt link (new tab), Edit, Delete (confirm)", () => {
    const row = src.slice(src.indexOf("function PoRow("), src.indexOf("const draftOf"));
    for (const bit of [
      "shortDay(po.po_date)",
      "PO {po.po_number}",
      "{po.title ?",
      "poMoney(Number(po.price))",
      "<ApprovedBadge approved={po.approved} />",
      "<ReceiptLink path={po.receipt_path} name={po.receipt_name} />",
      "{po.can_edit && (",
      "window.confirm(",
    ])
      expect(row, bit).toContain(bit);
    const link = src.slice(
      src.indexOf("function ReceiptLink("),
      src.indexOf("function usePoMutations"),
    );
    expect(link).toContain("useSignedUrl(path)");
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noreferrer"');
  });
  it("the form, in CenterPoint's order: Date *, PO # *, Title, Price *, Notes, Upload Receipt, Approved?, Submit / Back", () => {
    const form = src.slice(src.indexOf("function PoForm("));
    const order = [
      ">Date *</Label>",
      ">PO # *</Label>",
      ">Title</Label>",
      ">Price *</Label>",
      ">Notes</Label>",
      /"Upload Receipt"/,
      />Approved\?</,
      /\n\s*Submit\n/,
      /\n\s*Back\n/,
    ].map((s) => (typeof s === "string" ? form.indexOf(s) : form.search(s)));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(src).toMatch(/q\.data\.canAdd && \(\s*<Button[\s\S]*?<Plus [^>]*\/> Add PO/); // "+ Add PO"
  });
  it("Date defaults to today; Price starts blank with no placeholder 0; Notes auto-grow", () => {
    expect(src).toContain("po_date: po?.po_date ?? localYmd(),");
    expect(src).toContain('price: po ? String(Number(po.price)) : "",');
    const price = src.slice(src.indexOf("id={`${idp}-price`}"), src.indexOf(">Notes</Label>"));
    expect(price).not.toContain("placeholder");
    expect(price).not.toContain("NumberField");
    expect(src).toMatch(/<AutoTextarea\s+id=\{`\$\{idp\}-notes`\}\s+rows=\{2\}/);
  });
  it("the receipt goes straight to the bucket; a failed save drops the upload", () => {
    expect(src).toContain("uploaded = receiptObjectName(jobId, file.name);");
    expect(src).toContain("await uploadToServiceBucket(uploaded, file, receiptContentType(file));");
    expect(src).toContain("if (uploaded) await removeFromServiceBucket(uploaded);");
    expect(src).toContain('accept="image/*,application/pdf"');
  });
  it("the Approved toggle: managers only, never on the close-out (field); a badge otherwise", () => {
    expect(src).toContain(
      "const approver = !field && managesTickets(profile) && !!q.data?.canApprove;",
    );
    expect(src).toMatch(/\{approver \? \(\s*<label[\s\S]*?<Switch[\s\S]*?\) : \(\s*<ApprovedBadge/);
    expect(src).toMatch(/\{approver && \(\s*<label[\s\S]*?Approved\?/);
  });
  it("errors are loud toasts with the server's message; fields stack on a phone", () => {
    expect(src).toContain('loudError(po ? "Could not save the PO" : "Could not add the PO", e)');
    expect(src).toContain('loudError("Could not delete the PO", e)');
    expect(src).toContain('loudError("Could not change the approval", e)');
    expect(src).toContain('<div className="grid gap-3 sm:grid-cols-2">');
  });
});

describe("mounted on the ticket page and the close-out", () => {
  it("ticket page: right column after the field sections, before the invoice; and for a technician", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toContain(
      'import { PurchaseOrdersSection } from "@/components/service/purchase-orders-section";',
    );
    expect(page).toMatch(
      /<TicketFieldSections job=\{job\} officeOrAdmin=\{officeOrAdmin\} repairs=\{false\} \/>\s*<PurchaseOrdersSection jobId=\{job\.id\} \/>\s*<InvoiceBlock job=\{job\} \/>/,
    );
    expect(page).toMatch(
      /<TicketFieldSections job=\{job\} officeOrAdmin=\{officeOrAdmin\} \/>\s*<PurchaseOrdersSection jobId=\{job\.id\} \/>/,
    );
  });
  it("close-out: right after Materials, in field mode (no Approved toggle)", () => {
    const co = read("src/components/service/closeout.tsx");
    expect(co).toMatch(
      /<MaterialsSection jobId=\{job\.id\} \/>\s*\{\/\*[^*]*\*\/\}\s*<PurchaseOrdersSection jobId=\{job\.id\} field \/>/,
    );
  });
});
