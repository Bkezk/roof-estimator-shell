/**
 * Pure helpers for the Documents editor (routes/documents.tsx, components/documents/*): the
 * route's search params, the Variables tab's filter and grouping, the chip text a variable
 * prints, the pricing table's source rebuilt from a document's variable snapshot, the saved
 * module names a page carries, the sheet's screen geometry and the small text formats. No React,
 * no server: every rule here is tested in editor-helpers.test.ts.
 */
import type { PhotoMark, Rotation } from "@/lib/photo-annotations";

import {
  type DocKind,
  type DocModule,
  type DocPage,
  defaultDocumentTitle,
  type ImageRef,
  marksShown,
  VARIABLE_NODE,
} from "./model";
import {
  type DocumentSource,
  type InspectionSnapshot,
  type VariableDef,
  VARIABLE_GROUPS,
  type VariableGroup,
  variableLabel,
} from "./variables";

// ----------------------------------------------------------------------------- the route

export interface DocumentSearch {
  /** ?id=<document uuid>: edit that document. */
  id?: string;
  /** ?template=<template uuid> | "new": edit a template's pages with sample variables. */
  template?: string;
  /** With template=new: the kind the new template is for (default bid). */
  kind?: DocKind;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /documents search params; anything malformed is dropped. */
export function documentSearch(s: Record<string, unknown>): DocumentSearch {
  const id = s["id"];
  const template = s["template"];
  const kind = s["kind"];
  return {
    ...(typeof id === "string" && UUID.test(id) ? { id } : {}),
    ...(typeof template === "string" && (template === "new" || UUID.test(template))
      ? { template }
      : {}),
    ...(kind === "bid" || kind === "ticket" ? { kind } : {}),
  };
}

// -------------------------------------------------------------------------- the variables

/** The Variables tab filter and the slash command: label or key contains the query (any case). */
export function filterVariables(query: string, defs: readonly VariableDef[]): VariableDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...defs];
  const words = q.split(/\s+/);
  return defs.filter((d) => {
    const hay = `${d.label} ${d.key} ${d.group}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The defs in VARIABLE_GROUPS order, empty groups left out. */
export function groupVariables(
  defs: readonly VariableDef[],
): Array<{ group: VariableGroup; defs: VariableDef[] }> {
  return VARIABLE_GROUPS.map((group) => ({
    group,
    defs: defs.filter((d) => d.group === group),
  })).filter((g) => g.defs.length > 0);
}

/** What a variable chip prints: the value, or the label in brackets when the record has none. */
export function chipText(key: string, vars: Record<string, string>): string {
  const v = vars[key];
  return v ? v : `[${variableLabel(key)}]`;
}

/** The value column on the Variables tab: a blank shows "—". */
export const variableRowValue = (v: string | undefined): string => (v ? v : "—");

/** The ProseMirror JSON a variable chip is inserted as (editor.insertContent). */
export const variableNodeJson = (key: string) => ({ type: VARIABLE_NODE, attrs: { key } });

// ------------------------------------------------------------------------ the pricing table

/** The reserved variable key the server stores the bid's sections under (JSON). */
export const SECTIONS_VARIABLE = "__sections";

export type PricingSection = { name: string; lengthFt: number; widthFt: number; system: string };

/** "$242,879.61" → 242879.61; "" or junk → null. */
export function parseMoney(text: string | undefined | null): number | null {
  if (!text) return null;
  const neg = /^\s*[-(]/.test(text);
  const n = Number(text.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || text.replace(/[^0-9]/g, "") === "") return null;
  return neg ? -n : n;
}

/** The sections JSON under __sections, parsed defensively (bad rows dropped). */
export function parseSections(json: string | undefined | null): PricingSection[] {
  if (!json) return [];
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r): PricingSection[] => {
      if (!r || typeof r !== "object") return [];
      const o = r as Record<string, unknown>;
      const lengthFt = Number(o["lengthFt"]);
      const widthFt = Number(o["widthFt"]);
      if (!Number.isFinite(lengthFt) || !Number.isFinite(widthFt)) return [];
      return [
        {
          name: String(o["name"] ?? ""),
          lengthFt,
          widthFt,
          system: String(o["system"] ?? ""),
        },
      ];
    });
  } catch {
    return [];
  }
}

/** The sections the template editor shows in a pricing table (sampleVariables has none). */
export const SAMPLE_SECTIONS: PricingSection[] = [
  { name: "Main roof", lengthFt: 250, widthFt: 150, system: "Duro-Last 60 mil" },
  { name: "Mechanical penthouse", lengthFt: 60, widthFt: 40, system: "Duro-Last 60 mil" },
];

/**
 * A DocumentSource-like `{ bid }` for pricingRows, from a document's variable snapshot: the
 * sections under __sections and the total from the Total Price text. `sample` (template mode)
 * supplies SAMPLE_SECTIONS when the snapshot has none.
 */
export function pricingSourceFromVariables(
  vars: Record<string, string>,
  sample = false,
): Pick<DocumentSource, "bid"> {
  const parsed = parseSections(vars[SECTIONS_VARIABLE]);
  const sections = parsed.length || !sample ? parsed : SAMPLE_SECTIONS;
  return {
    bid: {
      name: vars["opportunity.name"] ?? "",
      total: parseMoney(vars["opportunity.price"]),
      system: vars["opportunity.product"] ?? "",
      dueDate: null,
      sections,
      sqFt: null,
      warranty: vars["opportunity.warranty"] ?? "",
    },
  };
}

// ------------------------------------------------------------------------------ the pictures

/**
 * The marks a picture draws on the canvas (phase 2): an upload's own (drawn in the editor), a
 * ticket photo's when its ref says so (the ticket row's, as getDocument read them); none for the
 * logo or the property photo — and none at all while the document's Marks checkbox is off
 * (`marksOn`; Oct 28: the box hides marks, it no longer deletes them).
 */
export function imageMarks(
  image: ImageRef,
  photos: ReadonlyArray<{ id: string; marks: PhotoMark[] }>,
  marksOn = true,
): PhotoMark[] {
  if (!marksShown(image, marksOn)) return [];
  if (image.kind === "upload") return image.marks ?? [];
  if (image.kind === "ticketPhoto") return photos.find((p) => p.id === image.photoId)?.marks ?? [];
  return [];
}

/**
 * How a picture is shown turned: a ticket photo the way the ticket keeps it (whether or not its
 * marks draw — a sideways photo is sideways with or without them); every other picture 0.
 */
export function imageRotation(
  image: ImageRef,
  photos: ReadonlyArray<{ id: string; rotation: Rotation }>,
): Rotation {
  if (image.kind === "ticketPhoto")
    return photos.find((p) => p.id === image.photoId)?.rotation ?? 0;
  return 0;
}

/** Can this picture be marked up? An upload or a ticket photo; not the logo or the property photo. */
export const canMarkUp = (image: ImageRef | null): boolean =>
  !!image && (image.kind === "upload" || image.kind === "ticketPhoto");

// ---------------------------------------------------------------------------- the photo grid

/**
 * The caption "Add all ticket photos" gives a picture (phase 2): the checklist item(s) it is on,
 * by their keys in the document's inspection snapshot ("Seams, Perimeter flashings" for a photo
 * on two items, Oct 28; `itemKeys` when the photo carries it, else its one `itemKey`), else
 * blank — the camera's own file name (IMG_1234.jpg) says nothing a customer should read.
 */
export function photoGridCaption(
  photo: { itemKey?: string | null | undefined; itemKeys?: readonly string[] | undefined },
  insp: InspectionSnapshot | null | undefined,
): string {
  if (!insp) return "";
  const keys = photo.itemKeys ?? (photo.itemKey ? [photo.itemKey] : []);
  return insp.items
    .filter((i) => keys.includes(i.id))
    .map((i) => i.label)
    .join(", ");
}

// ------------------------------------------------------------------------- saved modules

/** A module's content without its id (two modules with the same fingerprint are the same thing). */
export function moduleFingerprint(m: DocModule): string {
  const { id: _id, ...rest } = m;
  return JSON.stringify(rest);
}

/** The names of the saved modules a page contains (the chips under a Pages row), once each. */
export function savedModuleNamesOnPage(
  page: DocPage,
  saved: ReadonlyArray<{ name: string; module: DocModule }>,
): string[] {
  if (!saved.length) return [];
  const byPrint = new Map<string, string>();
  for (const s of saved) byPrint.set(moduleFingerprint(s.module), s.name);
  const out: string[] = [];
  for (const m of page.modules) {
    const name = byPrint.get(moduleFingerprint(m));
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// -------------------------------------------------------------------------------- the sheet

/** US Letter on screen at 96 dpi: 8.5 × 11 in, 0.75 in padding (PAGE.marginPt = 54 pt). */
export const IN_PX = 96;
export const SHEET = { width: 816, height: 1056, pad: 72 } as const;

/** The DOM id of a page's sheet (the Pages list scrolls to it). */
export const pageDomId = (pageId: string) => `doc-page-${pageId}`;

/** The drag type a Modules tab tile carries onto a sheet (its data: the module type). */
export const MODULE_DRAG_TYPE = "application/x-jbk-document-module";
/** The drag type a saved snippet row carries onto a sheet (its data: the snippet's id). */
export const SNIPPET_DRAG_TYPE = "application/x-jbk-document-snippet";

/** The sidebar's logo file (app-sidebar.tsx), drawn by the letterhead and the "Company logo" pick. */
export const LOGO_SRC = "/jbk-logo.webp";

/** The page-break guide's offset from the sheet's top, in px, or null when the footer is off. */
export function pageBreakPx(options: { footer: boolean; pageBreakIn: number }): number | null {
  if (!options.footer) return null;
  return Math.round(clampPageBreak(options.pageBreakIn) * IN_PX);
}

export const PAGE_BREAK_MIN = 5;
export const PAGE_BREAK_MAX = 10.5;
export const PAGE_BREAK_DEFAULT = 8.8;
export const PAGE_BREAK_HINT = "Dotted page-breaker when Footer is on (default 8.8). Range 5–10.5.";

/**
 * The Options checkboxes' tooltips (owner, Oct 28: the labels stay CenterPoint's; a short title
 * on each says what the box does). The editor's Document tab and the New document dialog share them.
 */
export const OPTION_HINTS = {
  prices: "With prices: pricing tables show their figures",
  photos: "Show or hide every picture in this document",
  marks: "Show or hide the circles, arrows and text drawn on pictures",
  footer: "Footer: the footer and the dotted page-break line",
  itemPerPage: "One checklist item per page: every Checklist item starts a new page",
} as const;
/** A Checklist item whose item is gone from the inspection snapshot (the PDF prints nothing for it). */
export const ITEM_GONE_HINT = "This item is no longer on the inspection";
/** A Checklist item added from the tile before an item is picked in its settings. */
export const PICK_ITEM_HINT = "Pick a checklist item in the settings above";
/** The Mark up pencil's tooltip while the document's Marks checkbox is off (the pencil is disabled). */
export const MARKS_OFF_HINT = "Marks are off for this document";
/** What a hidden picture module says on the canvas while Photos is off (never printed). */
export const PHOTOS_OFF_HINT = "Pictures are hidden — Photos is off for this document";
/**
 * The Repair List on a document whose variables hold no inspection snapshot (owner, Oct 28): a
 * plain line in the editor saying what to do; the PDF prints nothing for the module.
 */
export const NO_INSPECTION_HINT =
  "No inspection findings were on the ticket when this document was made. Click Refresh data on the Variables tab to pull them in.";

export const clampPageBreak = (n: number): number =>
  Number.isFinite(n) ? Math.min(PAGE_BREAK_MAX, Math.max(PAGE_BREAK_MIN, n)) : PAGE_BREAK_DEFAULT;

/** The typed page-break box: blank keeps the default; out of range is clamped. */
export function parsePageBreak(text: string): number {
  const t = text.trim();
  if (!t) return PAGE_BREAK_DEFAULT;
  const n = Number(t);
  return clampPageBreak(n);
}

/** How far the sheet shrinks to fit a canvas of `available` px (never grows past 1:1). */
export function sheetScale(available: number, gutter = 32): number {
  if (!Number.isFinite(available) || available <= 0) return 1;
  return Math.min(1, Math.max(0.3, (available - gutter) / SHEET.width));
}

/**
 * The content height a screen sheet offers, in px: up to the page break with the footer on
 * (owner, Oct 26: "the page breaks should start a new page to see what it looks like rather than
 * have it continue the page"), else the full padded sheet. The PDF breaks at the same place
 * (pdf-layout.ts contentHeightFor).
 */
export function sheetContentLimit(options: { footer: boolean; pageBreakIn: number }): number {
  const guide = pageBreakPx(options);
  return (guide ?? SHEET.height - SHEET.pad) - SHEET.pad;
}

/**
 * Pack modules into sheets by their measured heights: a module that does not fit the room left
 * starts the next sheet. One TALLER than a whole sheet can never fit anywhere, so it stays on
 * the sheet it is on, right after what is already there, overflowing the sheet on screen — the
 * PDF flows such a module (a Repair List's rows, a long letter) from that very spot — and what
 * follows starts the next sheet (owner, Oct 28: the Findings heading sat alone on an empty page
 * 2 with the whole Repair List pushed to "Page 2 · continued"). An unmeasured module (no height
 * yet) counts as 0 so the first paint is one sheet. A module flagged `breakBefore` (a Checklist
 * item with "One checklist item per page" on) starts a new sheet unless it is first on its
 * sheet, as the PDF's pageBreak piece does. Pure, so it is tested.
 */
export function packIntoSheets(
  items: ReadonlyArray<{ id: string; height: number | undefined; breakBefore?: boolean }>,
  limit: number,
  gap: number,
): string[][] {
  const sheets: string[][] = [];
  let cur: string[] = [];
  let used = 0;
  for (const it of items) {
    const h = it.height ?? 0;
    const need = (cur.length ? gap : 0) + h;
    const giant = h > limit;
    if (cur.length && (it.breakBefore || (used + need > limit && !giant))) {
      sheets.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(it.id);
    used += (cur.length > 1 ? gap : 0) + h;
    if (giant) {
      sheets.push(cur);
      cur = [];
      used = 0;
    }
  }
  if (cur.length || !sheets.length) sheets.push(cur);
  return sheets;
}

export const continuedTabLabel = (index: number, part: number) =>
  part === 0 ? pageTabLabel(index) : `${pageTabLabel(index)} · continued`;

export const pageTabLabel = (index: number) => `Page ${index + 1}`;

// -------------------------------------------------------------------------------- text bits

/** The office's clock (every user is Eastern). */
export const DOC_OFFICE_TZ = "America/New_York";

/** "Oct 26, 10:19 AM" in the office's zone. */
export function stampText(iso: string | null | undefined, tz: string = DOC_OFFICE_TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return `${day}, ${time}`;
}

/** "v3 · Oct 26, 10:19 AM by Brian" (the list rows and the Revisions sheet). */
export function versionLine(
  row: { version: number; updated_at: string; updated_by_name: string | null },
  tz?: string,
): string {
  const by = row.updated_by_name ? ` by ${row.updated_by_name}` : "";
  return `v${row.version} · ${stampText(row.updated_at, tz)}${by}`;
}

/** A new document's title: the template's name — the record, or "Document — <record>" for Blank. */
export function newDocumentTitle(
  templateName: string | null | undefined,
  record: { kind: DocKind; label: string },
): string {
  return defaultDocumentTitle(templateName?.trim() || "Document", record);
}

/** The Email dialog's defaults: every contact with an email, the title as subject, a short note. */
export function emailDefaults(
  title: string,
  contacts: ReadonlyArray<{ name: string; email: string }>,
): { to: string; subject: string; text: string } {
  const to = contacts
    .map((c) => c.email.trim())
    .filter((e) => e.includes("@"))
    .filter((e, i, all) => all.indexOf(e) === i)
    .join(", ");
  return {
    to,
    subject: `${title} — JBK, Inc.`,
    text: `Please find ${title} attached. Reply to this email with any questions.\n\nJBK, Inc.`,
  };
}

/** The template-mode Back target and the document-mode fallback. */
export const TEMPLATES_ADMIN_PATH = "/admin/documents";

/** A backTo `{ to, search }` as one href (router.navigate({ href })). */
export function backHref(back: { to: string; search: Record<string, string> } | null | undefined) {
  if (!back) return "/";
  const qs = new URLSearchParams(back.search).toString();
  return qs ? `${back.to}?${qs}` : back.to;
}

/** The base64 body of a data: URL (FileReader.readAsDataURL). */
export function dataUrlBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

/** The ⋮ menu's "Page N" row label for a page of N modules: "1 Page" style count text. */
export function pageRowText(index: number, moduleCount: number): string {
  return `${index + 1} Page · ${moduleCount} module${moduleCount === 1 ? "" : "s"}`;
}
