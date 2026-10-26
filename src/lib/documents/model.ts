/**
 * The document model (owner, Oct 26: a CenterPoint-style document generator — "they need to be
 * able to edit it after its generated from the checkboxes"; Modules / Variables / Insert PDF /
 * Add Page / Save Template As / Revisions, screenshots of CenterPoint's "Build a Bid" editor).
 *
 * A DOCUMENT belongs to a bid or a service ticket and is a list of PAGES; a page is a stack of
 * MODULES (the CenterPoint nine — Body, Two columns, Full Photo, Photo on left, Photo on right,
 * Two photos, Full Table, Signature, Horizontal Line — plus Letterhead, Pricing Table and an
 * inserted PDF). Text is ProseMirror JSON (TipTap in the editor) whose "variable" nodes are merge
 * fields resolved from the record (variables.ts). A TEMPLATE is the same page list saved under a
 * name with the checkbox OPTIONS a new document starts from; generating a document copies the
 * template's pages (fresh ids), applies the options and snapshots the variables; from then on the
 * document is edited on its own (the record is never touched) and every save is a REVISION.
 *
 * Pure: types, zod schemas, ids, template instantiation and the page / module operations the
 * editor runs. The database (documents.functions.ts), the PDF (document-pdf.server.ts) and the
 * editor (components/documents/*) all build on this file; it imports nothing of theirs.
 */
import { z } from "zod";

// ---------------------------------------------------------------- rich text (ProseMirror JSON)

/** Node / mark attributes: JSON primitives only (level, textAlign, key …), so a document is serialisable end to end. */
export type RichAttrs = Record<string, string | number | boolean | null>;

/** A ProseMirror node as TipTap serialises it (editor.getJSON()). */
export interface RichNode {
  type: string;
  attrs?: RichAttrs | undefined;
  content?: RichNode[] | undefined;
  marks?: Array<{ type: string; attrs?: RichAttrs | undefined }> | undefined;
  text?: string | undefined;
}
/** The root: `{ type: "doc", content: [...] }`. */
export interface RichDoc {
  type: "doc";
  content?: RichNode[] | undefined;
}

const richAttrsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: richAttrsSchema.optional(),
    content: z.array(richNodeSchema).optional(),
    marks: z.array(z.object({ type: z.string(), attrs: richAttrsSchema.optional() })).optional(),
    text: z.string().optional(),
  }),
);
export const richDocSchema: z.ZodType<RichDoc> = z.object({
  type: z.literal("doc"),
  content: z.array(richNodeSchema).optional(),
});

/** The node type a merge field is stored as; `attrs.key` names the variable (variables.ts). */
export const VARIABLE_NODE = "variable";

/** An empty rich text. */
export const emptyRich = (): RichDoc => ({ type: "doc", content: [{ type: "paragraph" }] });

/** Rich text from plain lines: one paragraph per line (a blank line is an empty paragraph). */
export function richFromText(
  text: string,
  opts?: { heading?: 1 | 2 | 3; align?: TextAlign },
): RichDoc {
  const lines = text.split("\n");
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: opts?.heading ? "heading" : "paragraph",
      ...(opts?.heading || opts?.align
        ? {
            attrs: {
              ...(opts.heading ? { level: opts.heading } : {}),
              ...(opts.align ? { textAlign: opts.align } : {}),
            },
          }
        : {}),
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

/** A rich paragraph built from pieces: strings and `{ variable: key }` chips, in order. */
export function richLine(
  pieces: Array<string | { variable: string }>,
  opts?: { align?: TextAlign; bold?: boolean },
): RichNode {
  const marks = opts?.bold ? [{ type: "bold" }] : undefined;
  return {
    type: "paragraph",
    ...(opts?.align ? { attrs: { textAlign: opts.align } } : {}),
    content: pieces.map((p) =>
      typeof p === "string"
        ? { type: "text", text: p, ...(marks ? { marks } : {}) }
        : { type: VARIABLE_NODE, attrs: { key: p.variable }, ...(marks ? { marks } : {}) },
    ),
  };
}

export type TextAlign = "left" | "center" | "right";

/**
 * The plain text of a rich doc with its variables resolved (a missing variable prints as its
 * label in brackets so the gap is visible, never blank). Blocks are joined with newlines.
 */
export function richToText(
  doc: RichDoc | RichNode | null | undefined,
  vars: Record<string, string> = {},
  labelOf: (key: string) => string = (k) => k,
): string {
  if (!doc) return "";
  const out: string[] = [];
  const walk = (n: RichNode, acc: string[]) => {
    if (n.type === "text") {
      acc.push(n.text ?? "");
      return;
    }
    if (n.type === VARIABLE_NODE) {
      const key = String(n.attrs?.["key"] ?? "");
      acc.push(key in vars ? vars[key]! : `[${labelOf(key)}]`);
      return;
    }
    if (n.type === "hardBreak") {
      acc.push("\n");
      return;
    }
    const block = BLOCK_TYPES.has(n.type);
    const inner: string[] = [];
    for (const c of n.content ?? []) walk(c, inner);
    if (block) {
      acc.push(inner.join(""));
      acc.push("\n");
    } else acc.push(inner.join(""));
  };
  const root = doc as RichNode;
  for (const c of root.content ?? []) walk(c, out);
  return out.join("").replace(/\n+$/, "");
}
const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "blockquote", "tableRow"]);

/** Every variable key used in a rich doc (for "Refresh data" and the template preview). */
export function richVariables(
  doc: RichDoc | RichNode | null | undefined,
  into = new Set<string>(),
) {
  if (!doc) return into;
  const walk = (n: RichNode) => {
    if (n.type === VARIABLE_NODE) into.add(String(n.attrs?.["key"] ?? ""));
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc as RichNode);
  return into;
}

// ---------------------------------------------------------------------------------- images

/** What a photo module shows. */
export type ImageRef =
  /** A picture uploaded into this document (the "documents" bucket). */
  | { kind: "upload"; path: string; width: number; height: number; name?: string | undefined }
  /** A ticket photo (service_job_photos.id), drawn with or without its marks. */
  | { kind: "ticketPhoto"; photoId: string; marks: boolean }
  /** The company logo (jbk-logo.server.ts). */
  | { kind: "logo" };

export const imageRefSchema: z.ZodType<ImageRef> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("upload"),
    path: z.string().min(1),
    width: z.number().positive(),
    height: z.number().positive(),
    name: z.string().optional(),
  }),
  z.object({ kind: z.literal("ticketPhoto"), photoId: z.string().uuid(), marks: z.boolean() }),
  z.object({ kind: z.literal("logo") }),
]);

// --------------------------------------------------------------------------------- modules

export const MODULE_TYPES = [
  "letterhead",
  "body",
  "twoColumns",
  "fullPhoto",
  "photoLeft",
  "photoRight",
  "twoPhotos",
  "table",
  "pricingTable",
  "signature",
  "hr",
  "pdf",
] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

/** The Modules tab tiles, in CenterPoint's order, then ours. */
export const MODULE_LABELS: Record<ModuleType, string> = {
  body: "Body",
  twoColumns: "Two columns",
  fullPhoto: "Full Photo",
  photoLeft: "Photo on left",
  photoRight: "Photo on right",
  twoPhotos: "Two photos",
  table: "Full Table",
  signature: "Signature",
  hr: "Horizontal Line",
  letterhead: "Letterhead",
  pricingTable: "Pricing Table",
  pdf: "Inserted PDF",
};
/** The tiles offered on the Modules tab (an inserted PDF comes from Insert PDF, not a tile). */
export const MODULE_TILES: ModuleType[] = [
  "body",
  "twoColumns",
  "fullPhoto",
  "photoLeft",
  "photoRight",
  "twoPhotos",
  "table",
  "signature",
  "hr",
  "letterhead",
  "pricingTable",
];

/** How a Pricing Table shows the bid's money (the "with or without cost" checkbox). */
export type PriceMode = "total" | "none";

export interface ModuleBase {
  id: string;
}
export interface LetterheadModule extends ModuleBase {
  type: "letterhead";
  /** The logo at the left; the company block (Account variables) at the right. */
  logo: boolean;
  text: RichDoc;
}
export interface BodyModule extends ModuleBase {
  type: "body";
  text: RichDoc;
}
export interface TwoColumnsModule extends ModuleBase {
  type: "twoColumns";
  left: RichDoc;
  right: RichDoc;
}
export interface FullPhotoModule extends ModuleBase {
  type: "fullPhoto";
  image: ImageRef | null;
  caption: string;
  /** Printed height in inches (the width is the page's); 0 = keep the picture's shape. */
  heightIn: number;
}
export interface PhotoTextModule extends ModuleBase {
  type: "photoLeft" | "photoRight";
  image: ImageRef | null;
  caption: string;
  text: RichDoc;
}
export interface TwoPhotosModule extends ModuleBase {
  type: "twoPhotos";
  images: [ImageRef | null, ImageRef | null];
  captions: [string, string];
}
export interface TableModule extends ModuleBase {
  type: "table";
  /** Column headings; blank = no header row. */
  columns: Array<{ title: string; align: TextAlign; width?: number | undefined }>;
  /** Cells are plain text; `{{key}}` inside a cell is a variable (resolveCellText). */
  rows: string[][];
}
export interface PricingTableModule extends ModuleBase {
  type: "pricingTable";
  /** One row per roof section (name, size, square feet, system) and a total row. */
  mode: PriceMode;
  /** Hand edits after generation: when set, these rows print instead of the record's. */
  rows: string[][] | null;
  showSections: boolean;
}
export interface SignatureModule extends ModuleBase {
  type: "signature";
  /** One line each, e.g. "Customer", "Date", "JBK, Inc." */
  lines: string[];
}
export interface HrModule extends ModuleBase {
  type: "hr";
}
export interface PdfModule extends ModuleBase {
  type: "pdf";
  /** document_assets.id (the PDF library) and what it was called when inserted. */
  assetId: string;
  name: string;
  pageCount: number;
}

export type DocModule =
  | LetterheadModule
  | BodyModule
  | TwoColumnsModule
  | FullPhotoModule
  | PhotoTextModule
  | TwoPhotosModule
  | TableModule
  | PricingTableModule
  | SignatureModule
  | HrModule
  | PdfModule;

const align = z.enum(["left", "center", "right"]);
export const moduleSchema: z.ZodType<DocModule> = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("letterhead"),
    logo: z.boolean(),
    text: richDocSchema,
  }),
  z.object({ id: z.string(), type: z.literal("body"), text: richDocSchema }),
  z.object({
    id: z.string(),
    type: z.literal("twoColumns"),
    left: richDocSchema,
    right: richDocSchema,
  }),
  z.object({
    id: z.string(),
    type: z.literal("fullPhoto"),
    image: imageRefSchema.nullable(),
    caption: z.string(),
    heightIn: z.number().min(0).max(9),
  }),
  z.object({
    id: z.string(),
    type: z.enum(["photoLeft", "photoRight"]),
    image: imageRefSchema.nullable(),
    caption: z.string(),
    text: richDocSchema,
  }),
  z.object({
    id: z.string(),
    type: z.literal("twoPhotos"),
    images: z.tuple([imageRefSchema.nullable(), imageRefSchema.nullable()]),
    captions: z.tuple([z.string(), z.string()]),
  }),
  z.object({
    id: z.string(),
    type: z.literal("table"),
    columns: z.array(
      z.object({ title: z.string(), align, width: z.number().positive().optional() }),
    ),
    rows: z.array(z.array(z.string())),
  }),
  z.object({
    id: z.string(),
    type: z.literal("pricingTable"),
    mode: z.enum(["total", "none"]),
    rows: z.array(z.array(z.string())).nullable(),
    showSections: z.boolean(),
  }),
  z.object({ id: z.string(), type: z.literal("signature"), lines: z.array(z.string()) }),
  z.object({ id: z.string(), type: z.literal("hr") }),
  z.object({
    id: z.string(),
    type: z.literal("pdf"),
    assetId: z.string().uuid(),
    name: z.string(),
    pageCount: z.number().int().positive(),
  }),
]);

// ----------------------------------------------------------------------------------- pages

export interface DocPage {
  id: string;
  modules: DocModule[];
}
export const pageSchema: z.ZodType<DocPage> = z.object({
  id: z.string(),
  modules: z.array(moduleSchema),
});
export const pagesSchema = z.array(pageSchema).max(60);

/** The generate-time checkboxes; a template stores its defaults, a document what it was made with. */
export interface DocOptions {
  /** With or without cost. */
  prices: PriceMode;
  /** Photo modules: keep them (with the pictures chosen on the ticket) or drop them. */
  photos: boolean;
  /** Draw the marks on ticket photos. */
  marks: boolean;
  /** Page numbers and the company line at the foot of every page. */
  footer: boolean;
  /** The dotted page-break guide, inches from the top (CenterPoint: 8.8, range 5–10.5). */
  pageBreakIn: number;
}
export const DEFAULT_OPTIONS: DocOptions = {
  prices: "total",
  photos: true,
  marks: true,
  footer: true,
  pageBreakIn: 8.8,
};
export const optionsSchema: z.ZodType<DocOptions> = z.object({
  prices: z.enum(["total", "none"]),
  photos: z.boolean(),
  marks: z.boolean(),
  footer: z.boolean(),
  pageBreakIn: z.number().min(5).max(10.5),
});

/** What a document hangs off. */
export type DocKind = "bid" | "ticket";
export const DOC_KINDS = ["bid", "ticket"] as const;

/** US Letter in points and the page's printable box (the PDF and the on-screen sheet agree). */
export const PAGE = { widthPt: 612, heightPt: 792, marginPt: 54 } as const;
export const PT_PER_IN = 72;

// ------------------------------------------------------------------------------------- ids

let seq = 0;
/** A short unique id for a page or module (not a uuid: these live inside one jsonb). */
export function newId(prefix = "m"): string {
  seq = (seq + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}${seq.toString(36)}`;
}

/** A fresh module of a type with its empty defaults (the Modules tab "+" / drop). */
export function newModule(type: ModuleType): DocModule {
  const id = newId();
  switch (type) {
    case "letterhead":
      return {
        id,
        type,
        logo: true,
        text: {
          type: "doc",
          content: [
            richLine([{ variable: "account.name" }], { align: "right", bold: true }),
            richLine([{ variable: "account.address1" }], { align: "right" }),
            richLine([{ variable: "account.address2" }], { align: "right" }),
            richLine([{ variable: "account.phone" }], { align: "right" }),
            richLine([{ variable: "account.website" }], { align: "right" }),
          ],
        },
      };
    case "body":
      return { id, type, text: emptyRich() };
    case "twoColumns":
      return { id, type, left: emptyRich(), right: emptyRich() };
    case "fullPhoto":
      return { id, type, image: null, caption: "", heightIn: 0 };
    case "photoLeft":
    case "photoRight":
      return { id, type, image: null, caption: "", text: emptyRich() };
    case "twoPhotos":
      return { id, type, images: [null, null], captions: ["", ""] };
    case "table":
      return {
        id,
        type,
        columns: [
          { title: "Item", align: "left" },
          { title: "Description", align: "left" },
          { title: "Amount", align: "right" },
        ],
        rows: [["", "", ""]],
      };
    case "pricingTable":
      return { id, type, mode: "total", rows: null, showSections: true };
    case "signature":
      return { id, type, lines: ["Customer", "Date", "JBK, Inc."] };
    case "hr":
      return { id, type };
    case "pdf":
      throw new Error("An inserted PDF is made from the library (newPdfModule), not a tile.");
  }
}

export function newPdfModule(asset: { id: string; name: string; pageCount: number }): PdfModule {
  return {
    id: newId(),
    type: "pdf",
    assetId: asset.id,
    name: asset.name,
    pageCount: asset.pageCount,
  };
}

export const newPage = (modules: DocModule[] = []): DocPage => ({ id: newId("p"), modules });

/** A deep copy of pages with fresh ids (generating from a template; duplicating a page). */
export function clonePages(pages: readonly DocPage[]): DocPage[] {
  return pages.map((p) => ({ id: newId("p"), modules: p.modules.map(cloneModule) }));
}
export function cloneModule(m: DocModule): DocModule {
  return { ...(JSON.parse(JSON.stringify(m)) as DocModule), id: newId() };
}

// ------------------------------------------------------------------------- generate / edit ops

/**
 * A new document's pages from a template's pages and the checkboxes: photo modules are dropped
 * when photos are off (an empty page is kept so the structure survives); ticket photos lose their
 * marks when marks are off; every pricing table takes the price mode. Fresh ids throughout.
 */
export function instantiatePages(
  templatePages: readonly DocPage[],
  options: DocOptions,
): DocPage[] {
  const pages = clonePages(templatePages);
  return pages.map((p) => ({
    ...p,
    modules: p.modules
      .filter((m) => options.photos || !isPhotoModule(m))
      .map((m) => applyOptionsToModule(m, options)),
  }));
}

export const isPhotoModule = (m: DocModule) =>
  m.type === "fullPhoto" ||
  m.type === "photoLeft" ||
  m.type === "photoRight" ||
  m.type === "twoPhotos";

const stripMarks = (img: ImageRef | null, marks: boolean): ImageRef | null =>
  img && img.kind === "ticketPhoto" ? { ...img, marks: marks && img.marks } : img;

/** The option switches applied to one module (also run when a switch is flipped after generating). */
export function applyOptionsToModule(m: DocModule, options: DocOptions): DocModule {
  switch (m.type) {
    case "pricingTable":
      return { ...m, mode: options.prices };
    case "fullPhoto":
    case "photoLeft":
    case "photoRight":
      return { ...m, image: stripMarks(m.image, options.marks) };
    case "twoPhotos":
      return {
        ...m,
        images: [stripMarks(m.images[0], options.marks), stripMarks(m.images[1], options.marks)],
      };
    default:
      return m;
  }
}

/** Flip the options on an existing document: only the switched modules change, text is kept. */
export function applyOptionsToPages(pages: readonly DocPage[], options: DocOptions): DocPage[] {
  return pages.map((p) => ({
    ...p,
    modules: p.modules.map((m) => applyOptionsToModule(m, options)),
  }));
}

/** Where a module sits. */
export interface ModuleAddress {
  pageIndex: number;
  moduleIndex: number;
}
export function findModule(pages: readonly DocPage[], moduleId: string): ModuleAddress | null {
  for (let pi = 0; pi < pages.length; pi++) {
    const mi = pages[pi]!.modules.findIndex((m) => m.id === moduleId);
    if (mi >= 0) return { pageIndex: pi, moduleIndex: mi };
  }
  return null;
}

const replaceAt = <T>(arr: readonly T[], i: number, v: T): T[] =>
  arr.map((x, j) => (j === i ? v : x));

export function addModule(
  pages: readonly DocPage[],
  pageIndex: number,
  module: DocModule,
  at?: number,
): DocPage[] {
  const page = pages[pageIndex];
  if (!page) return [...pages];
  const i = at === undefined ? page.modules.length : Math.max(0, Math.min(at, page.modules.length));
  const modules = [...page.modules.slice(0, i), module, ...page.modules.slice(i)];
  return replaceAt(pages, pageIndex, { ...page, modules });
}

export function updateModule(
  pages: readonly DocPage[],
  moduleId: string,
  patch: (m: DocModule) => DocModule,
): DocPage[] {
  const a = findModule(pages, moduleId);
  if (!a) return [...pages];
  const page = pages[a.pageIndex]!;
  const modules = replaceAt(page.modules, a.moduleIndex, patch(page.modules[a.moduleIndex]!));
  return replaceAt(pages, a.pageIndex, { ...page, modules });
}

export function removeModule(pages: readonly DocPage[], moduleId: string): DocPage[] {
  const a = findModule(pages, moduleId);
  if (!a) return [...pages];
  const page = pages[a.pageIndex]!;
  return replaceAt(pages, a.pageIndex, {
    ...page,
    modules: page.modules.filter((m) => m.id !== moduleId),
  });
}

/** Move a module up or down within its page; at an edge it crosses into the neighbouring page. */
export function moveModule(pages: readonly DocPage[], moduleId: string, dir: -1 | 1): DocPage[] {
  const a = findModule(pages, moduleId);
  if (!a) return [...pages];
  const page = pages[a.pageIndex]!;
  const target = a.moduleIndex + dir;
  if (target >= 0 && target < page.modules.length) {
    const modules = [...page.modules];
    [modules[a.moduleIndex], modules[target]] = [modules[target]!, modules[a.moduleIndex]!];
    return replaceAt(pages, a.pageIndex, { ...page, modules });
  }
  const neighbour = a.pageIndex + dir;
  if (neighbour < 0 || neighbour >= pages.length) return [...pages];
  const m = page.modules[a.moduleIndex]!;
  const without = removeModule(pages, moduleId);
  return addModule(without, neighbour, m, dir === 1 ? 0 : undefined);
}

export function duplicateModule(pages: readonly DocPage[], moduleId: string): DocPage[] {
  const a = findModule(pages, moduleId);
  if (!a) return [...pages];
  const m = pages[a.pageIndex]!.modules[a.moduleIndex]!;
  return addModule(pages, a.pageIndex, cloneModule(m), a.moduleIndex + 1);
}

export function addPage(
  pages: readonly DocPage[],
  at?: number,
  page: DocPage = newPage(),
): DocPage[] {
  const i = at === undefined ? pages.length : Math.max(0, Math.min(at, pages.length));
  return [...pages.slice(0, i), page, ...pages.slice(i)];
}
export function removePage(pages: readonly DocPage[], pageId: string): DocPage[] {
  const next = pages.filter((p) => p.id !== pageId);
  return next.length ? next : [newPage()];
}
export function movePage(pages: readonly DocPage[], pageId: string, dir: -1 | 1): DocPage[] {
  const i = pages.findIndex((p) => p.id === pageId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= pages.length) return [...pages];
  const next = [...pages];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
export function duplicatePage(pages: readonly DocPage[], pageId: string): DocPage[] {
  const i = pages.findIndex((p) => p.id === pageId);
  if (i < 0) return [...pages];
  return addPage(pages, i + 1, clonePages([pages[i]!])[0]!);
}

/** `{{key}}` inside a table cell → the variable's value (a missing one prints as [label]). */
export function resolveCellText(
  cell: string,
  vars: Record<string, string>,
  labelOf: (key: string) => string = (k) => k,
): string {
  return cell.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) =>
    key in vars ? vars[key]! : `[${labelOf(key)}]`,
  );
}

/** Every variable key a page list uses (rich text and table cells). */
export function pagesVariables(pages: readonly DocPage[]): Set<string> {
  const keys = new Set<string>();
  const cell = (s: string) => {
    for (const m of s.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) keys.add(m[1]!);
  };
  for (const p of pages)
    for (const m of p.modules) {
      if ("text" in m) richVariables(m.text, keys);
      if (m.type === "twoColumns") {
        richVariables(m.left, keys);
        richVariables(m.right, keys);
      }
      if (m.type === "table") m.rows.forEach((r) => r.forEach(cell));
      if (m.type === "pricingTable" && m.rows) m.rows.forEach((r) => r.forEach(cell));
    }
  return keys;
}

/** The title a new document starts with. */
export function defaultDocumentTitle(
  templateName: string,
  record: { kind: DocKind; label: string },
): string {
  return `${templateName} — ${record.label}`;
}
