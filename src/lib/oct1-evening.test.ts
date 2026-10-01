/**
 * Owner, Oct 1 (evening): the invoice PDF preview opens in the page (a blob: tab was "blocked by
 * Chrome", ERR_BLOCKED_BY_CLIENT, an extension); purchase orders sit under Materials on the
 * ticket; the Owner table keeps one width and one set of column widths, rows open or closed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("Invoice: Preview PDF shows the PDF in the page", () => {
  const src = read("src/components/service/invoice-editor.tsx");
  it("renders into a dialog with an iframe on a blob URL, Download and a plain new-tab link", () => {
    expect(src).toContain("function PdfPreviewDialog(");
    expect(src).toContain("setPdfView({ blob: pdfBlob(pdf.base64), fileName: pdf.file_name });");
    expect(src).toContain("<PdfPreviewDialog view={pdfView} onClose={() => setPdfView(null)} />");
    expect(src).toContain("const u = URL.createObjectURL(view.blob);");
    expect(src).toContain("return () => URL.revokeObjectURL(u);");
    expect(src).toMatch(/<iframe[\s\S]*?src=\{url\}/);
    expect(src).toContain("onClick={() => view && downloadBlob(view.blob, view.fileName)}");
    expect(src).toContain("Open in a new tab");
  });
  it("no longer opens a tab during the click or navigates it to the blob", () => {
    expect(src).not.toContain("openPdfTab(");
    expect(src).not.toContain("showPdf(");
    expect(src).not.toContain("win?.close()");
  });
});

describe("Ticket: purchase orders sit under Materials", () => {
  it("in the office right column and the technician's one-column view", () => {
    const src = read("src/components/service-page.tsx");
    const col = src.slice(src.indexOf("<aside"), src.indexOf("</aside>"));
    expect(col.indexOf("{materials}")).toBeGreaterThan(-1);
    expect(col.indexOf("<PurchaseOrdersSection jobId={job.id} />")).toBeGreaterThan(
      col.indexOf("{materials}"),
    );
    expect(col.indexOf("<PurchaseOrdersSection jobId={job.id} />")).toBeLessThan(
      col.indexOf(
        "<TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} repairs={false} />",
      ),
    );
    const tech = src.slice(src.indexOf("</aside>"));
    expect(tech.indexOf("<PurchaseOrdersSection jobId={job.id} />")).toBeGreaterThan(
      tech.indexOf("{materials}"),
    );
    expect(tech.indexOf("<PurchaseOrdersSection jobId={job.id} />")).toBeLessThan(
      tech.indexOf("<TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} />"),
    );
  });
});

describe("Owner view: one width, fixed columns", () => {
  it("table-fixed with a colgroup of seven set widths", () => {
    const src = read("src/components/owner-view.tsx");
    expect(src).toContain('<Table className="w-full min-w-[760px] table-fixed">');
    expect(src).toContain("<colgroup>");
    expect(src).toMatch(/const OWNER_COLS = \[("\d+%",? ?){7}\] as const;/);
    const widths = src.match(/const OWNER_COLS = \[([^\]]+)\]/)?.[1] ?? "";
    const sum = [...widths.matchAll(/(\d+)%/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(sum).toBe(100);
    // The detail still never widens the table.
    expect(src).toContain("w-0 min-w-full border-b bg-muted/30 p-3 align-top");
  });
});
