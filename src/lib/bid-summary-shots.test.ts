import { deflateSync } from "node:zlib";

import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";

import { renderShotsPdf, shotLayout, type ShotsPdfInput } from "./bid-summary-shots";

/** A valid w×h RGB PNG (solid grey), built by hand: signature, IHDR, IDAT, IEND. */
function tinyPng(w = 2, h = 2): Uint8Array {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const raw = Buffer.alloc(h * (1 + w * 3), 0x80);
  for (let r = 0; r < h; r++) raw[r * (1 + w * 3)] = 0; // filter byte: none
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const png = tinyPng();
const base = (steps: ShotsPdfInput["steps"]): ShotsPdfInput => ({
  title: "Acme Warehouse Reroof",
  subtitle: "Acme Corp · 12 Main St, Springfield · Draft",
  grandTotal: "$123,456.78",
  exportedAt: "Sep 29, 2026",
  steps,
});

async function pagesOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    expect(width).toBe(792);
    expect(height).toBe(612);
  }
  return doc;
}

describe("renderShotsPdf", () => {
  it("renders a titled landscape Letter PDF: cover + one page per step", async () => {
    const steps = ["Setup", "Sections", "Underlayment", "Review"].map((label) => ({
      label,
      shot: { png, width: 1000, height: 600 },
    }));
    const doc = await pagesOf(await renderShotsPdf(base(steps)));
    expect(doc.getPageCount()).toBe(1 + steps.length);
    expect(doc.getTitle()).toBe("Acme Warehouse Reroof — Bid summary");
  });

  it("continues a very tall screenshot on following pages", async () => {
    const tall = { png, width: 1000, height: 5000 };
    const expected = shotLayout(tall.width, tall.height).pages;
    expect(expected).toBeGreaterThan(1);
    const doc = await pagesOf(
      await renderShotsPdf(
        base([
          { label: "Setup", shot: { png, width: 1000, height: 400 } },
          { label: "Sections", shot: tall },
        ]),
      ),
    );
    expect(doc.getPageCount()).toBe(1 + 1 + expected);
  });

  it("gives a step that could not be captured its own page with the note", async () => {
    const doc = await pagesOf(
      await renderShotsPdf(
        base([
          { label: "Setup", shot: { png, width: 800, height: 500 } },
          { label: "Curbs", shot: null, note: "Screenshot failed: boom ✎ ≥ 2′" },
        ]),
      ),
    );
    expect(doc.getPageCount()).toBe(3);
  });
});

describe("shotLayout", () => {
  it("fits the page width, shrinks slightly-too-tall pictures onto one page", () => {
    expect(shotLayout(1000, 600)).toMatchObject({ width: 720, pages: 1 });
    // 720 wide would be ~540 pt tall: a little over the area, so it is shrunk instead of split.
    const near = shotLayout(1000, 750);
    expect(near.pages).toBe(1);
    expect(near.width).toBeLessThan(720);
    expect(shotLayout(1000, 3000).pages).toBeGreaterThan(1);
  });
});
