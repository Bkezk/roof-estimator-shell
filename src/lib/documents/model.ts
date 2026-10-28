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

import { type PhotoMark, photoMarkSchema } from "../photo-annotations";

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
  /**
   * A picture uploaded into this document (the "documents" bucket), with the marks drawn on it
   * in the editor (phase 2, owner Oct 26: "mark up the pictures in the documents").
   */
  | {
      kind: "upload";
      path: string;
      width: number;
      height: number;
      name?: string | undefined;
      marks?: PhotoMark[] | undefined;
    }
  /** A ticket photo (service_job_photos.id), drawn with or without its marks (the ticket's own). */
  | { kind: "ticketPhoto"; photoId: string; marks: boolean }
  /** The property's cover photo (crm_sites.cover_photo_path; phase 2). */
  | { kind: "siteCover"; siteId: string }
  /** The company logo (jbk-logo.server.ts). */
  | { kind: "logo" };

export const imageRefSchema: z.ZodType<ImageRef, z.ZodTypeDef, unknown> = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("upload"),
      path: z.string().min(1),
      width: z.number().positive(),
      height: z.number().positive(),
      name: z.string().optional(),
      marks: z.array(photoMarkSchema).max(200).optional(),
    }),
    z.object({ kind: z.literal("ticketPhoto"), photoId: z.string().uuid(), marks: z.boolean() }),
    z.object({ kind: z.literal("siteCover"), siteId: z.string().uuid() }),
    z.object({ kind: z.literal("logo") }),
  ],
);

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
  "photoGrid",
  "repairList",
  "repairItem",
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
  photoGrid: "Photo Grid",
  repairList: "Repair List",
  repairItem: "Checklist item",
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
  "photoGrid",
  "repairList",
  "repairItem",
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
  /** Printed picture height in inches (owner, Oct 28); absent or 0 = the picture's own shape in its column. */
  photoHeightIn?: number | undefined;
}
export interface TwoPhotosModule extends ModuleBase {
  type: "twoPhotos";
  images: [ImageRef | null, ImageRef | null];
  captions: [string, string];
  /** Printed picture height in inches (owner, Oct 28); absent or 0 = up to 4 in, the width deciding. */
  photoHeightIn?: number | undefined;
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
/** A grid of pictures with captions (phase 2: the inspection report's photo pages). */
export interface PhotoGridModule extends ModuleBase {
  type: "photoGrid";
  images: Array<{ image: ImageRef; caption: string }>;
  columns: 2 | 3;
  /** Each cell's picture height in inches (owner, Oct 28); absent or 0 = the cell's 4:3 box. */
  photoHeightIn?: number | undefined;
}
/**
 * The inspection's findings (phase 2): one row per checklist item flagged as an issue — the
 * item, the note, its pictures — from the document's `__inspection` snapshot
 * (variables.ts inspectionRows). Hand edits after generation: `rows` printed instead.
 */
export interface RepairListModule extends ModuleBase {
  type: "repairList";
  rows: string[][] | null;
  /**
   * Kept for saved documents and IGNORED since Oct 28 (owner: the module's "Show pictures" switch
   * is gone) — each item's pictures print under its row whenever the document's Photos option is on.
   */
  photos: boolean;
  /** Also list the items found OK (a full checklist), not only the issues; false (the default) = issues only. */
  allItems: boolean;
  /** Each row's thumbnails' height in inches (owner, Oct 28); absent or 0 = 1.6 × 1.2 in, three a line. */
  photoHeightIn?: number | undefined;
}
/**
 * ONE checklist item from the document's `__inspection` snapshot (owner, Oct 28: "the checklist
 * currently comes through as one big box, id like the ability to manipulate each checklist item
 * box so i can have space between them or one for each page"): the item's name in bold, its
 * note, its pictures as thumbnails like a Repair List row, then a gap below. A new document
 * from a template splits every Repair List into these (server-pure.ts splitRepairLists); the
 * "Split into items" link on a Repair List does the same by hand. `label` / `note` null = live
 * from the snapshot (Refresh data updates them); a typed text is kept instead.
 */
export interface RepairItemModule extends ModuleBase {
  type: "repairItem";
  /** The checklist item's id in the snapshot (InspectionSnapshot.items[].id). */
  itemId: string;
  label: string | null;
  note: string | null;
  /** The thumbnails' height in inches (as a Repair List's); absent or 0 = 1.6 × 1.2 in. */
  photoHeightIn?: number | undefined;
  /** The gap under the item in inches; absent = REPAIR_ITEM_SPACE_IN. */
  spaceBelowIn?: number | undefined;
}
/** The default gap under a Checklist item, in inches. */
export const REPAIR_ITEM_SPACE_IN = 0.25;
/** The most a Checklist item's gap can be, in inches (the box clamps to it). */
export const REPAIR_ITEM_SPACE_MAX_IN = 8;
/** A Checklist item's gap below in inches: the default when absent, 0 or not a finite number. */
export function repairItemSpaceOf(m: { spaceBelowIn?: number | undefined }): number {
  const s = m.spaceBelowIn;
  return typeof s === "number" && Number.isFinite(s) && s > 0
    ? Math.min(s, REPAIR_ITEM_SPACE_MAX_IN)
    : REPAIR_ITEM_SPACE_IN;
}
/**
 * The module with its gap below set: a positive gap (clamped) is written; 0 or less removes the
 * key, so a blank box means the default and the saved JSON never carries 0 or undefined.
 */
export function withRepairItemSpace(m: RepairItemModule, spaceIn: number): RepairItemModule {
  const { spaceBelowIn: _old, ...rest } = m;
  const s = Number.isFinite(spaceIn) ? Math.min(Math.max(spaceIn, 0), REPAIR_ITEM_SPACE_MAX_IN) : 0;
  return s > 0 ? { ...rest, spaceBelowIn: s } : rest;
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
  | PdfModule
  | PhotoGridModule
  | RepairListModule
  | RepairItemModule;

// ------------------------------------------------------------------------- picture sizes

/**
 * The picture size on a photo-carrying module (owner, Oct 28: "we need to be able to resize the
 * photo on the document editor" — on every ticket and bid document, whatever template it came
 * from). Full Photo has had `heightIn` since Oct 26; Photo on left / right, Two Photos, Photo Grid
 * and Repair List carry `photoHeightIn` the same way: inches, 0 or absent = today's shape (the
 * key is left out of the saved JSON then — never written as undefined), at most PHOTO_HEIGHT_MAX.
 * The editor offers Small / Medium / Large and an exact box.
 */
export const PHOTO_HEIGHT_MAX = 9;
export const PHOTO_SIZE_PRESETS = [
  { label: "Small", heightIn: 1.5 },
  { label: "Medium", heightIn: 2.5 },
  { label: "Large", heightIn: 4 },
] as const;
const photoHeightSchema = z.number().min(0).max(PHOTO_HEIGHT_MAX).optional();
/** The modules that carry pictures and so a size setting (the letterhead's logo is not a photo). */
export const PICTURE_MODULE_TYPES = [
  "fullPhoto",
  "photoLeft",
  "photoRight",
  "twoPhotos",
  "photoGrid",
  "repairList",
  "repairItem",
] as const satisfies readonly ModuleType[];
/** The modules whose size is `photoHeightIn` (Full Photo keeps its own `heightIn`). */
export type PhotoHeightModule =
  PhotoTextModule | TwoPhotosModule | PhotoGridModule | RepairListModule | RepairItemModule;
/** A module's picture height in inches: 0 when absent, 0 or not a finite number. */
export function photoHeightOf(m: { photoHeightIn?: number | undefined }): number {
  const h = m.photoHeightIn;
  return typeof h === "number" && Number.isFinite(h) && h > 0 ? Math.min(h, PHOTO_HEIGHT_MAX) : 0;
}
/**
 * The module with its picture height set: a positive height (clamped to PHOTO_HEIGHT_MAX) is
 * written; 0 or less removes the key, so the saved JSON never carries 0 or undefined for "natural".
 */
export function withPhotoHeight<T extends PhotoHeightModule>(m: T, heightIn: number): T {
  const { photoHeightIn: _old, ...rest } = m;
  const h = Number.isFinite(heightIn) ? Math.min(Math.max(heightIn, 0), PHOTO_HEIGHT_MAX) : 0;
  return (h > 0 ? { ...rest, photoHeightIn: h } : rest) as T;
}

const align = z.enum(["left", "center", "right"]);
export const moduleSchema: z.ZodType<DocModule, z.ZodTypeDef, unknown> = z.discriminatedUnion(
  "type",
  [
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
      photoHeightIn: photoHeightSchema,
    }),
    z.object({
      id: z.string(),
      type: z.literal("twoPhotos"),
      images: z.tuple([imageRefSchema.nullable(), imageRefSchema.nullable()]),
      captions: z.tuple([z.string(), z.string()]),
      photoHeightIn: photoHeightSchema,
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
      type: z.literal("photoGrid"),
      images: z.array(z.object({ image: imageRefSchema, caption: z.string() })).max(60),
      columns: z.union([z.literal(2), z.literal(3)]),
      photoHeightIn: photoHeightSchema,
    }),
    z.object({
      id: z.string(),
      type: z.literal("repairList"),
      rows: z.array(z.array(z.string())).nullable(),
      photos: z.boolean(),
      allItems: z.boolean(),
      photoHeightIn: photoHeightSchema,
    }),
    z.object({
      id: z.string(),
      type: z.literal("repairItem"),
      itemId: z.string(),
      label: z.string().nullable(),
      note: z.string().nullable(),
      photoHeightIn: photoHeightSchema,
      spaceBelowIn: z.number().min(0).max(REPAIR_ITEM_SPACE_MAX_IN).optional(),
    }),
    z.object({
      id: z.string(),
      type: z.literal("pdf"),
      assetId: z.string().uuid(),
      name: z.string(),
      pageCount: z.number().int().positive(),
    }),
  ],
);

// ----------------------------------------------------------------------------------- pages

export interface DocPage {
  id: string;
  modules: DocModule[];
}
export const pageSchema: z.ZodType<DocPage, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  modules: z.array(moduleSchema),
});
export const pagesSchema = z.array(pageSchema).max(60);

/** The generate-time checkboxes; a template stores its defaults, a document what it was made with. */
export interface DocOptions {
  /** With or without cost. */
  prices: PriceMode;
  /** Show every picture in the document; off hides them on the canvas and in the PDF, removing nothing. */
  photos: boolean;
  /** Draw the marks on pictures — a ticket photo's and those drawn on an upload; off hides, never deletes. */
  marks: boolean;
  /** Page numbers and the company line at the foot of every page. */
  footer: boolean;
  /** The dotted page-break guide, inches from the top (CenterPoint: 8.8, range 5–10.5). */
  pageBreakIn: number;
  /**
   * Every Checklist item starts a new page (owner, Oct 28: "one for each page" as a toggle; the
   * default is the items split with a gap between them). Documents saved before it read as off.
   */
  itemPerPage: boolean;
}
export const DEFAULT_OPTIONS: DocOptions = {
  prices: "total",
  photos: true,
  marks: true,
  footer: true,
  pageBreakIn: 8.8,
  itemPerPage: false,
};
export const optionsSchema: z.ZodType<DocOptions, z.ZodTypeDef, unknown> = z.object({
  prices: z.enum(["total", "none"]),
  photos: z.boolean(),
  marks: z.boolean(),
  footer: z.boolean(),
  pageBreakIn: z.number().min(5).max(10.5),
  itemPerPage: z.boolean().default(false),
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
    case "photoGrid":
      return { id, type, images: [], columns: 2 };
    case "repairList":
      return { id, type, rows: null, photos: true, allItems: false };
    case "repairItem":
      // The item is picked in the module's settings (a blank id shows "Pick a checklist item").
      return { id, type, itemId: "", label: null, note: null };
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
 * A new document's pages from a template's pages and the checkboxes: every pricing table takes
 * the price mode; fresh ids throughout. Photos and Marks are VIEW switches (owner, Oct 28:
 * "Photos" looked dead on an existing document, and "Marks on photos" off deleted the marks drawn
 * on an upload for good): they hide pictures and marks on the canvas and in the PDF and never
 * remove a module, a picture or a mark — a document made with Photos off keeps its photo modules,
 * hidden until the box is ticked again.
 */
export function instantiatePages(
  templatePages: readonly DocPage[],
  options: DocOptions,
): DocPage[] {
  return applyOptionsToPages(clonePages(templatePages), options);
}

/**
 * Whether a picture's marks draw — the canvas (editor-helpers imageMarks) and the PDF
 * (document-pdf.server imageRefs) agree: the Marks checkbox must be on, and the picture must have
 * some — an upload's own, or a ticket photo picked "With marks". The checkbox never changes the
 * refs (stripMarks used to drop an upload's marks when it was off; Oct 28, gone).
 */
export function marksShown(img: ImageRef | null | undefined, marksOption: boolean): boolean {
  if (!img || !marksOption) return false;
  if (img.kind === "ticketPhoto") return img.marks;
  if (img.kind === "upload") return (img.marks?.length ?? 0) > 0;
  return false;
}

/**
 * The option switches applied to one module (also run when a switch is flipped after generating):
 * only the Pricing Table carries an option in its data (the price mode). Photos and Marks are read
 * where the module is drawn (pdf-layout.ts LayoutContext.photos, marksShown, the editor's
 * env.options), so flipping them changes no module and nothing is ever lost — the Repair List's
 * own "Show pictures" switch stays what the office set it to.
 */
export function applyOptionsToModule(m: DocModule, options: DocOptions): DocModule {
  switch (m.type) {
    case "pricingTable":
      return m.mode === options.prices ? m : { ...m, mode: options.prices };
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
      if (m.type === "repairList" && m.rows) m.rows.forEach((r) => r.forEach(cell));
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
