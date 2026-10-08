/**
 * Owner, Oct 8: "when i save after clicking show on invoice it doesnt stay checked. also when i
 * try to preview pdf it says this page is blocked by chrome in the viewer but the download and
 * close button works".
 *
 * 1. saveInvoice rewrites only the lines that changed (lineChanged). It compared the printed
 *    columns and the typed-price flag but not Show on invoice, so a line whose only change was
 *    its Show box was skipped. lineFlagsChanged now covers both flags.
 * 2. The preview drew the PDF in an <iframe> on a blob URL, i.e. Chrome's own PDF viewer, which
 *    Chrome refuses inside a sandboxed frame (the Lovable preview runs the app in one). The pages
 *    are now drawn with pdf.js onto canvases (as the takeoff underlay already does), which needs
 *    no viewer; Download and "Open in a new tab" stay.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { lineFlagsChanged } from "@/lib/invoice-rebuild";

const read = (p: string) => readFileSync(p, "utf8");

describe("lineFlagsChanged — a line whose only change is a flag is still saved", () => {
  const prev = { rate_overridden: false, show_on_invoice: false };
  it("Show on invoice switched on or off", () => {
    expect(lineFlagsChanged(prev, { show_on_invoice: true })).toBe(true);
    expect(lineFlagsChanged({ ...prev, show_on_invoice: true }, { show_on_invoice: false })).toBe(
      true,
    );
  });
  it("the typed-price flag, as before", () => {
    expect(lineFlagsChanged(prev, { rate_overridden: true })).toBe(true);
  });
  it("unchanged, or a flag the row does not carry (column not there yet): not a change", () => {
    expect(lineFlagsChanged(prev, { show_on_invoice: false, rate_overridden: false })).toBe(false);
    expect(lineFlagsChanged(prev, {})).toBe(false);
  });
});

describe("saveInvoice and the preview", () => {
  it("lineChanged asks lineFlagsChanged", () => {
    const fns = read("src/lib/invoices.functions.ts");
    const fn = fns.slice(fns.indexOf("function lineChanged("), fns.indexOf("const shown = "));
    expect(fn).toContain("if (lineFlagsChanged(prev, next)) return true;");
  });
  it("the preview draws the pages with pdf.js, not Chrome's viewer in an iframe", () => {
    const ed = read("src/components/service/invoice-editor.tsx");
    const dialog = ed.slice(
      ed.indexOf("function PdfPreviewDialog("),
      ed.indexOf("const INTERNAL_OPEN_KEY"),
    );
    expect(dialog).not.toContain("<iframe");
    expect(dialog).toContain("<PdfPages blob={view.blob} title={view.fileName} />");
    const pages = read("src/components/service/pdf-pages.tsx");
    expect(pages).toContain("const doc = await openPdf(await blob.arrayBuffer());");
    expect(pages).toContain("await page.render({ canvas, viewport }).promise;");
    expect(pages).toContain("closePdf(");
  });
});
