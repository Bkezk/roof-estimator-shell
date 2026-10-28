/**
 * The document PDF — SERVER ONLY (pdf-lib, storage downloads). Load inside handlers with
 * `await import("@/lib/documents/document-pdf.server")`.
 *
 * Owner, Oct 26: the CenterPoint-style document generator's output. US Letter, 54 pt margins
 * (model.ts PAGE), Helvetica. Every DocPage starts a PDF page; its modules flow top down and
 * continue on a new page when they overflow — the layout (pdf-layout.ts, pure and tested)
 * decides where every piece goes and this file only draws: text lines with their marks, pictures
 * (uploaded into the document, a ticket photo turned as the ticket shows it with its marks drawn
 * exactly as the invoice draws them — invoices.server.ts drawPhoto — or the logo), tables,
 * signature rules, the footer
 * (the company line and "Page X of Y" in grey) on every content page, and whole pages copied in
 * from the PDF library. A picture that cannot be read (webp, heic, a missing file) prints as a
 * grey "picture not printable" box; nothing here throws for a picture.
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
import { jbkLogoPng } from "@/lib/jbk-logo.server";
import { drawPhoto } from "@/lib/invoices.server";
import {
  parsePhotoMarkup,
  rotatedBox,
  type PhotoMark,
  type Rotation,
} from "@/lib/photo-annotations";

import {
  DEFAULT_OPTIONS,
  type DocModule,
  type DocPage,
  type ImageRef,
  optionsSchema,
  PAGE,
  pagesSchema,
} from "./model";
import {
  CELL_PAD,
  CONTENT_HEIGHT,
  CONTENT_WIDTH,
  type FontKey,
  footerLine,
  FOOTER_SIZE,
  type ImageSize,
  type LayoutContext,
  layoutModules,
  type Measure,
  pageLabel,
  paginate,
  photoGridKey,
  type Piece,
  type Placed,
  repairListData,
  repairListKey,
  SIGNATURE_SPACE,
  splitAtPdf,
  contentHeightFor,
} from "./pdf-layout";
import {
  displayVariables,
  DOCUMENTS_BUCKET,
  documentAssetPath,
  pricingSource,
  SERVICE_BUCKET,
  storedInspection,
} from "./server-pure";
import { type InspectionSnapshot, variableLabel } from "./variables";

type Client = SupabaseClient<Database>;
export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
/** What the renderer reads: the jsonb columns as stored or already typed (documents.functions.ts). */
export type RenderableDocument = { pages: unknown; options: unknown; variables: unknown };

/** What the renderer needs besides the row; tests and the share route may swap the logo. */
export interface RenderDeps {
  logo?: () => Uint8Array;
}

const BODY = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const RULE = rgb(0.6, 0.6, 0.6);
const HEADER_SHADE = rgb(0.88, 0.88, 0.88);
const ZEBRA_SHADE = rgb(0.955, 0.955, 0.955);
const PLACEHOLDER_FILL = rgb(0.93, 0.93, 0.93);

/** pdf-lib's standard fonts cover WinAnsi only; swap the few characters that break (the bullet is in WinAnsi). */
const clean = (s: string) =>
  s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^ -ÿ•\n\r\t]/g, "?");

export interface LoadedImage {
  image: PDFImage;
  /** The picture's size as it shows: a ticket photo's sides swap when it is turned by 90 / 270. */
  width: number;
  height: number;
  marks: PhotoMark[];
  /** How the picture is shown turned (a ticket photo's rotation; 0 for every other picture). */
  rotation: Rotation;
}

/**
 * Every picture a page list shows, by the key the layout uses (`${module id}:${slot}`), as the
 * document's checkboxes show it (Oct 28, both view switches — the pages themselves are never
 * changed): with Photos off only the letterhead's logo is listed (the layout places no picture
 * either); with Marks off every ref comes back without its marks — a ticket photo's flag off, an
 * upload's drawn marks left out — so what loads is what prints. A Repair List's pictures come
 * from the document's inspection snapshot (phase 2).
 */
export function imageRefs(
  pages: readonly DocPage[],
  opts: {
    inspection?: InspectionSnapshot | null | undefined;
    marks?: boolean | undefined;
    photos?: boolean | undefined;
  } = {},
): Map<string, ImageRef> {
  const out = new Map<string, ImageRef>();
  const photos = opts.photos !== false;
  const marks = opts.marks !== false;
  /** The ref as the Marks checkbox shows it (a copy; the page's ref keeps its marks). */
  const shown = (ref: ImageRef): ImageRef => {
    if (marks) return ref;
    if (ref.kind === "ticketPhoto") return ref.marks ? { ...ref, marks: false } : ref;
    if (ref.kind === "upload" && ref.marks) {
      const { marks: _hidden, ...rest } = ref;
      return rest;
    }
    return ref;
  };
  for (const p of pages)
    for (const m of p.modules) {
      if (m.type === "letterhead" && m.logo) out.set(`${m.id}:0`, { kind: "logo" });
      if (!photos) continue;
      if ((m.type === "fullPhoto" || m.type === "photoLeft" || m.type === "photoRight") && m.image)
        out.set(`${m.id}:0`, shown(m.image));
      if (m.type === "twoPhotos")
        m.images.forEach((img, i) => {
          if (img) out.set(`${m.id}:${i}`, shown(img));
        });
      if (m.type === "photoGrid")
        m.images.forEach((cell, i) => out.set(photoGridKey(m.id, i), shown(cell.image)));
      if (m.type === "repairList" && opts.inspection) {
        const data = repairListData(m, opts.inspection, true);
        data.photoIds.forEach((ids, ri) =>
          ids.forEach((photoId, pi) =>
            out.set(repairListKey(m.id, ri, pi), { kind: "ticketPhoto", photoId, marks }),
          ),
        );
      }
    }
  return out;
}

async function embed(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  try {
    if (isPng) return await pdf.embedPng(bytes);
    if (isJpg) return await pdf.embedJpg(bytes);
  } catch {
    /* unreadable image */
  }
  // webp / heic: the invoice renderer has no conversion path either; the layout prints a box.
  return null;
}

async function download(sb: Client, bucket: string, path: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/** Load and embed every picture; a failure is a null (the layout draws a placeholder). Exported for its test. */
export async function loadImages(
  sb: Client,
  pdf: PDFDocument,
  refs: Map<string, ImageRef>,
  deps: RenderDeps,
): Promise<Map<string, LoadedImage | null>> {
  const out = new Map<string, LoadedImage | null>();
  const photoIds = [...refs.values()]
    .filter((r): r is Extract<ImageRef, { kind: "ticketPhoto" }> => r.kind === "ticketPhoto")
    .map((r) => r.photoId);
  const photos = new Map<string, { storage_path: string; annotations: unknown }>();
  if (photoIds.length) {
    const { data } = await sb
      .from("service_job_photos")
      .select("id, storage_path, annotations")
      .in("id", [...new Set(photoIds)]);
    for (const p of data ?? []) photos.set(p.id, p);
  }
  // The property cover photos (phase 2): the row's path in the documents bucket, by site id.
  const siteIds = [...refs.values()]
    .filter((r): r is Extract<ImageRef, { kind: "siteCover" }> => r.kind === "siteCover")
    .map((r) => r.siteId);
  const coverPaths = new Map<string, string>();
  if (siteIds.length) {
    const { data } = await sb
      .from("crm_sites")
      .select("id, cover_photo_path")
      .in("id", [...new Set(siteIds)]);
    for (const s of data ?? []) if (s.cover_photo_path) coverPaths.set(s.id, s.cover_photo_path);
  }
  // The same file is embedded once however many pictures show it.
  const embedded = new Map<string, PDFImage | null>();
  const embedPath = async (bucket: string, path: string): Promise<PDFImage | null> => {
    const k = `${bucket}/${path}`;
    if (embedded.has(k)) return embedded.get(k)!;
    const bytes = await download(sb, bucket, path);
    const img = bytes ? await embed(pdf, bytes) : null;
    embedded.set(k, img);
    return img;
  };
  let logo: PDFImage | null | undefined;
  for (const [key, ref] of refs) {
    try {
      if (ref.kind === "logo") {
        if (logo === undefined) logo = await embed(pdf, (deps.logo ?? jbkLogoPng)());
        out.set(
          key,
          logo
            ? { image: logo, width: logo.width, height: logo.height, marks: [], rotation: 0 }
            : null,
        );
        continue;
      }
      if (ref.kind === "upload") {
        const img = await embedPath(DOCUMENTS_BUCKET, ref.path);
        // The marks drawn on it in the editor (phase 2); imageRefs leaves them off the ref when
        // the Marks checkbox is off (the page's own ref keeps them), so what is here is what prints.
        out.set(
          key,
          img
            ? {
                image: img,
                width: img.width,
                height: img.height,
                marks: ref.marks ?? [],
                rotation: 0,
              }
            : null,
        );
        continue;
      }
      if (ref.kind === "siteCover") {
        const path = coverPaths.get(ref.siteId);
        const img = path ? await embedPath(DOCUMENTS_BUCKET, path) : null;
        out.set(
          key,
          img ? { image: img, width: img.width, height: img.height, marks: [], rotation: 0 } : null,
        );
        continue;
      }
      const row = photos.get(ref.photoId);
      const img = row ? await embedPath(SERVICE_BUCKET, row.storage_path) : null;
      // The ticket's rotation always (a sideways photo prints upright whether its marks draw or
      // not); the layout fits the turned box, so its sides are the turned ones here.
      const markup = parsePhotoMarkup(row?.annotations);
      const shown = img ? rotatedBox(img.width, img.height, markup.rotation) : null;
      out.set(
        key,
        img && shown
          ? {
              image: img,
              width: shown.w,
              height: shown.h,
              marks: ref.marks ? markup.marks : [],
              rotation: markup.rotation,
            }
          : null,
      );
    } catch {
      out.set(key, null);
    }
  }
  return out;
}

/** The library PDFs a page list inserts, loaded once each; a missing one inserts nothing. */
async function loadAssets(
  sb: Client,
  pages: readonly DocPage[],
): Promise<Map<string, PDFDocument | null>> {
  const ids = new Set<string>();
  for (const p of pages) for (const m of p.modules) if (m.type === "pdf") ids.add(m.assetId);
  const out = new Map<string, PDFDocument | null>();
  if (!ids.size) return out;
  const { data } = await sb
    .from("document_assets")
    .select("id, storage_path")
    .in("id", [...ids]);
  const paths = new Map((data ?? []).map((a) => [a.id, a.storage_path]));
  for (const id of ids) {
    const bytes = await download(sb, DOCUMENTS_BUCKET, paths.get(id) ?? documentAssetPath(id));
    if (!bytes) {
      out.set(id, null);
      continue;
    }
    try {
      out.set(id, await PDFDocument.load(bytes, { ignoreEncryption: true }));
    } catch {
      out.set(id, null);
    }
  }
  return out;
}

class Drawer {
  constructor(
    readonly pdf: PDFDocument,
    readonly fonts: Record<FontKey, PDFFont>,
    readonly images: Map<string, LoadedImage | null>,
  ) {}
  page!: PDFPage;
  /** The content box starts at the left margin; every piece x is from there. */
  readonly left = PAGE.marginPt;

  text(s: string, x: number, baseline: number, size: number, font: FontKey, color: RGB) {
    if (!s) return;
    this.page.drawText(clean(s), { x, y: baseline, size, font: this.fonts[font], color });
  }
  width(s: string, font: FontKey, size: number) {
    return this.fonts[font].widthOfTextAtSize(clean(s), size);
  }

  /** Draw one page's placed pieces; `top` is the content box's top in PDF coordinates. */
  draw(placed: readonly Placed[], top: number) {
    for (const { piece, y } of placed) this.piece(piece, top - y);
  }

  piece(p: Piece, yTop: number) {
    const L = this.left;
    switch (p.kind) {
      case "gap":
        return;
      case "text": {
        const baseline = yTop - p.line.size;
        const color = p.line.color === "muted" ? MUTED : BODY;
        if (p.line.marker)
          this.text(
            p.line.marker,
            L + p.x + (p.line.markerX ?? 0),
            baseline,
            p.line.size,
            "regular",
            color,
          );
        for (const s of p.line.segments) {
          this.text(s.text, L + p.x + s.x, baseline, s.size, s.font, color);
          if (s.underline)
            this.page.drawLine({
              start: { x: L + p.x + s.x, y: baseline - 1.5 },
              end: { x: L + p.x + s.x + s.width, y: baseline - 1.5 },
              thickness: 0.6,
              color,
            });
        }
        return;
      }
      case "rule":
        this.page.drawLine({
          start: { x: L + p.x, y: yTop - p.height / 2 },
          end: { x: L + p.x + p.width, y: yTop - p.height / 2 },
          thickness: p.thickness,
          color: RULE,
        });
        return;
      case "image": {
        const img = this.images.get(p.key);
        if (!img) {
          this.placeholder(L + p.x, yTop, p.width, p.height);
          return;
        }
        const box = { x: L + p.x, y: yTop - p.height, w: p.width, h: p.height };
        drawPhoto(
          { page: this.page, bold: this.fonts.bold },
          img.image,
          img.marks,
          box,
          img.rotation,
        );
        return;
      }
      case "placeholder":
        this.placeholder(L + p.x, yTop, p.width, p.height, p.text);
        return;
      case "tableRow": {
        if (p.shade)
          this.page.drawRectangle({
            x: L + p.x,
            y: yTop - p.height,
            width: p.width,
            height: p.height,
            color: p.header ? HEADER_SHADE : ZEBRA_SHADE,
          });
        const font: FontKey = p.bold ? "bold" : "regular";
        const lineH = p.size * 1.35;
        for (const c of p.cells) {
          c.lines.forEach((line, i) => {
            const w = this.width(line, font, p.size);
            const x =
              c.align === "right"
                ? L + c.x + c.width - CELL_PAD - w
                : c.align === "center"
                  ? L + c.x + (c.width - w) / 2
                  : L + c.x + CELL_PAD;
            this.text(line, x, yTop - CELL_PAD - p.size - i * lineH, p.size, font, BODY);
          });
        }
        this.page.drawLine({
          start: { x: L + p.x, y: yTop - p.height },
          end: { x: L + p.x + p.width, y: yTop - p.height },
          thickness: 0.4,
          color: RULE,
        });
        return;
      }
      case "signature": {
        const ruleY = yTop - SIGNATURE_SPACE;
        for (const e of p.entries) {
          this.page.drawLine({
            start: { x: L + e.x, y: ruleY },
            end: { x: L + e.x + e.width, y: ruleY },
            thickness: 0.75,
            color: BODY,
          });
          this.text(e.label, L + e.x, ruleY - 4 - FOOTER_SIZE, FOOTER_SIZE, "regular", MUTED);
        }
        return;
      }
      case "columns":
        for (const c of p.columns) {
          let y = yTop;
          for (const inner of c.pieces) {
            this.piece(inner, y);
            y -= inner.height;
          }
        }
        return;
    }
  }

  placeholder(x: number, yTop: number, w: number, h: number, label = "picture not printable") {
    this.page.drawRectangle({
      x,
      y: yTop - h,
      width: w,
      height: h,
      color: PLACEHOLDER_FILL,
      borderColor: RULE,
      borderWidth: 0.5,
    });
    const tw = this.width(label, "regular", FOOTER_SIZE);
    this.text(
      label,
      x + (w - tw) / 2,
      yTop - h / 2 - FOOTER_SIZE / 2,
      FOOTER_SIZE,
      "regular",
      MUTED,
    );
  }

  footer(line: string, label: string) {
    const y = PAGE.marginPt - 24;
    this.text(line, PAGE.marginPt, y, FOOTER_SIZE, "regular", MUTED);
    const w = this.width(label, "regular", FOOTER_SIZE);
    this.text(label, PAGE.widthPt - PAGE.marginPt - w, y, FOOTER_SIZE, "regular", MUTED);
  }
}

/** The row's pages and options, read leniently (an unreadable page list prints as empty). */
export function parseDocument(doc: Pick<RenderableDocument, "pages" | "options">) {
  const pages = pagesSchema.safeParse(doc.pages);
  const options = optionsSchema.safeParse(doc.options);
  return {
    pages: pages.success ? pages.data : [],
    options: options.success ? options.data : DEFAULT_OPTIONS,
  };
}

/** Render a document to PDF bytes. */
export async function renderDocumentPdf(
  sb: Client,
  doc: RenderableDocument,
  deps: RenderDeps = {},
): Promise<Uint8Array> {
  const { pages, options } = parseDocument(doc);
  const vars = displayVariables(doc.variables as Parameters<typeof displayVariables>[0]);
  const pricing = pricingSource(doc.variables);
  const inspection = storedInspection(doc.variables);

  const pdf = await PDFDocument.create();
  const fonts: Record<FontKey, PDFFont> = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const measure: Measure = (text, font, size) => fonts[font].widthOfTextAtSize(clean(text), size);
  const [images, assets] = await Promise.all([
    loadImages(
      sb,
      pdf,
      imageRefs(pages, { inspection, marks: options.marks, photos: options.photos }),
      deps,
    ),
    loadAssets(sb, pages),
  ]);
  const ctx: LayoutContext = {
    width: CONTENT_WIDTH,
    measure,
    vars,
    labelOf: variableLabel,
    image: (_ref, key): ImageSize | null => {
      const img = images.get(key);
      return img ? { width: img.width, height: img.height } : null;
    },
    pricing,
    inspection,
    marks: options.marks,
    photos: options.photos,
  };
  const drawer = new Drawer(pdf, fonts, images);
  const top = PAGE.heightPt - PAGE.marginPt;
  /** Which PDF pages are the document's own (footer) rather than inserted (none). */
  const contentPages: PDFPage[] = [];
  const contentPage = () => {
    drawer.page = pdf.addPage([PAGE.widthPt, PAGE.heightPt]);
    contentPages.push(drawer.page);
    return drawer.page;
  };

  const docPages: DocPage[] = pages.length ? pages : [{ id: "p", modules: [] }];
  for (const page of docPages) {
    const segments = splitAtPdf(page.modules as DocModule[]);
    if (!segments.length) {
      contentPage();
      continue;
    }
    for (const seg of segments) {
      if (seg.kind === "pdf") {
        const asset = assets.get(seg.module.assetId);
        if (!asset) continue;
        const copied = await pdf.copyPages(asset, asset.getPageIndices());
        for (const p of copied) pdf.addPage(p);
        continue;
      }
      const pieces = layoutModules(seg.modules, ctx);
      for (const placed of paginate(pieces, contentHeightFor(options))) {
        contentPage();
        drawer.draw(placed, top);
      }
    }
  }

  if (options.footer) {
    const total = pdf.getPageCount();
    const line = footerLine(vars);
    pdf.getPages().forEach((p, i) => {
      if (!contentPages.includes(p)) return;
      drawer.page = p;
      drawer.footer(line, pageLabel(i + 1, total));
    });
  }
  return pdf.save();
}
