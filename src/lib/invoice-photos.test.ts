/**
 * Photos on the invoice (owner, Oct 1: "the pictures should be able to be added to the
 * invoice"): which photos print (invoice-photos.ts), the migration
 * 20261001120000_photo_annotations_invoice_photos.sql, the server functions
 * (invoice-photos.functions.ts), the editor's Photos fold, and the PDF — rendered for real with
 * pdf-lib — with the chosen photos and their marks.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  REPAIR_PAGE_PHOTOS,
  chosenPhotoIds,
  defaultInvoicePhotoIds,
  invoicePhotoCaption,
  invoicePhotosSummary,
  planInvoicePhotos,
  storedPhotoIds,
} from "@/lib/invoice-photos";
import { setInvoicePhotosInput } from "@/lib/invoice-photos.functions";
import {
  drawPhoto,
  drawPhotoMarks,
  renderInvoicePdf,
  type InvoiceBundle,
} from "@/lib/invoices.server";
import { jbkLogoPng } from "@/lib/jbk-logo.server";
import { serializePhotoMarks, type PhotoMark } from "@/lib/photo-annotations";

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

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R1 = id(901); // printed
const R2 = id(902); // not printed
const repairs = [
  { id: R1, name: "Pipe boot", print_on_invoice: true },
  { id: R2, name: "Seam repair", print_on_invoice: false },
];
const at = (min: number) => `2026-10-01T10:${String(min).padStart(2, "0")}:00Z`;
const photo = (
  n: number,
  role: string,
  repair: string | null,
  min: number,
  annotations: unknown = null,
) => ({
  id: id(n),
  role,
  repair_id: repair,
  created_at: at(min),
  storage_path: `job/${n}.png`,
  file_name: `${n}.png`,
  annotations,
  service_job_id: id(1),
  by_user: null,
  file_size: 1,
  lat: null,
  lng: null,
  taken_at: null,
});
const marks: PhotoMark[] = [
  { kind: "ellipse", id: "c1", color: "red", a: [0.2, 0.2], b: [0.5, 0.6] },
  { kind: "arrow", id: "a1", color: "yellow", a: [0.9, 0.9], b: [0.55, 0.55] },
  { kind: "rect", id: "r1", color: "white", a: [0.6, 0.1], b: [0.9, 0.3] },
  { kind: "text", id: "t1", color: "red", at: [0.1, 0.85], text: "LEAK HERE" },
  { kind: "tag", id: "g1", color: "yellow", at: [0.7, 0.6], label: "Open seam", note: "" },
];
const b1 = photo(11, "before", R1, 1);
const b2 = photo(12, "before", R1, 2);
const a1 = photo(13, "after", R1, 3);
const s1 = photo(14, "before", R2, 4);
const o1 = photo(15, "other", null, 5, serializePhotoMarks(marks));
const sig = photo(16, "signature", null, 6);
const photos = [b1, b2, a1, s1, o1, sig];

// ---------------------------------------------------------------------------------------------

describe("which photos print", () => {
  it("the default is what printed before: each printed repair's first Before and first After", () => {
    expect(defaultInvoicePhotoIds(repairs, photos)).toEqual([b1.id, a1.id]);
    expect(defaultInvoicePhotoIds([{ ...repairs[0]!, print_on_invoice: false }], photos)).toEqual(
      [],
    );
  });
  it("an invoice's stored choice wins (deleted photos and signatures dropped); null = default", () => {
    expect(chosenPhotoIds(null, repairs, photos)).toEqual([b1.id, a1.id]);
    expect(chosenPhotoIds([], repairs, photos)).toEqual([]);
    expect(chosenPhotoIds([o1.id, o1.id, id(999), sig.id], repairs, photos)).toEqual([o1.id]);
    expect(storedPhotoIds({ photo_ids: [o1.id, "nope", 3] })).toEqual([o1.id]);
    expect(storedPhotoIds({ photo_ids: null })).toBeNull();
    expect(storedPhotoIds({})).toBeNull();
    expect(storedPhotoIds(null)).toBeNull();
  });
  it("a printed repair's photos go on its page (two at most); the rest on the Photos page", () => {
    expect(REPAIR_PAGE_PHOTOS).toBe(2);
    const plan = planInvoicePhotos([a1.id, b2.id, b1.id, s1.id, o1.id, sig.id], repairs, photos);
    expect(plan.byRepair.get(R1)!.map((p) => p.id)).toEqual([b1.id, b2.id]); // before, then after
    expect(plan.byRepair.has(R2)).toBe(false);
    expect(plan.extra.map((p) => p.id)).toEqual([a1.id, s1.id, o1.id]); // oldest first
    const def = planInvoicePhotos(chosenPhotoIds(null, repairs, photos), repairs, photos);
    expect(def.byRepair.get(R1)!.map((p) => p.id)).toEqual([b1.id, a1.id]);
    expect(def.extra).toEqual([]);
  });
  it("captions and the fold's summary", () => {
    expect(invoicePhotoCaption(s1, repairs)).toBe("Before - Seam repair");
    expect(invoicePhotoCaption(o1, repairs)).toBe("Photo");
    expect(invoicePhotosSummary(0)).toBe("no photos print");
    expect(invoicePhotosSummary(1)).toBe("1 photo prints");
    expect(invoicePhotosSummary(4)).toBe("4 photos print");
  });
});

describe("the migration 20261001120000_photo_annotations_invoice_photos.sql", () => {
  const path = "supabase/migrations/20261001120000_photo_annotations_invoice_photos.sql";
  const sql = flatSql(path);
  it("is idempotent: the photo's marks column and the invoice's chosen photos", () => {
    expect(sql).toContain(
      "alter table public.service_job_photos add column if not exists annotations jsonb;",
    );
    expect(sql).toContain("alter table public.invoices add column if not exists photo_ids uuid[];");
    expect(sql).toContain(
      "alter table public.service_job_photos drop constraint if exists service_job_photos_annotations_shape;",
    );
    expect(sql).toMatch(
      /add constraint service_job_photos_annotations_shape check \( annotations is null or \(jsonb_typeof\(annotations\) = 'object'/,
    );
    expect(sql).toContain(
      "alter table public.invoices drop constraint if exists invoices_photo_ids_size;",
    );
    expect(sql).toContain("notify pgrst, 'reload schema';");
    // Nothing destructive, no new policy: the photo and invoice policies already cover it.
    expect(sql).not.toMatch(/drop table|drop column|truncate|delete from|create policy/i);
  });
});

describe("the server functions: who, what, drafts only", () => {
  const src = read("src/lib/invoice-photos.functions.ts");
  it("validates the choice: uuids, at most 200, or null for the default", () => {
    const inv = id(500);
    expect(setInvoicePhotosInput.parse({ id: inv, photo_ids: [b1.id] }).photo_ids).toEqual([b1.id]);
    expect(setInvoicePhotosInput.parse({ id: inv, photo_ids: null }).photo_ids).toBeNull();
    expect(setInvoicePhotosInput.safeParse({ id: inv, photo_ids: ["x"] }).success).toBe(false);
    expect(setInvoicePhotosInput.safeParse({ id: inv }).success).toBe(false);
    expect(
      setInvoicePhotosInput.safeParse({
        id: inv,
        photo_ids: Array.from({ length: 201 }, (_, i) => id(i)),
      }).success,
    ).toBe(false);
  });
  it("whoever sees invoices; a draft only; every id must be a photo of the invoice's ticket", () => {
    const gate = src.slice(
      src.indexOf("async function invoiceViewer"),
      src.indexOf("const invoiceHead"),
    );
    expect(gate).toMatch(/if \(!seesInvoices\(data\)\) throw new Error/);
    const get = serverFn(src, "getInvoicePhotos");
    expect(get).toMatch(/await invoiceViewer\(context\)/);
    const set = serverFn(src, "setInvoicePhotos");
    expect(set).toMatch(/await invoiceViewer\(context\)/);
    expect(set).toMatch(/if \(inv\.status !== "draft"\) throw new Error/);
    expect(set).toMatch(/\.eq\("service_job_id", inv\.service_job_id\)\s*\.in\("id", ids\)/);
    expect(set).toMatch(/if \(ids\.some\(\(id\) => !ok\.has\(id\)\)\)/);
    expect(set).toMatch(
      /\.update\(\{ photo_ids: ids \}\)\s*\.eq\("id", inv\.id\)\s*\.eq\("status", "draft"\)/,
    );
  });
});

describe("the invoice editor's Photos fold", () => {
  const fold = read("src/components/service/invoice-photos.tsx");
  const editor = read("src/components/service/invoice-editor.tsx");
  it("lists the ticket's photos (with their marks) with a tick each, and a way back to the default", () => {
    expect(fold).toMatch(/useServerFn\(getInvoicePhotos\)/);
    expect(fold).toMatch(/useServerFn\(setInvoicePhotos\)/);
    expect(fold).toMatch(
      /<Checkbox[\s\S]*?checked=\{on\}[\s\S]*?onCheckedChange=\{\(v\) => toggle\(p\.id, v === true\)\}/,
    );
    expect(fold).toMatch(/<PhotoThumb photo=\{p\}/);
    expect(fold).toMatch(/save\.mutate\(null\)/);
    expect(fold).toMatch(/Use the default/);
    expect(fold).toMatch(
      /onError: \(e\) => toast\.error\(`Could not save the invoice's photos: \$\{errText\(e\)\}`\)/,
    );
  });
  it("mounted on the invoice page, editable on a draft only", () => {
    expect(editor).toMatch(
      /<InvoicePhotos invoiceId=\{inv\.id\} ticketNumber=\{job\.number\} editable=\{status === "draft"\} \/>/,
    );
  });
});

// ---------------------------------------------------------------------------------------------

/** The content streams of a PDF, inflated (pdf-lib writes them deflated). */
async function pdfStreams(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.get(PDFName.of("Filter"));
    try {
      out.push(
        (filter === PDFName.of("FlateDecode")
          ? inflateSync(Buffer.from(obj.contents))
          : Buffer.from(obj.contents)
        ).toString("latin1"),
      );
    } catch {
      /* an image */
    }
  }
  return out.join("\n");
}
const textOf = (ops: string) =>
  [...ops.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)]
    .map((m) => Buffer.from(m[1]!, "hex").toString("latin1"))
    .join("\n");
/** Bézier curves: pdf-lib draws an ellipse as four `c` operators; nothing else here curves. */
const curves = (ops: string) => (ops.match(/(?:-?[\d.]+ ){6}c\n/g) ?? []).length;

function bundle(photo_ids: string[] | null | undefined, list = photos): InvoiceBundle {
  return {
    invoice: {
      id: "inv",
      number: 6012,
      display_number: null,
      invoice_date: "2026-10-01",
      po_number: null,
      job_code: null,
      bill_to: { name: "Acme Schools" },
      property: { name: "Pineville High" },
      subtotal: 100,
      tax_rate: 0,
      tax_amount: 0,
      total: 100,
      cost_total: 40,
      payment_terms: "Due on receipt",
      description: null,
      ...(photo_ids === undefined ? {} : { photo_ids }),
    },
    lines: [{ description: "Labor", qty: 1, unit: "HR", rate: 100, total: 100, on_date: null }],
    job: { signature_path: null, checked_in_with: null, checked_out_with: null },
    repairs: repairs.map((r) => ({
      ...r,
      completed_on: "2026-10-01",
      quantity: 1,
      unit: "EA",
      problem_text: "Leaking boot",
      resolution_text: "Replaced it",
    })),
    photos: list,
    company: { company_name: "JBK Roofing" },
    settings: { payment_terms: "Due on receipt", invoice_contact: null },
  } as unknown as InvoiceBundle;
}
// Every stored photo downloads as a real PNG (the logo), so pdf-lib embeds it.
const sb = {
  storage: {
    from: () => ({
      download: async () => ({ data: new Blob([new Uint8Array(jbkLogoPng())]), error: null }),
    }),
  },
} as never;

describe("the invoice PDF draws the chosen photos with their marks", () => {
  it("untouched (no photo_ids): page 1 + the printed repair's page, its Before and After; no Photos page", async () => {
    const bytes = await renderInvoicePdf(sb, bundle(undefined));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    const text = textOf(await pdfStreams(bytes));
    expect(text).toContain("Work Completed");
    expect(text).toContain("Before:");
    expect(text).toContain("After:");
    expect(text).not.toContain("LEAK HERE");
    expect(curves(await pdfStreams(bytes))).toBe(0);
  });
  it("chosen photos of no printed repair go on a closing Photos page, marks drawn over them", async () => {
    const bytes = await renderInvoicePdf(sb, bundle([b1.id, a1.id, s1.id, o1.id]));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const ops = await pdfStreams(bytes);
    const text = textOf(ops);
    expect(text).toContain("Photos");
    expect(text).toContain("Before - Seam repair");
    // The marks: the ellipse (curves), the text and the tag's label and number.
    expect(curves(ops)).toBeGreaterThanOrEqual(4);
    expect(text).toContain("LEAK HERE");
    expect(text).toContain("Open seam");
    // The customer's PDF never shows cost or anything internal.
    expect(text).not.toMatch(/cost|margin|internal|\$40/i);
  });
  it("the same photo unmarked draws no marks; more than a page of photos runs onto another", async () => {
    const plain = { ...o1, annotations: null };
    const unmarked = await pdfStreams(await renderInvoicePdf(sb, bundle([o1.id], [b1, a1, plain])));
    expect(curves(unmarked)).toBe(0);
    expect(textOf(unmarked)).not.toContain("LEAK HERE");
    // Page 1, Work Completed (no photos chosen for it), then two photos a row, three rows a page.
    const pages = async (n: number) => {
      const many = Array.from({ length: n }, (_, i) => photo(100 + i, "other", null, 10 + i));
      const bytes = await renderInvoicePdf(
        sb,
        bundle(
          many.map((p) => p.id),
          many,
        ),
      );
      return (await PDFDocument.load(bytes)).getPageCount();
    };
    expect(await pages(6)).toBe(3);
    expect(await pages(7)).toBe(4);
  });
  it("drawPhotoMarks: every mark into the photo's box with pdf-lib shapes", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const box = { x: 48, y: 400, w: 240, h: 180 };
    expect(drawPhotoMarks({ page, bold }, marks, box)).toBe(5);
    expect(drawPhotoMarks({ page, bold }, [], box)).toBe(0);
    const ops = await pdfStreams(await doc.save());
    expect(curves(ops)).toBeGreaterThanOrEqual(4 + 4); // the ellipse and the tag's pin
    // The box: 0.6..0.9 × 0.1..0.3 of 240 × 180 = 72 × 36 points, stroked.
    expect(ops).toMatch(/0 0 m\n0 36 l\n72 36 l\n72 0 l\nh\n/);
    // The arrow's shaft (a line) and its filled triangle head.
    expect(ops).toMatch(/ l\nS\n/);
    expect(ops).toMatch(/m\n[-\d.]+ [-\d.]+ l\n[-\d.]+ [-\d.]+ l\nh\nf\n/);
    expect(textOf(ops)).toContain("LEAK HERE");
  });
});

// ---------------------------------------------------------------------------------------------

/** pdf-lib's `cm` for a turn: cos sin -sin cos 0 0 (cos of a right angle prints as ~6e-17). */
const TURN = {
  "-90": /\S+ -1 1 \S+ 0 0 cm/,
  "90": /\S+ 1 -1 \S+ 0 0 cm/,
  "180": /-1 \S+ \S+ -1 0 0 cm/,
};
/** The image draws: `[width, height]` of each `W 0 0 H 0 0 cm` right before a `Do`. */
const imageDraws = (ops: string) =>
  [...ops.matchAll(/([\d.]+) 0 0 ([\d.]+) 0 0 cm\n1 0 0 1 0 0 cm\n\/Image\S* Do/g)].map((m) => [
    parseFloat(m[1]!),
    parseFloat(m[2]!),
  ]);

describe("a photo turned on the ticket prints turned (owner, Oct 28: rotation)", () => {
  it("drawPhoto: the picture turns about the box's corner with its own sides; its marks go under the same shift and turn, drawn unturned", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const img = await doc.embedPng(jbkLogoPng()); // 480 × 270
    expect([img.width, img.height]).toEqual([480, 270]);
    const box = { x: 48, y: 400, w: 180, h: 240 }; // the turned box: the picture on its side
    expect(drawPhoto({ page, bold }, img, marks, box, 90)).toBe(5);
    const ops = await pdfStreams(await doc.save());
    // The picture: shifted to the box's top-left (48, 640), a quarter turn clockwise (-90 as
    // pdf-lib counts on its y-up page), then its own 240 wide × 180 tall.
    expect(ops).toMatch(
      /q\n1 0 0 1 48 640 cm\n\S+ -1 1 \S+ 0 0 cm\n240 0 0 180 0 0 cm\n1 0 0 1 0 0 cm\n\/Image\S* Do\nQ/,
    );
    // The marks: q, the same shift and turn, then drawPhotoMarks in the picture's own 240 × 180
    // box — the Box mark 0.6..0.9 × 0.1..0.3 is 72 × 36 at (144, 126), not turned by hand.
    expect(ops).toMatch(/q\n1 0 0 1 48 640 cm\n\S+ -1 1 \S+ 0 0 cm\nq\n/);
    expect(ops).toMatch(
      /1 0 0 1 144 126 cm\n(?:1 0 0 1 0 0 cm\n)*0 0 m\n0 36 l\n72 36 l\n72 0 l\nh\n/,
    );
    expect(curves(ops)).toBeGreaterThanOrEqual(4 + 4);
    expect(textOf(ops)).toContain("LEAK HERE");
    // Every q has its Q (the turn does not leak into what is drawn next).
    expect((ops.match(/^q$/gm) ?? []).length).toBe((ops.match(/^Q$/gm) ?? []).length);
  });
  it("drawPhoto, not turned, draws exactly as before; 180 and 270 take their own corner and turn", async () => {
    const at = async (rotation: 0 | 180 | 270, m: PhotoMark[] = []) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const img = await doc.embedPng(jbkLogoPng());
      const box =
        rotation === 270 ? { x: 48, y: 400, w: 180, h: 240 } : { x: 48, y: 400, w: 240, h: 180 };
      drawPhoto({ page, bold }, img, m, box, rotation);
      return pdfStreams(await doc.save());
    };
    const flat = await at(0, marks);
    expect(flat).toMatch(/1 0 0 1 48 400 cm\n1 0 0 1 0 0 cm\n240 0 0 180 0 0 cm/);
    expect(flat).not.toMatch(TURN["-90"]);
    expect(flat).not.toMatch(TURN["90"]);
    expect(flat).not.toMatch(TURN["180"]);
    // Unturned marks: straight on the page (the Box at the box's own place), as drawPhotoMarks did.
    expect(flat).toMatch(
      /1 0 0 1 192 526 cm\n(?:1 0 0 1 0 0 cm\n)*0 0 m\n0 36 l\n72 36 l\n72 0 l\nh\n/,
    );
    const half = await at(180);
    expect(half).toMatch(/1 0 0 1 288 580 cm\n-1 \S+ \S+ -1 0 0 cm\n240 0 0 180 0 0 cm/);
    const left = await at(270);
    expect(left).toMatch(/1 0 0 1 228 400 cm\n\S+ 1 -1 \S+ 0 0 cm\n240 0 0 180 0 0 cm/);
  });
  // Each render embeds the logo PNG for every photo and inflates every stream: well over 5 s each.
  const SLOW = 30_000;
  it(
    "the invoice PDF: a turned photo fills a swapped box on the closing Photos page, its marks under the turn",
    async () => {
      // The cell is 248 × 165; the 480 × 270 picture on its side is 270 × 480, so it scales to
      // 165 tall × 92.8125 wide — and is drawn as its own 165 × 92.8125 turned a quarter.
      const turned = photo(17, "other", null, 7, serializePhotoMarks(marks, 90));
      const ops = await pdfStreams(
        await renderInvoicePdf(sb, bundle([turned.id], [b1, a1, turned])),
      );
      expect(ops).toMatch(TURN["-90"]);
      expect(imageDraws(ops)).toContainEqual([165, 92.8125]);
      expect(curves(ops)).toBeGreaterThanOrEqual(4); // the ellipse, under the same turn
      expect(textOf(ops)).toContain("LEAK HERE");
    },
    SLOW,
  );
  it(
    "the invoice PDF: a turned Before photo on the Work Completed page takes a swapped box, with no marks at all",
    async () => {
      // 200 wide, 160 tall at most: on its side the picture is 160 tall × 90 wide, drawn as its
      // own 160 × 90 turned — a turn without marks still prints turned.
      const before = photo(18, "before", R1, 8, serializePhotoMarks([], 90));
      const ops = await pdfStreams(await renderInvoicePdf(sb, bundle([before.id], [before, a1])));
      expect(ops).toMatch(TURN["-90"]);
      expect(imageDraws(ops)).toContainEqual([160, 90]);
      expect(curves(ops)).toBe(0);
    },
    SLOW,
  );
  it(
    "the invoice PDF: untouched photos draw as before, no turn anywhere",
    async () => {
      const plain = await pdfStreams(await renderInvoicePdf(sb, bundle([b1.id, o1.id])));
      expect(plain).not.toMatch(TURN["-90"]);
      expect(plain).not.toMatch(TURN["90"]);
      expect(plain).not.toMatch(TURN["180"]);
      expect(imageDraws(plain)).toContainEqual([200, 112.5]); // 480 × 270 at 200 wide on the repair page
    },
    SLOW,
  );
});
