/**
 * Owner, Nov 13: "can you make font across the site larger without changing the layout?"
 *
 * One number in src/styles.css (--jbk-text-scale) multiplies every text size and divides every
 * line height, so a line of text is as tall as it was and only the letters grow. Screens only:
 * print, the document editor's pages and the proposal sheet stay at the old sizes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles.css", "utf8");
const tailwind = readFileSync("node_modules/tailwindcss/theme.css", "utf8");
const SCALE = "var(--jbk-text-scale, 1)";

/** `--name: value;` out of a stylesheet (the first one). */
function decl(sheet: string, name: string): string | null {
  const m = new RegExp(`\\s${name.replace(/[-]/g, "\\-")}:\\s*([^;]+);`).exec(sheet);
  return m ? m[1]!.trim() : null;
}
/** What is inside `calc( … )`, or the value itself when it is a plain number. */
const inner = (v: string) => /^calc\((.*)\)$/.exec(v)?.[1] ?? v;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("the one number", () => {
  it("is set once, larger than 1, and only for screens", () => {
    const all = [...css.matchAll(/--jbk-text-scale:\s*([\d.]+);/g)].map((m) => Number(m[1]));
    // 1 on the paper sheets, and the screen's number: nothing else sets it.
    expect(all.filter((n) => n !== 1)).toHaveLength(1);
    const screen = /@media screen \{\s*:root \{\s*--jbk-text-scale:\s*([\d.]+);\s*\}\s*\}/.exec(
      css,
    );
    expect(screen).not.toBeNull();
    expect(Number(screen![1])).toBeGreaterThan(1);
    expect(Number(screen![1])).toBeLessThanOrEqual(1.2);
  });
  it("is not set for print: paper lays out as it always has", () => {
    expect(css).not.toMatch(/@media print[^}]*--jbk-text-scale/);
    expect(css).not.toMatch(/^:root \{\s*--jbk-text-scale/m);
  });
});

describe("every text size grows and every line stays as tall", () => {
  const SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"];
  it.each(SIZES)("text-%s: Tailwind's size times the number", (s) => {
    const theirs = decl(tailwind, `--text-${s}`)!;
    expect(decl(css, `--text-${s}`)).toBe(`calc(${theirs} * ${SCALE})`);
  });
  it.each(SIZES)("text-%s: Tailwind's line height divided by the number", (s) => {
    const theirs = inner(decl(tailwind, `--text-${s}--line-height`)!);
    expect(decl(css, `--text-${s}--line-height`)).toBe(`calc(${theirs} / ${SCALE})`);
  });
  it.each(["tight", "snug", "normal", "relaxed", "loose"])("leading-%s is divided too", (l) => {
    const theirs = decl(tailwind, `--leading-${l}`)!;
    expect(decl(css, `--leading-${l}`)).toBe(`calc(${theirs} / ${SCALE})`);
  });
  it("text with no size class grows with the rest, on the same line height", () => {
    expect(css).toMatch(
      /body \{[^}]*font-size: calc\(1rem \* var\(--jbk-text-scale, 1\)\);\s*line-height: calc\(1\.4 \/ var\(--jbk-text-scale, 1\)\);/,
    );
  });
  it("the page's own size is untouched: boxes, padding and icons keep their size", () => {
    expect(css).toMatch(/html \{\s*font-size: 13px;\s*\}/);
  });
});

describe("sizes written out in a class", () => {
  // Every text-[…px] / text-[…rem] used anywhere in the source, with or without a prefix.
  const used = new Map<string, string>();
  for (const f of sourceFiles("src")) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/(?<![\w-])((?:[a-z0-9-]+:)*)text-\[([\d.]+)(px|rem)\]/g))
      used.set(`${m[1]}text-[${m[2]}${m[3]}]`, f);
  }
  it("some are in use (the scan works)", () => {
    expect(used.has("text-[10px]")).toBe(true);
    expect(used.has("text-[11px]")).toBe(true);
  });
  it("each one is scaled by name; a new size must be added to src/styles.css", () => {
    const missing: string[] = [];
    for (const [cls, file] of used) {
      const m = /text-\[([\d.]+)(px|rem)\]$/.exec(cls)!;
      const selector = `.${cls.replace(/[[\].:]/g, "\\$&")} {`;
      const rule = `${selector}\n  font-size: calc(${m[1]}${m[2]} * ${SCALE});\n}`;
      if (!css.includes(rule)) missing.push(`${cls} (${file})`);
    }
    expect(missing).toEqual([]);
  });
  it("sizes in points are paper sizes and are left alone", () => {
    expect(css).not.toMatch(/pt\\\]/);
  });
});

describe("paper shown on a screen keeps the old sizes", () => {
  it("the document editor's pages and the proposal sheet are held at 1", () => {
    expect(css).toMatch(/\.document-sheet,\s*\.proposal-sheet \{\s*--jbk-text-scale: 1;\s*\}/);
  });
  it("the sizes are worked out again on those sheets, not only on the page", () => {
    expect(css).toMatch(/:root,\s*\.document-sheet,\s*\.proposal-sheet \{\s*--text-xs:/);
  });
  it("a sheet starts from the old page size and line height", () => {
    expect(css).toMatch(
      /\.document-sheet,\s*\.proposal-sheet \{\s*font-size: 1rem;\s*line-height: 1\.4;\s*\}/,
    );
  });
  it("both sheets still carry those names", () => {
    expect(readFileSync("src/components/documents/editor/page-canvas.tsx", "utf8")).toContain(
      '"document-sheet ',
    );
    expect(readFileSync("src/components/documents/editor/pdf-preview.tsx", "utf8")).toContain(
      '"document-sheet ',
    );
    expect(readFileSync("src/routes/proposal.tsx", "utf8")).toContain('className="proposal-sheet ');
  });
});

describe("two spots that needed room for the larger letters", () => {
  it("the Tech Board's Unassigned list cannot push a phone screen sideways", () => {
    const board = readFileSync("src/components/service/board-page.tsx", "utf8");
    expect(board).toMatch(
      /aria-label="Unassigned tickets"\s*className=\{`flex max-h-\[70vh\] min-w-0 /,
    );
  });
  it("in the takeoff's object list the page name gives way before the object's name", () => {
    const tab = readFileSync("src/components/takeoff/objects-tab.tsx", "utf8");
    expect(tab).toContain('<span className="mr-auto min-w-0 truncate">{o.attrs.name}</span>');
    expect(tab).toContain(
      'className="min-w-0 shrink-[999] truncate text-xs text-muted-foreground"',
    );
    expect(tab).not.toContain('<span className="shrink-0 text-xs text-muted-foreground">');
  });
});
