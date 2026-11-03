/**
 * Name the sheets (owner, Nov 3: pages in a plan set were "Page 1, Page 2…"; a 60-sheet set
 * meant clicking through to find the roof plan). The sheet number ("A2.1", "A-201", "S1.0")
 * and the drawing title ("ROOF PLAN") are read off the page's text, the same text the scale
 * note is read from (./sheet-scale), and a sheet whose title is a roof plan is flagged. Pure:
 * the loader in ./underlay hands in the page's text items and its size.
 *
 * Title blocks sit along the right edge or the bottom of a sheet. The sheet number is the
 * largest standalone number-shaped item, nearer the bottom-right corner when sizes tie; the
 * title is the largest line of capitals in the title block that names a drawing (PLAN,
 * ELEVATION, SECTION, DETAILS, SCHEDULE, NOTES, INDEX, LEGEND, COVER, SITE, SPECIFICATIONS,
 * ROOF…), excluding the sheet number itself and the words round it ("SHEET", "DRAWN BY").
 */
import type { TextItemLike } from "./sheet-scale";

export interface SheetTitle {
  /** "A2.1", "A-201", "S1.0"; null when none reads as one. */
  number: string | null;
  /** "Roof Plan" (title case); null when none reads as one. */
  title: string | null;
  /** The title names a roof plan (not a roof framing plan, which is the structure). */
  roofPlan: boolean;
}

/** A page still carrying the name the upload gave it ("Page 7"): renamed; anything else kept. */
export const DEFAULT_PAGE_NAME = /^Page \d+$/;

/** The page name for a read: "A2.1 Roof Plan", "A2.1", "Roof Plan", or null to keep the old. */
export function sheetPageName(t: SheetTitle): string | null {
  const name = [t.number, t.title].filter(Boolean).join(" ").trim();
  return name ? name.slice(0, 60) : null;
}

/** "A2.1", "A-201", "A101", "S1.0", "RP-1", "M2.01", "A2.1A". */
const SHEET_NUMBER = /^[A-Z]{1,3}-?\d{1,3}(?:[.-]\d{1,2})?[A-Z]?$/;
/** Words that mean a line is a drawing title, not a note or a company name. */
const TITLE_WORDS =
  /\b(PLAN|PLANS|ELEVATION|ELEVATIONS|SECTION|SECTIONS|DETAIL|DETAILS|SCHEDULE|SCHEDULES|NOTES|INDEX|LEGEND|COVER|SITE|SPECIFICATIONS|ROOF|ROOFING|FRAMING|DIAGRAM|LAYOUT)\b/;
/** Lines that are labels round the number, never the title ("COVER SHEET" is a title). */
const LABEL_WORDS =
  /\b(DRAWN|CHECKED|APPROVED|DATE|SCALE|PROJECT|JOB|REV|REVISION|TITLE|NO\.?|NUMBER|OF)\b|\bSHEET\s+(?:NO\.?|NUMBER|TITLE|NAME)\b/;
/** The label a title block puts above the title: the line under it is the title. */
const TITLE_LABEL = /^(?:SHEET|DRAWING|DWG\.?)?\s*TITLE:?$/;

interface Line {
  text: string;
  x: number;
  y: number;
  h: number;
}

/** Group text items into lines (same baseline, left to right), with the largest glyph height. */
export function textLines(items: readonly TextItemLike[]): Line[] {
  const rows: Array<Line & { items: Array<{ x: number; str: string; w: number }> }> = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.str.trim()) continue;
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    const h = Math.max(1, Math.abs(it.height ?? 0) || Math.abs(it.transform[3] ?? 0) || 10);
    const row = rows.find((r) => Math.abs(r.y - y) < Math.max(r.h, h) * 0.5);
    if (row) {
      row.items.push({ x, str: it.str, w: it.width ?? 0 });
      row.h = Math.max(row.h, h);
    } else rows.push({ text: "", x, y, h, items: [{ x, str: it.str, w: it.width ?? 0 }] });
  }
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let text = "";
    let prev: { x: number; w: number; str: string } | null = null;
    for (const it of r.items) {
      if (prev) text += it.x - (prev.x + prev.w) < r.h * 0.25 ? "" : " ";
      text += it.str;
      prev = it;
    }
    return { text: text.replace(/\s+/g, " ").trim(), x: r.items[0]!.x, y: r.y, h: r.h };
  });
}

const titleCase = (s: string): string =>
  s
    .toLowerCase()
    .replace(/(^|[\s/(-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(And|Of|The|For|At|To|In|On)\b/g, (w) => w.toLowerCase());

/**
 * The sheet number and title in a page's text. `width` / `height` are the page's size in the
 * same units as the items' positions (PDF user space, y up), so "bottom-right" can be told.
 */
export function pickSheetTitle(
  items: readonly TextItemLike[],
  width: number,
  height: number,
): SheetTitle {
  const lines = textLines(items);
  // The title block: the right 30% or the bottom 25% of the sheet.
  const inBlock = (l: Line) => l.x >= width * 0.7 || l.y <= height * 0.25;
  // The sheet number: the largest number-shaped line in the title block, bottom-right on ties.
  const numbers = lines.filter((l) => inBlock(l) && SHEET_NUMBER.test(l.text.toUpperCase()));
  numbers.sort((a, b) => b.h - a.h || b.x - a.x || a.y - b.y);
  const number = numbers[0] ?? null;
  // The title: the largest line of capitals naming a drawing, in the block, not a label.
  const titles = lines.filter(
    (l) =>
      inBlock(l) &&
      l !== number &&
      l.text.length >= 4 &&
      l.text.length <= 60 &&
      l.text === l.text.toUpperCase() &&
      /[A-Z]/.test(l.text) &&
      TITLE_WORDS.test(l.text) &&
      !LABEL_WORDS.test(l.text.replace(TITLE_WORDS, "")) &&
      !SHEET_NUMBER.test(l.text),
  );
  // Under a "SHEET TITLE" label the next line down is the title whatever its size (a project
  // name with PLAN in it would otherwise win); else the largest.
  const labels = lines.filter((l) => inBlock(l) && TITLE_LABEL.test(l.text.toUpperCase()));
  const labelled = (l: Line) =>
    labels.some(
      (lab) => l.y < lab.y && l.y > lab.y - lab.h * 6 && Math.abs(l.x - lab.x) < width * 0.1,
    );
  titles.sort(
    (a, b) => Number(labelled(b)) - Number(labelled(a)) || b.h - a.h || b.x - a.x || a.y - b.y,
  );
  const title = titles[0] ?? null;
  const upper = title?.text ?? "";
  return {
    number: number ? number.text.toUpperCase() : null,
    title: title ? titleCase(title.text) : null,
    roofPlan:
      /\bROOF(?:ING)?\b/.test(upper) && /\bPLAN\b/.test(upper) && !/\bFRAMING\b/.test(upper),
  };
}
