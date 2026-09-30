/**
 * Read the scale off the sheet (owner, Sep 30: "add this but make it known it's done that when
 * it sets the scale this way"). Pure (no React, no pdf.js import): the loader in ./underlay
 * hands in the page's text items.
 *
 * `findScaleNotes` looks for scale notes in a PDF page's text — `1/8" = 1'-0"`, `3/32"=1'`,
 * `1" = 20'-0"`, `SCALE: 1/4" = 1'-0"`, `1 IN = 30 FT` — and, only when the sheet also names
 * millimetres or metres, metric `1:100`. For `a" = b'` one paper inch is b / a feet, and a
 * paper inch is 72 page units, so feet per page unit = (b / a) / 72; for 1:N it is N / 864.
 * `pickSheetScale` sets the scale only when the sheet has exactly one distinct scale; with
 * several (a detail sheet, a sheet index) it offers them as choices instead.
 *
 * A scale set this way is a synthetic 72-unit (one paper inch) line near the note, tagged
 * `source: "sheet"` with the note text, so the viewer and the Scale dialog can say where it came
 * from; drawing a scale replaces it (`source: "drawn"`).
 */
import type { PageScale } from "@/lib/takeoff/model";

/** Page units per paper inch (pdf.js viewport at scale 1). */
export const UNITS_PER_INCH = 72;

/** A page scale with where it came from (older saved scales have no tag: drawn). */
export type TaggedScale = PageScale & { source?: "sheet" | "drawn"; note?: string };

/** One distinct scale note found on a sheet. */
export interface ScaleNote {
  /** Normalised text, e.g. `1/8" = 1'-0"` or `1:100`. */
  text: string;
  /** Real feet per paper inch (8 for 1/8" = 1'-0"). */
  feetPerInch: number;
  /** Feet per page unit. */
  fpp: number;
  /** Where the note starts, in PDF user space (text item origin), when known. */
  at: [number, number] | null;
}

/** A pdf.js text item, reduced to what the join needs. */
export interface TextItemLike {
  str: string;
  /** [a, b, c, d, e, f]: e / f is the item's origin in PDF user space. */
  transform: ArrayLike<number>;
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

/**
 * Join text items into one string, a space between separate words and a line break at line
 * ends, remembering where each item starts. Items pdf.js split mid-word (one per glyph) are
 * joined without a space when they touch on the same line.
 */
export function joinTextItems(items: readonly TextItemLike[]): {
  text: string;
  starts: Array<{ offset: number; at: [number, number] }>;
} {
  let text = "";
  const starts: Array<{ offset: number; at: [number, number] }> = [];
  let prev: TextItemLike | null = null;
  for (const it of items) {
    if (typeof it.str !== "string" || it.str === "") {
      if (it.hasEOL && prev) text += "\n";
      continue;
    }
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    if (prev) {
      if (prev.hasEOL) text += "\n";
      else {
        const px = (prev.transform[4] ?? 0) + (prev.width ?? 0);
        const py = prev.transform[5] ?? 0;
        const h = Math.max(1, it.height ?? prev.height ?? 10);
        const sameLine = Math.abs(y - py) < h * 0.5;
        const touching = sameLine && Math.abs(x - px) < h * 0.25;
        if (!touching) text += sameLine ? " " : "\n";
      }
    }
    starts.push({ offset: text.length, at: [x, y] });
    text += it.str;
    prev = it;
  }
  return { text, starts };
}

// A number: "1 1/2" (a mixed number only from 1, so a detail number just before a note is not
// read into it), "3/32", ".75", "1.5", "20".
const NUM = String.raw`(1\s+\d\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\.\d+|\d+)`;
const INCH = String.raw`(?:"|\s*IN(?:CH(?:ES)?)?\b\.?)`;
const FOOT = String.raw`(?:'|\s*F(?:EE|OO)?T\b\.?)`;
const IMPERIAL = new RegExp(
  String.raw`(?<![\d./])${NUM}\s*${INCH}\s*=\s*${NUM}\s*${FOOT}(?:\s*-\s*${NUM}\s*"?|\s*${NUM}\s*")?`,
  "gi",
);
const METRIC = /(?<![\d.:/])1\s*:\s*(\d{1,5})(?![\d:.])/g;
const METRIC_UNITS = /\b(?:mm|millimet(?:er|re)s?|met(?:er|re)s?)\b/i;
/** The metric scales a 1:N note is trusted for (not clock times or slopes). */
const METRIC_SCALES = new Set([
  5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000, 1250, 2000, 2500, 5000,
]);
/** Real feet per paper inch a note may give: 12" = 1'-0" (1/12) up to 1" = 2000'. */
const MIN_FEET_PER_INCH = 1 / 12 - 1e-9;
const MAX_FEET_PER_INCH = 2000;

/** "1 1/2" → 1.5, "3/32" → 0.09375, ".5" → 0.5; NaN when a denominator is 0. */
function num(s: string): number {
  const t = s.trim();
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? NaN : Number(frac[1]) / Number(frac[2]);
  return Number(t);
}
const tidy = (s: string) =>
  s
    .trim()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");

/** Every scale note in `text`, in order (the same scale may appear more than once). */
export function findScaleNotes(text: string): Array<Omit<ScaleNote, "at"> & { index: number }> {
  const out: Array<Omit<ScaleNote, "at"> & { index: number }> = [];
  // Typographic quotes and a doubled apostrophe for inches read like plain ones.
  const t = text.replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'").replace(/''/g, '"');
  for (const m of t.matchAll(IMPERIAL)) {
    const a = num(m[1]!);
    const ft = num(m[2]!);
    const inch = m[3] ?? m[4];
    const b = ft + (inch !== undefined ? num(inch) / 12 : 0);
    if (!(a > 0 && a <= 12 && b > 0)) continue;
    const feetPerInch = b / a;
    if (feetPerInch < MIN_FEET_PER_INCH || feetPerInch > MAX_FEET_PER_INCH) continue;
    const right = `${tidy(m[2]!)}'${inch !== undefined ? `-${tidy(inch)}"` : ""}`;
    out.push({
      text: `${tidy(m[1]!)}" = ${right}`,
      feetPerInch,
      fpp: feetPerInch / UNITS_PER_INCH,
      index: m.index,
    });
  }
  if (METRIC_UNITS.test(t)) {
    for (const m of t.matchAll(METRIC)) {
      const n = Number(m[1]);
      if (!METRIC_SCALES.has(n)) continue;
      // 1 paper inch = N real inches = N / 12 ft.
      out.push({
        text: `1:${n}`,
        feetPerInch: n / 12,
        fpp: n / 12 / UNITS_PER_INCH,
        index: m.index,
      });
    }
  }
  return out.sort((p, q) => p.index - q.index);
}

/** The same scale, however it was written (1/8" = 1'-0" and 1/8"=1' are one scale). */
const sameScale = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(a, b);

/**
 * The sheet's scale: `scale` when every note on it gives the same scale, else null with the
 * distinct notes as `choices` (several scales, e.g. a detail sheet or a sheet index), or none.
 */
export function pickSheetScale(
  text: string,
  starts: ReadonlyArray<{ offset: number; at: [number, number] }> = [],
): { scale: ScaleNote | null; choices: ScaleNote[] } {
  const distinct: ScaleNote[] = [];
  for (const n of findScaleNotes(text)) {
    if (distinct.some((d) => sameScale(d.fpp, n.fpp))) continue;
    let at: [number, number] | null = null;
    for (const s of starts) {
      if (s.offset > n.index) break;
      at = s.at;
    }
    distinct.push({ text: n.text, feetPerInch: n.feetPerInch, fpp: n.fpp, at });
  }
  if (distinct.length === 1) return { scale: distinct[0]!, choices: [] };
  return { scale: null, choices: distinct };
}

/**
 * The page scale a sheet note gives: a one-inch (72-unit) level line of `feetPerInch` feet just
 * under the note (`at`, page units) — or near the bottom right when its place is unknown —
 * kept on the page, tagged as read from the sheet.
 */
export function sheetScaleLine(
  note: Pick<ScaleNote, "text" | "feetPerInch">,
  at: [number, number] | null,
  width: number,
  height: number,
): TaggedScale {
  const len = UNITS_PER_INCH;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const x = clamp(at ? at[0] : width - len - 36, 0, width - len);
  const y = clamp(at ? at[1] + 14 : height - 24, 0, height);
  return {
    ax: x,
    ay: y,
    bx: x + len,
    by: y,
    feet: note.feetPerInch,
    source: "sheet",
    note: note.text,
  };
}

/** The words shown wherever a scale read from the sheet is shown (owner: make it known). */
export const sheetScaleMessage = (note: string): string =>
  `Scale read from the sheet: ${note} — check it against a printed dimension`;

/** Full-size drawing sheets (in): ANSI C / D / E and ARCH C / D / E1 / E. */
const FULL_SIZE_SHEETS: ReadonlyArray<[number, number]> = [
  [17, 22],
  [22, 34],
  [34, 44],
  [18, 24],
  [24, 36],
  [30, 42],
  [36, 48],
];

const inches = (v: number) => String(Math.round(v * 10) / 10);

/**
 * A warning when the page is not a full-size drawing sheet (letter, legal, 11×17, 12×18…): the
 * set may have been printed reduced, and the note's scale would be off by that factor. `width`
 * and `height` are page units (72 per inch). Null for a full-size sheet.
 */
export function sheetSizeWarning(width: number, height: number): string | null {
  const w = width / UNITS_PER_INCH;
  const h = height / UNITS_PER_INCH;
  const lo = Math.min(w, h);
  const hi = Math.max(w, h);
  const tol = 0.3;
  if (FULL_SIZE_SHEETS.some(([a, b]) => Math.abs(lo - a) <= tol && Math.abs(hi - b) <= tol))
    return null;
  return `This sheet is ${inches(w)}×${inches(h)} in; if it was printed at a reduced size the scale note is off by that factor.`;
}

/** Where a page's scale came from: read from the sheet (with its note) or drawn. */
export function scaleOrigin(
  scale: PageScale | null | undefined,
): { source: "sheet"; note: string } | { source: "drawn" } | null {
  if (!scale) return null;
  const t = scale as TaggedScale;
  return t.source === "sheet" && t.note ? { source: "sheet", note: t.note } : { source: "drawn" };
}
