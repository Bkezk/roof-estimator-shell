/**
 * Owner, Oct 1: "the invoice is cramped into a little dropdown and difficult to edit." The
 * invoice gets its own full-width page (`/service/invoices?id=<invoice uuid>`, rendered by the
 * Invoices page from invoice-editor.tsx); the ticket keeps a summary card (invoice-block.tsx)
 * with Open / Another invoice / Delete draft; the "To invoice (N)" chip reads "Awaiting
 * invoice (N)" with a tooltip; a new line's quantity and rate start blank and a line is not
 * saved without them.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AWAITING_INVOICE_TITLE, invoiceSearch } from "@/lib/invoice-search";

const read = (p: string) => readFileSync(p, "utf8");
const UUID = "0b6c6f1e-3a52-4c1f-9d0e-5d1f2a7b8c90";

describe("invoiceSearch (the /service/invoices route's search)", () => {
  it("keeps an invoice uuid", () => {
    expect(invoiceSearch({ id: UUID })).toEqual({ id: UUID });
  });
  it("keeps the Awaiting invoice tab", () => {
    expect(invoiceSearch({ tab: "to-invoice" })).toEqual({ tab: "to-invoice" });
  });
  it("keeps both together", () => {
    expect(invoiceSearch({ id: UUID, tab: "to-invoice" })).toEqual({
      id: UUID,
      tab: "to-invoice",
    });
  });
  it("drops a malformed id, an unknown tab and anything else", () => {
    expect(invoiceSearch({})).toEqual({});
    expect(invoiceSearch({ id: "6012" })).toEqual({});
    expect(invoiceSearch({ id: 42 })).toEqual({});
    expect(invoiceSearch({ id: `${UUID}x` })).toEqual({});
    expect(invoiceSearch({ tab: "paid" })).toEqual({});
    expect(invoiceSearch({ stage: "done", new: 1 })).toEqual({});
  });
  it("is the route's validateSearch, and the route passes the id to the Invoices page", () => {
    const route = read("src/routes/service.invoices.tsx");
    expect(route).toContain("validateSearch: invoiceSearch,");
    expect(route).toContain('<InvoicesPage toInvoice={tab === "to-invoice"} invoiceId={id} />');
  });
});

describe("the full-width invoice page", () => {
  const editorPath = "src/components/service/invoice-editor.tsx";
  it("invoice-editor.tsx holds the editor: the page, the draft and final views, History", () => {
    expect(existsSync(editorPath)).toBe(true);
    const ed = read(editorPath);
    expect(ed).toContain("export function InvoiceEditorPage({ id }: { id: string })");
    expect(ed).toContain("function DraftInvoice(");
    expect(ed).toContain("function FinalInvoice(");
    expect(ed).toContain("interface LineDraft {");
    expect(ed).toMatch(/<AuditHistory entity="invoice" entityId=\{data\.invoice\.id\}/);
    // The title Invoice #… links to the ticket (owner, Oct 8); the chips switch between its invoices.
    expect(ed).toMatch(/to="\/service"\s+search=\{\{ id: job\.id \}\}/);
    expect(ed).toContain("Ticket #{job.number}");
    expect(ed).toMatch(/to="\/service\/invoices"\s+search=\{\{ id: x\.id \}\}/);
    // The actions, drafts and finals.
    for (const a of [
      "Save",
      "Rebuild from ticket",
      "Preview PDF",
      "Finalise",
      "Finalise &amp; send",
      "Delete draft",
      "Download PDF",
      "Mark paid",
      "Void",
    ])
      expect(ed, a).toMatch(new RegExp(`[>}]\\s*${a}\\s*<`));
  });
  it("the Invoices page renders it when ?id= is set, behind seesInvoices", () => {
    const page = read("src/components/service/invoices-page.tsx");
    expect(page).toMatch(
      /import \{ InvoiceEditorPage[^}]*\} from "@\/components\/service\/invoice-editor";/,
    );
    const fn = page.slice(page.indexOf("export function InvoicesPage"));
    const gate = fn.indexOf("if (!seesInvoices(profile))");
    const editor = fn.indexOf("if (invoiceId) return <InvoiceEditorPage id={invoiceId} />;");
    expect(gate).toBeGreaterThan(0);
    expect(editor).toBeGreaterThan(gate);
  });
  it("a list row opens the invoice's page, not the ticket", () => {
    const page = read("src/components/service/invoices-page.tsx");
    expect(page).toContain("onClick={() => openInvoice(r.id)}");
    expect(page).toMatch(/to="\/service\/invoices"\s+search=\{\{ id: r\.id \}\}/);
  });
});

describe("the ticket's invoice card", () => {
  const block = read("src/components/service/invoice-block.tsx");
  it("has no line editor and no Finalise button", () => {
    expect(block).not.toContain("LineDraft");
    expect(block).not.toContain("DraftInvoice");
    expect(block).not.toContain("FinalInvoice");
    expect(block).not.toContain("addLine");
    expect(block).not.toContain("<NumberField");
    expect(block).not.toMatch(/\/>\s*Finali[sz]e/);
    expect(block).not.toContain("saveInvoice");
    expect(block).not.toContain("finalizeInvoice");
  });
  it("has Open (to the page), Another invoice, Delete draft (drafts only) and Make the invoice", () => {
    expect(block).toMatch(
      /<Link to="\/service\/invoices" search=\{\{ id: shown\.id \}\}>[\s\S]*?Open\s*<\/Link>/,
    );
    expect(block).toMatch(/[>}]\s*Another invoice\s*</);
    expect(block).toMatch(/status === "draft" && \([\s\S]*?\/> Delete draft\s*</);
    expect(block).toMatch(/[>}]\s*Make the invoice\s*</);
    // After a delete the card falls back to the ticket's remaining invoice.
    expect(block).toContain("const next = remainingInvoiceAfterVoid(fresh, deletedId);");
  });
  it("is still behind seesInvoices", () => {
    expect(block).toMatch(
      /export function InvoiceBlock[\s\S]*?if \(!profile \|\| !seesInvoices\(profile\)\) return null;/,
    );
  });
});

describe("Awaiting invoice (was: To invoice)", () => {
  it("the chip on the Invoices list reads Awaiting invoice (N) with a tooltip", () => {
    const page = read("src/components/service/invoices-page.tsx");
    // The count is the server's (listAwaitingInvoice), not the loaded list's length.
    expect(page).toContain('Awaiting invoice{jobsQ.data ? ` (${waitingCount})` : ""}');
    expect(page).toContain("title={AWAITING_INVOICE_TITLE}");
    expect(page).not.toMatch(/>\s*To invoice/);
  });
  it("the Invoices tab's count carries the same tooltip", () => {
    const tabs = read("src/components/service/service-tabs.tsx");
    expect(tabs).toContain("title={AWAITING_INVOICE_TITLE}");
    expect(tabs).toContain("aria-label={`${toInvoice} awaiting invoice`}");
  });
  it("the tooltip says what it means", () => {
    expect(AWAITING_INVOICE_TITLE).toBe("Tickets marked Done with no finalised invoice yet");
  });
});

describe("a new line's quantity and rate start blank", () => {
  const ed = existsSync("src/components/service/invoice-editor.tsx")
    ? read("src/components/service/invoice-editor.tsx")
    : "";
  it("Add line makes a line with blank (null) quantity and rate", () => {
    const add = ed.slice(ed.indexOf("const addLine = () => {"), ed.indexOf("const tryFinal"));
    expect(add).toContain("qty: null,");
    expect(add).toContain("rate: null,");
    expect(add).not.toContain("qty: 1,");
  });
  it("a line with a blank quantity or rate is not saved", () => {
    expect(ed).toContain(
      "if (l.qty === null || l.rate === null) return `Line ${i + 1} needs a quantity and a rate`;",
    );
    // Save and Preview stop on it with that message (Finalise / Send already did).
    expect(ed).toMatch(/const save = \(\) => \{\s*if \(!complete\(false, false\)\) return;/);
    expect(ed).toMatch(/const preview = \(\) => \{\s*if \(!complete\(false, false\)\) return;/);
  });
});
