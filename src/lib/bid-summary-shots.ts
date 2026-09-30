/**
 * Bid summary (PDF export), screenshot edition: each estimator step is captured as a picture of
 * exactly what is on screen (capturePanel, html-to-image) and laid out one step per US-Letter
 * LANDSCAPE page (renderShotsPdf, pdf-lib) behind a small cover page. A panel is scaled to fit
 * its page whole, width and height, never cut across pages (owner, Sep 30: "one screenshot per
 * page rather than cutting some into two pages").
 *
 * Browser-only helpers, no React. html-to-image and pdf-lib are imported dynamically so the
 * estimator bundle only pays for them when someone actually exports (type imports are erased).
 */

import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";

import { clean } from "@/lib/bid-summary-pdf";

export interface PanelShot {
  /** PNG bytes. */
  png: Uint8Array;
  /** Size of the captured element in CSS pixels (the PNG itself is pixelRatio times larger). */
  width: number;
  height: number;
}

export interface ShotsPdfInput {
  /** Bid name. */
  title: string;
  /** Customer / job / status line under the bid name. */
  subtitle: string;
  /** Formatted bid total, e.g. "$12,345.67". */
  grandTotal: string;
  /** Formatted export date. */
  exportedAt: string;
  steps: { label: string; shot: PanelShot | null; note?: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture
// ─────────────────────────────────────────────────────────────────────────────

/** Canvas limits that hold in every mainstream browser (Safari caps the area at ~16.7 MP). */
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 16_000_000;

/** Decode a base64 data URL to bytes. */
function dataUrlBytes(url: string): Uint8Array {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) throw new Error("the capture returned no image data");
  const bin = atob(url.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Next animation frame, or 100 ms when frames are paused (background tab) so we never hang. */
const frame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 100);
  });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True while the panel still shows a loading state (spinner marker or "Loading…" text). */
function isLoading(el: HTMLElement): boolean {
  if (el.querySelector('[data-loading], [aria-busy="true"]')) return true;
  // innerText only reports rendered text, so hidden sub-panels do not count.
  return /Loading(…|\.\.\.)/.test(el.innerText);
}

/**
 * Wait for the element matching `selector` to be displayed, laid out and painted, then for any
 * loading state inside it to clear (up to `loadingMs`; after that it is captured as it stands).
 */
export async function waitForPanel(selector: string, loadingMs = 3000): Promise<HTMLElement> {
  const shownBy = Date.now() + 3000;
  let el: HTMLElement | null = null;
  for (;;) {
    el = document.querySelector<HTMLElement>(selector);
    if (el && el.getClientRects().length > 0) break;
    if (Date.now() > shownBy)
      throw new Error(el ? "the step panel never became visible" : "the step panel was not found");
    await frame();
  }
  await frame();
  await frame();
  await sleep(150);
  const loadedBy = Date.now() + loadingMs;
  while (isLoading(el) && Date.now() < loadedBy) await sleep(100);
  return el;
}

/**
 * Screenshot one on-screen element as a PNG (white background, 2x pixel ratio, lowered only when
 * the element is so large the browser could not allocate the canvas).
 */
export async function capturePanel(
  el: HTMLElement,
  opts: { pixelRatio?: number } = {},
): Promise<PanelShot> {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (!width || !height) throw new Error("the panel is not visible (zero size)");
  const pixelRatio = Math.min(
    opts.pixelRatio ?? 2,
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
    Math.sqrt(MAX_CANVAS_AREA / (width * height)),
  );
  const { toPng } = await import("html-to-image");
  let url: string;
  try {
    url = await toPng(el, {
      pixelRatio,
      backgroundColor: "#ffffff",
      cacheBust: true,
      width,
      height,
      // Frames cannot be cloned into the picture; leave them out rather than fail the capture.
      filter: (node) => !(node instanceof HTMLIFrameElement),
    });
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : e instanceof Event ? `${e.type} event` : String(e ?? "");
    throw new Error(`Screenshot failed: ${msg || "unknown error"}`);
  }
  return { png: dataUrlBytes(url), width, height };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────────────

// US Letter landscape, points.
const PAGE_W = 792;
const PAGE_H = 612;
const MARGIN = 36;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const HEADER_TEXT_Y = PAGE_H - MARGIN - 9;
const HEADER_RULE_Y = PAGE_H - MARGIN - 14;
/** The screenshot area: between the header rule and the footer rule. */
const AREA_TOP = HEADER_RULE_Y - 8;
const FOOTER_RULE_Y = MARGIN + 12;
const AREA_BOTTOM = FOOTER_RULE_Y + 8;
const AREA_H = AREA_TOP - AREA_BOTTOM;

type Rgb = readonly [number, number, number];
const INK: Rgb = [0.12, 0.12, 0.14];
const MUTED: Rgb = [0.42, 0.42, 0.46];
const RULE: Rgb = [0.72, 0.72, 0.75];
const FRAME: Rgb = [0.85, 0.85, 0.88];
const ACCENT: Rgb = [0.1, 0.27, 0.5];

/**
 * How a picture of `w`×`h` CSS px is placed: scaled to fit the page's picture area on both axes
 * (never enlarged past the page width), so every step is one whole page. `pages` is always 1
 * and stays for callers that count pages.
 */
export function shotLayout(w: number, h: number): { width: number; height: number; pages: number } {
  const scale = Math.min(CONTENT_W / w, AREA_H / h);
  return { width: w * scale, height: h * scale, pages: 1 };
}

/** Render the screenshot bid summary: a cover page, then one page run per step. */
export async function renderShotsPdf(input: ShotsPdfInput): Promise<Uint8Array> {
  const pdfLib = await import("pdf-lib");
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const color = (c: Rgb) => rgb(c[0], c[1], c[2]);

  const title = clean(input.title.trim() || "Untitled bid");
  pdf.setTitle(`${title} — Bid summary`);
  pdf.setSubject(`Bid summary for ${title}`);
  pdf.setCreator("JBK Portal");
  pdf.setProducer("JBK Portal");

  const text = (
    page: PDFPage,
    s: string,
    x: number,
    y: number,
    size: number,
    o: { bold?: boolean; color?: Rgb } = {},
  ) => {
    if (s)
      page.drawText(s, { x, y, size, font: o.bold ? bold : font, color: color(o.color ?? INK) });
  };
  const rule = (page: PDFPage, y: number, t = 0.5) =>
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: t,
      color: color(RULE),
    });
  const fit = (f: PDFFont, s: string, size: number, w: number): string => {
    if (f.widthOfTextAtSize(s, size) <= w) return s;
    let t = s;
    while (t && f.widthOfTextAtSize(t + "…", size) > w) t = t.slice(0, -1);
    return t ? t.trimEnd() + "…" : "";
  };
  const wrap = (f: PDFFont, s: string, size: number, w: number): string[] => {
    const out: string[] = [];
    for (const para of s.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) <= w) line = next;
        else {
          if (line) out.push(line);
          line = fit(f, word, size, w);
        }
      }
      out.push(line);
    }
    return out;
  };

  /** A step page with its header ("N. Label" left, bid name right). */
  const stepPage = (heading: string): PDFPage => {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const right = fit(font, title, 9, CONTENT_W / 2 - 12);
    const left = fit(bold, heading, 11, CONTENT_W - font.widthOfTextAtSize(right, 9) - 24);
    text(page, left, MARGIN, HEADER_TEXT_Y, 11, { bold: true, color: ACCENT });
    text(page, right, PAGE_W - MARGIN - font.widthOfTextAtSize(right, 9), HEADER_TEXT_Y, 9, {
      color: MUTED,
    });
    rule(page, HEADER_RULE_Y, 0.75);
    return page;
  };

  // ── Cover ──
  const cover = pdf.addPage([PAGE_W, PAGE_H]);
  text(cover, "JBK Portal — Bid summary", MARGIN, HEADER_TEXT_Y, 9, { bold: true, color: ACCENT });
  rule(cover, HEADER_RULE_Y, 0.75);
  let y = HEADER_RULE_Y - 56;
  for (const line of wrap(bold, title, 26, CONTENT_W).slice(0, 3)) {
    text(cover, line, MARGIN, y, 26, { bold: true });
    y -= 32;
  }
  for (const line of wrap(font, clean(input.subtitle), 13, CONTENT_W).slice(0, 3)) {
    text(cover, line, MARGIN, y, 13, { color: MUTED });
    y -= 18;
  }
  y -= 18;
  const facts: [string, string][] = [
    ["Bid total", clean(input.grandTotal)],
    ["Exported", clean(input.exportedAt)],
  ];
  for (const [label, value] of facts) {
    text(cover, label, MARGIN, y, 11, { bold: true, color: MUTED });
    text(cover, value, MARGIN + 110, y, label === "Bid total" ? 16 : 12, {
      bold: label === "Bid total",
    });
    y -= 24;
  }
  y -= 14;
  text(cover, "Steps in this summary", MARGIN, y, 12, { bold: true });
  y -= 20;
  const tocSlots: number[] = [];
  input.steps.forEach((s, i) => {
    text(cover, clean(`${i + 1}.  ${s.label}`), MARGIN + 8, y, 10);
    tocSlots.push(y);
    y -= 15;
  });

  // ── One step per page (continued onto more pages when the picture is tall) ──
  const firstPage: number[] = [];
  const images = new Map<Uint8Array, PDFImage>();
  for (const [i, s] of input.steps.entries()) {
    const heading = clean(`${i + 1}. ${s.label}`);
    firstPage.push(pdf.getPageCount() + 1);
    const shot = s.shot;
    if (!shot || !(shot.width > 0) || !(shot.height > 0)) {
      const page = stepPage(heading);
      let ny = AREA_TOP - 30;
      text(page, "This step could not be captured.", MARGIN, ny, 14, { bold: true });
      ny -= 22;
      for (const line of wrap(font, clean(s.note || "No picture was taken."), 11, CONTENT_W)) {
        text(page, line, MARGIN, ny, 11, { color: MUTED });
        ny -= 15;
      }
      continue;
    }
    let image = images.get(shot.png);
    if (!image) {
      image = await pdf.embedPng(shot.png);
      images.set(shot.png, image);
    }
    const lay = shotLayout(shot.width, shot.height);
    // Whole picture on one page, centred left to right, hung from the top of the area.
    const x = MARGIN + (CONTENT_W - lay.width) / 2;
    const page = stepPage(heading);
    page.drawImage(image, { x, y: AREA_TOP - lay.height, width: lay.width, height: lay.height });
    page.drawRectangle({
      x,
      y: AREA_TOP - lay.height,
      width: lay.width,
      height: lay.height,
      borderColor: color(FRAME),
      borderWidth: 0.5,
    });
  }

  tocSlots.forEach((slotY, i) => {
    const label = `page ${firstPage[i]}`;
    text(cover, label, MARGIN + 260 - font.widthOfTextAtSize(label, 10), slotY, 10, {
      color: MUTED,
    });
  });

  // ── Footers, now that the page count is known ──
  const pages = pdf.getPages();
  const tail = clean(` · exported ${input.exportedAt} · Bid total ${input.grandTotal}`);
  pages.forEach((page, i) => {
    rule(page, FOOTER_RULE_Y);
    const s = fit(font, `Page ${i + 1} of ${pages.length}${tail}`, 8, CONTENT_W);
    text(page, s, MARGIN, MARGIN, 8, { color: MUTED });
  });

  return pdf.save();
}
