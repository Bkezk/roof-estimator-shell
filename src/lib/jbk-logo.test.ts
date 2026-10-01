import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { JBK_LOGO_PNG_HEIGHT, JBK_LOGO_PNG_WIDTH, jbkLogoPng } from "./jbk-logo.server";

describe("the JBK logo on PDFs (owner, Oct 1: the logo, not just text)", () => {
  it("is a real PNG of the stated size", () => {
    const png = jbkLogoPng();
    // PNG signature, then the IHDR chunk with width and height big-endian at bytes 16-23.
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(dv.getUint32(16)).toBe(JBK_LOGO_PNG_WIDTH);
    expect(dv.getUint32(20)).toBe(JBK_LOGO_PNG_HEIGHT);
    expect(png.length).toBeGreaterThan(50_000);
  });
  it("the invoice PDF draws it at the top left of every page, the company text beside it", () => {
    const src = readFileSync("src/lib/invoices.server.ts", "utf8");
    expect(src).toContain('await import("@/lib/jbk-logo.server");');
    expect(src).toContain('const logo = await embed(doc, jbkLogoPng(), "jbk-logo.png");');
    const header = src.slice(
      src.indexOf("const header = (title: string) => {"),
      src.indexOf('header("Service Invoice");'),
    );
    expect(header).toContain(
      "doc.page.drawImage(logo, { x: M, y: top - LOGO_H + 12, width: LOGO_W, height: LOGO_H });",
    );
    expect(header).toContain("textX = M + LOGO_W + 10;");
    expect(header).toContain(
      'doc.text(company?.company_name ?? "JBK Commercial Roofing", textX, 14, true);',
    );
    expect(src).not.toContain("Bid-O-Matic");
  });
});
