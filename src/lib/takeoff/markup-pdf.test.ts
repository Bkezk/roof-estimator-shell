import { deflateSync } from "node:zlib";

import { describe, it, expect } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

import {
  assembleMarkupPdf,
  buildMarkupPdf,
  layoutDeficiencyPages,
  layoutLabels,
  markupFileName,
  markupRenderScale,
  markupSummary,
  objectLabelText,
  wrapText,
  type RenderedSheet,
} from "./markup-pdf";
import { takeoffQuantities, type TakeoffObject, type TakeoffPage } from "./model";

// 10 page px per foot.
const page = (index: number, over: Partial<TakeoffPage> = {}): TakeoffPage => ({
  index,
  name: `A${index + 1}`,
  rotation: 0,
  width: 1200,
  height: 800,
  scale: { ax: 0, ay: 0, bx: 1000, by: 0, feet: 100 },
  ...over,
});
const objects: TakeoffObject[] = [
  {
    id: "a",
    kind: "area",
    page: 0,
    color: "#16a34a",
    points: [
      [100, 100],
      [1100, 100],
      [1100, 200],
      [100, 200],
    ],
    attrs: {
      name: "Gable",
      pitch: 6,
      cutouts: [
        [
          [200, 120],
          [300, 120],
          [300, 170],
          [200, 170],
        ],
      ],
    },
  },
  {
    id: "w",
    kind: "linear",
    page: 0,
    color: "#1d4ed8",
    points: [
      [100, 300],
      [1100, 300],
    ],
    attrs: { name: "Wall 1", role: "parapet", heightIn: 24 },
  },
  {
    id: "g",
    kind: "linear",
    page: 0,
    points: [
      [100, 400],
      [600, 400],
    ],
    attrs: { name: "Gutter 1", role: "gutter" },
  },
  {
    id: "d",
    kind: "count",
    page: 0,
    color: "#db2777",
    points: [
      [400, 500],
      [600, 500],
      [800, 500],
    ],
    attrs: { name: "Drain 1", role: "drain", sizeIn: 4, bootSize: "4in", ringSize: "12in" },
  },
  {
    id: "u",
    kind: "area",
    page: 2,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    attrs: { name: "Unscaled roof" },
  },
  // Deficiencies (owner, Oct 27): red numbered pins, their own pages; never a quantity.
  {
    id: "x1",
    kind: "count",
    page: 0,
    points: [[900, 150]],
    attrs: {
      name: "Ponding water",
      role: "deficiency",
      note: "About 2 in deep after rain.\nDrain strainer clogged.",
      photos: [{ path: "t/photos/a.png" }, { path: "t/photos/b.png" }],
    },
  },
  {
    id: "x2",
    kind: "count",
    page: 1,
    points: [[100, 100]],
    attrs: { name: "Open seam", role: "deficiency" },
  },
];
const pages = [page(0), page(1), page(2, { scale: null })];
const q = takeoffQuantities(pages, objects);
const pageName = (i: number) => `A${i + 1}`;

describe("markupRenderScale", () => {
  it("keeps a sheet at or under ~4 MP, and never blows a small image past 3×", () => {
    const s = markupRenderScale(2592, 1728);
    expect(2592 * s * 1728 * s).toBeLessThanOrEqual(4_000_001);
    expect(2592 * s * 1728 * s).toBeGreaterThan(3_900_000);
    expect(markupRenderScale(400, 300)).toBe(3);
  });
});

describe("objectLabelText", () => {
  it("areas show the roof surface with the pitch; linears LF; counts × n; unscaled says so", () => {
    // 100 × 10 ft = 1,000 sq ft less a 10 × 5 ft cut-out = 950 on plan, × 1.118 at 6:12.
    expect(objectLabelText(objects[0]!, q)).toBe("Gable: 1,062 sq ft (6:12, ×1.118)");
    expect(objectLabelText(objects[1]!, q)).toBe("Wall 1: 100 LF");
    expect(objectLabelText(objects[3]!, q)).toBe("Drain 1 × 3");
    expect(objectLabelText(objects[4]!, q)).toBe("Unscaled roof: no scale");
    // A deficiency is named with its number across the takeoff, never "× n".
    expect(objectLabelText(objects[5]!, q)).toBe("Deficiency 1: Ponding water");
    expect(objectLabelText(objects[6]!, q)).toBe("Deficiency 2: Open seam");
  });
});

describe("wrapText", () => {
  const measure = (s: string) => s.length * 10; // 10 units per character
  it("breaks between words to the width, keeps the text's own line breaks, cuts a long word", () => {
    expect(wrapText("About 2 in deep after rain.\nDrain clogged.", 120, measure)).toEqual([
      "About 2 in",
      "deep after",
      "rain.",
      "Drain",
      "clogged.",
    ]);
    expect(wrapText("supercalifragilistic", 50, measure)).toEqual([
      "super",
      "calif",
      "ragil",
      "istic",
    ]);
    expect(wrapText("   ", 100, measure)).toEqual([]);
    expect(wrapText("a\n\n\nb", 100, measure)).toEqual(["a", "", "", "b"]);
  });
});

describe("layoutDeficiencyPages", () => {
  const opts = {
    width: 1000,
    height: 500,
    cellW: 240,
    cellH: 180,
    gap: 10,
    headH: 20,
    lineH: 12,
    pad: 10,
    wrap: (t: string) => t.split("\n"),
  };
  const item = (number: number, photoCount: number, note = "") => ({
    number,
    name: `D${number}`,
    note,
    pageName: "A1",
    photoCount,
  });
  it("entries stack; four cells per row; an entry that does not fit starts a new page", () => {
    // Width 1000: (1000 + 10) / 250 = 4 cells per row.
    const pages = layoutDeficiencyPages([item(1, 5, "one\ntwo"), item(2, 0), item(3, 4)], opts);
    expect(pages).toHaveLength(2);
    const [first, second] = pages;
    expect(first!.map((p) => p.index)).toEqual([0, 1]);
    const a = first![0]!;
    // Heading 20 + 2 note lines 24 → the pictures start at 44; 5 pictures = 2 rows.
    expect(a.noteLines).toEqual(["one", "two"]);
    expect(a.photos.map((c) => [c.x, c.y])).toEqual([
      [0, 44],
      [250, 44],
      [500, 44],
      [750, 44],
      [0, 234],
    ]);
    expect(a.height).toBe(234 + 180 - 0 + 10); // last row's bottom + pad
    const b = first![1]!;
    expect(b.y).toBe(a.height);
    expect(b.photos).toEqual([]);
    expect(b.height).toBe(20 + 10);
    // Entry 3 (20 + 180 + 10 = 210 tall) does not fit under 424 + 30 = 454 on a 500 pt page.
    expect(second!.map((p) => [p.index, p.y])).toEqual([[2, 0]]);
    expect(second![0]!.photos).toHaveLength(4);
  });
  it("an entry taller than a page stands alone and keeps only the picture rows that fit", () => {
    const pages = layoutDeficiencyPages([item(1, 0), item(2, 12), item(3, 1)], opts);
    expect(pages.map((p) => p.map((x) => x.index))).toEqual([[0], [1], [2]]);
    const big = pages[1]![0]!;
    // Rows at 20, 210, 400 (+180 = 580 > 500): two rows of four fit.
    expect(big.photos).toHaveLength(8);
    expect(big.photos.every((c) => c.y + c.h <= opts.height)).toBe(true);
    expect(layoutDeficiencyPages([], opts)).toEqual([]);
  });
});

describe("layoutLabels", () => {
  const bounds = { width: 400, height: 300 };
  it("the first label keeps its spot; labels on one anchor end up clear of each other", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      x: 200,
      y: 150,
      w: 80,
      h: 16,
    }));
    const out = layoutLabels(items, bounds, 2);
    expect(out[0]).toEqual({ id: "0", x: 160, y: 142, w: 80, h: 16 });
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const clear = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(clear, `${a.id} vs ${b.id}`).toBe(true);
      }
  });
  it("a label near the edge stays inside the sheet", () => {
    const [a] = layoutLabels([{ id: "x", x: 395, y: 2, w: 60, h: 14 }], bounds);
    expect(a).toEqual({ id: "x", x: 340, y: 0, w: 60, h: 14 });
  });
});

describe("markupSummary", () => {
  it("groups areas, linears by role and counts by role, each with a total", () => {
    const s = markupSummary(q, pageName);
    expect(s.groups.map((g) => g.title)).toEqual([
      "Areas",
      "Linears: Parapet wall",
      "Linears: Gutter",
      "Penetrations: Drain",
      "Deficiencies (see the Deficiencies pages for the pictures)",
    ]);
    expect(s.groups[4]!.rows).toEqual([
      ["1", "Ponding water", "A1", "About 2 in deep after rain.\nDrain strainer clogged.", "2"],
      ["2", "Open seam", "A2", "", "0"],
    ]);
    expect(s.groups[4]!.total).toBeNull();
    const areas = s.groups[0]!;
    expect(areas.rows[0]).toEqual(["Gable", "A1", "6:12 (×1.118)", "950", "1,062", "220", "4"]);
    expect(areas.total).toEqual(["Total", "", "", "950", "1,062", "220", ""]);
    expect(s.groups[1]!.rows).toEqual([["Wall 1", "A1", "100", "24", ""]]);
    expect(s.groups[1]!.total).toEqual(["Total parapet wall", "", "100", "", ""]);
    expect(s.groups[3]!.rows[0]).toEqual(["Drain 1", "3", "4 in", "4in · 12in"]);
    expect(s.groups[3]!.total).toEqual(["Total drain", "3", "", ""]);
    expect(s.totals).toEqual([
      ["Roof area", "1,062 sq ft"],
      ["Plan area", "950 sq ft"],
      ["Perimeter", "220 ft"],
      ["Parapet", "100 ft"],
      ["Penetrations", "3"],
      ["Deficiencies", "2"],
    ]);
    expect(s.unscaled).toEqual(["Unscaled roof (A3)"]);
  });
});

describe("markupFileName", () => {
  it("names the file after the takeoff, without characters a file system refuses", () => {
    expect(markupFileName("Acme Warehouse")).toBe("Acme Warehouse – takeoff.pdf");
    expect(markupFileName('Bldg 2/3: "East"')).toBe("Bldg 2 3 East – takeoff.pdf");
    expect(markupFileName("  ")).toBe("Untitled – takeoff.pdf");
  });
});

/** A valid w×h grey RGB PNG, built by hand. */
function tinyPng(w = 4, h = 3): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3), 0x80);
  for (let r = 0; r < h; r++) raw[r * (1 + w * 3)] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

describe("assembleMarkupPdf", () => {
  const input = {
    takeoffName: "Acme – Bldg 2",
    customer: "Acme Corp",
    exportedBy: "Pat Estimator",
    exportedAt: "Sep 30, 2026",
    sheets: [
      {
        pageName: "A1",
        scaleText: "Scale line: 100'",
        image: tinyPng(),
        imageKind: "png" as const,
      },
      { pageName: "A2", scaleText: "No scale", image: tinyPng(3, 5), imageKind: "png" as const },
    ],
    summary: markupSummary(q, pageName),
  };
  it("one landscape page per sheet plus the summary page", async () => {
    const bytes = await assembleMarkupPdf(input);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    for (const p of doc.getPages()) expect(p.getWidth()).toBeGreaterThan(p.getHeight());
    expect(doc.getTitle()).toBe("Acme – Bldg 2 – takeoff");
  });
  it("deficiencies get their own page(s) after the sheets, pictures embedded", async () => {
    const bytes = await assembleMarkupPdf({
      ...input,
      deficiencies: [
        {
          number: 1,
          name: "Ponding water",
          note: "About 2 in deep after rain.",
          pageName: "A1",
          photos: [
            { bytes: tinyPng(), kind: "png" },
            { bytes: tinyPng(5, 4), kind: "png" },
          ],
          missing: 1,
        },
        { number: 2, name: "Open seam", note: "", pageName: "A2", photos: [], missing: 0 },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    // 2 sheets + 1 deficiencies page + 1 summary.
    expect(doc.getPageCount()).toBe(4);
    // Two pictures embedded as XObjects on the deficiencies page.
    const defPage = doc.getPage(2);
    const xobjects = defPage.node.Resources()?.lookup(PDFName.of("XObject"));
    expect(xobjects instanceof PDFDict ? xobjects.keys().length : 0).toBe(2);
  });
});

// Smoke test of the canvas half: runs only where a Node canvas is installed (@napi-rs/canvas
// arrives with pdfjs-dist here; it is not a declared dependency, so it is loaded by name).
type NodeCanvas = RenderedSheet["canvas"] & {
  toBuffer(mime: "image/png"): Buffer;
};
async function nodeCanvas(): Promise<((w: number, h: number) => NodeCanvas) | null> {
  try {
    const name = "@napi-rs/canvas";
    const mod = (await import(/* @vite-ignore */ name)) as {
      createCanvas: (w: number, h: number) => NodeCanvas;
    };
    return mod.createCanvas;
  } catch {
    return null;
  }
}

describe("buildMarkupPdf (canvas smoke test)", async () => {
  const createCanvas = await nodeCanvas();
  it.skipIf(!createCanvas)(
    "draws the markup on each page with objects and builds the PDF",
    async () => {
      const rendered: Array<{ index: number; scale: number }> = [];
      const out = await buildMarkupPdf({
        takeoffName: "Smoke",
        customer: null,
        exportedBy: "Test",
        exportedAt: "Sep 30, 2026",
        pages,
        objects,
        render: async (p, scale) => {
          rendered.push({ index: p.index, scale });
          const w = p.width ?? 1200;
          const h = p.height ?? 800;
          const canvas = createCanvas!(Math.round(w * scale), Math.round(h * scale));
          const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          return { canvas, width: w, height: h };
        },
        encode: async (canvas) => ({
          bytes: new Uint8Array((canvas as NodeCanvas).toBuffer("image/png")),
          kind: "png",
        }),
      });
      // Every page has something drawn (A2 only the "Open seam" deficiency pin).
      expect(rendered.map((r) => r.index)).toEqual([0, 1, 2]);
      expect(rendered[0]!.scale).toBe(markupRenderScale(1200, 800));
      expect(out.sheetCount).toBe(3);
      expect(out.deficiencyCount).toBe(2);
      const doc = await PDFDocument.load(out.bytes);
      // 3 sheets, the Deficiencies page (no `photo` fetcher: its pictures read as missing), summary.
      expect(doc.getPageCount()).toBe(5);
    },
  );
});
