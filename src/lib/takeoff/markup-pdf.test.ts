import { deflateSync } from "node:zlib";

import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  assembleMarkupPdf,
  buildMarkupPdf,
  layoutLabels,
  markupFileName,
  markupRenderScale,
  markupSummary,
  objectLabelText,
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
      "Counts: Drain",
    ]);
    const areas = s.groups[0]!;
    expect(areas.rows[0]).toEqual(["Gable", "A1", "6:12 (×1.118)", "950", "1,062", "220", "4"]);
    expect(areas.total).toEqual(["Total", "", "", "950", "1,062", "220", ""]);
    expect(s.groups[1]!.rows).toEqual([["Wall 1", "A1", "100", "24"]]);
    expect(s.groups[1]!.total).toEqual(["Total parapet wall", "", "100", ""]);
    expect(s.groups[3]!.rows[0]).toEqual(["Drain 1", "3", "4 in", "4in · 12in"]);
    expect(s.groups[3]!.total).toEqual(["Total drain", "3", "", ""]);
    expect(s.totals).toEqual([
      ["Roof area", "1,062 sq ft"],
      ["Plan area", "950 sq ft"],
      ["Perimeter", "220 ft"],
      ["Parapet", "100 ft"],
      ["Counted items", "3"],
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
  it("one landscape page per sheet plus the summary page", async () => {
    const bytes = await assembleMarkupPdf({
      takeoffName: "Acme – Bldg 2",
      customer: "Acme Corp",
      exportedBy: "Pat Estimator",
      exportedAt: "Sep 30, 2026",
      sheets: [
        { pageName: "A1", scaleText: "Scale line: 100'", image: tinyPng(), imageKind: "png" },
        { pageName: "A2", scaleText: "No scale", image: tinyPng(3, 5), imageKind: "png" },
      ],
      summary: markupSummary(q, pageName),
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    for (const p of doc.getPages()) expect(p.getWidth()).toBeGreaterThan(p.getHeight());
    expect(doc.getTitle()).toBe("Acme – Bldg 2 – takeoff");
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
      // Page A2 has nothing drawn: no sheet for it.
      expect(rendered.map((r) => r.index)).toEqual([0, 2]);
      expect(rendered[0]!.scale).toBe(markupRenderScale(1200, 800));
      expect(out.sheetCount).toBe(2);
      const doc = await PDFDocument.load(out.bytes);
      expect(doc.getPageCount()).toBe(3);
    },
  );
});
