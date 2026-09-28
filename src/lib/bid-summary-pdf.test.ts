import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";

import { buildBidSummary } from "./bid-summary";
import { clean, renderBidSummaryPdf } from "./bid-summary-pdf";
import { summaryInput } from "./bid-summary.fixture";

describe("renderBidSummaryPdf", () => {
  it("renders a landscape Letter PDF: cover + one page run per step, titled", async () => {
    const model = buildBidSummary(summaryInput);
    const bytes = await renderBidSummaryPdf(model);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1 + model.steps.length);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(11);
    for (const p of doc.getPages()) {
      const { width, height } = p.getSize();
      expect(width).toBe(792);
      expect(height).toBe(612);
    }
    expect(doc.getTitle()).toBe(model.title);
  });

  it("breaks long tables across pages and survives text the standard fonts cannot encode", async () => {
    const model = buildBidSummary(summaryInput);
    const many = Array.from({ length: 120 }, (_, i) => [
      `Row ${i} ✎ ≥ 2′ → ${"very long description ".repeat(i % 7)}`,
      `${i}`,
    ]);
    model.steps[0]!.tables.push({
      title: "Stress",
      columns: [{ label: "Text" }, { label: "N", align: "right" }],
      rows: many,
    });
    const doc = await PDFDocument.load(await renderBidSummaryPdf(model));
    // 120 rows cannot share the Setup page with its other tables.
    expect(doc.getPageCount()).toBeGreaterThan(11);
  });
});

describe("clean", () => {
  it("keeps WinAnsi characters and swaps the rest", () => {
    expect(clean("A — B … “x” $1,234.56 ×")).toBe("A — B … “x” $1,234.56 ×");
    expect(clean("2′ ≥ 3″ → ✎")).toBe(`2' >= 3" -> ?`);
  });
});
