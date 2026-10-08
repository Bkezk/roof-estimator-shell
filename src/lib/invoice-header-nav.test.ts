/**
 * The invoice page's header (owner, Oct 8): "when you hit the arrow at the top left it takes you
 * to the ticket page instead of the invoice page, change that to be a button that takes you to
 * invoices and make the title Invoice #xxxx clickable to take you to the ticket."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ed = readFileSync("src/components/service/invoice-editor.tsx", "utf8");
const page = ed.slice(
  ed.indexOf("export function InvoiceEditorPage"),
  ed.indexOf("Another invoice\n"),
);
const header = page.slice(page.indexOf("const status = asInvoiceStatus(inv.status);"));

describe("the invoice page's header", () => {
  it("the top-left button goes to the Invoices list, not the ticket", () => {
    const top = header.slice(0, header.indexOf("<h1"));
    expect(top).toContain("{backToList}");
    expect(top).not.toContain('to="/service"');
    expect(page).toContain('<ArrowLeft className="h-4 w-4" /> Invoices');
  });
  it("the title Invoice #… is a link to its ticket", () => {
    const h1 = header.slice(header.indexOf("<h1"), header.indexOf("</h1>"));
    expect(h1).toContain('to="/service"');
    expect(h1).toContain("search={{ id: job.id }}");
    expect(h1).toContain("Invoice #{invoiceLabel(inv)}");
    expect(h1).toContain("title={`Open ticket #${job.number}`}");
  });
});
