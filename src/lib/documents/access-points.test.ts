/**
 * Where the document generator is reached from (owner, Oct 26: a CenterPoint-style "Documents"
 * on every bid and ticket; no automation — every document is a click). Wiring pins on the source:
 * the estimator's header button (saved bids only), the Project Bids row button, the ticket page's
 * fold (the office's column, where the Invoice fold is), the customer page's section, the
 * opportunity's list under its linked bid, the Admin › Documents page with its three tabs, the
 * sidebar entry for managers and admins, and the gate's two paths. Fails when one is unwired.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pageForPath } from "@/lib/access";
import {
  findInspectionTemplate,
  INSPECTION_REPORT_OPTIONS,
} from "@/lib/documents/inspection-report";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const estimate = read("src/routes/estimate.tsx");
const bids = read("src/routes/bids.tsx");
const service = read("src/components/service-page.tsx");
const customers = read("src/components/customers-page.tsx");
const opportunities = read("src/components/opportunities-page.tsx");
const admin = read("src/routes/admin.documents.tsx");
const sidebar = read("src/components/app-sidebar.tsx");
const settings = read("src/routes/admin.settings.tsx");

describe("the estimator's Documents button", () => {
  it("sits in the rail's square-button row between the reminder bell and Export (owner, Oct 26), enabled once the bid is saved", () => {
    const row = estimate.indexOf('data-field="bid-rail-buttons"');
    const bell = estimate.indexOf("<BellRing className", row);
    const docs = estimate.indexOf('"Documents for this bid: proposals and letters"', row);
    const exp = estimate.indexOf('exportMenu({ size: "icon"', row);
    expect(row).toBeGreaterThan(0);
    expect(bell).toBeGreaterThan(row);
    expect(docs).toBeGreaterThan(bell);
    expect(exp).toBeGreaterThan(docs);
    const button = estimate.slice(estimate.lastIndexOf("<Button", docs), docs);
    expect(button).toContain("disabled={!bidId}");
    expect(button).toContain("setDocumentsOpen(true)");
    expect(button).toContain('size="icon"');
    expect(estimate).toContain('aria-label="Documents"');
    expect(estimate).toContain('<FileText className="h-4 w-4" />');
    // Not in the header row any more (owner: "i dont like how this now takes two lines").
    const save = estimate.indexOf('{saving ? "Saving…" : bidId ? "Save" : "Save bid"}');
    const update = estimate.indexOf('frmHome.btnUpdate ("Update Pricing & Labor")');
    expect(estimate.slice(save, update)).not.toContain("setDocumentsOpen(true)");
  });
  it("mounts one DocumentsPanel for the saved bid, named after it", () => {
    expect(estimate).toContain(
      'import { DocumentsPanel } from "@/components/documents/documents-panel";',
    );
    const panel = estimate.slice(estimate.indexOf("<DocumentsPanel"));
    expect(panel).toContain('kind="bid"');
    expect(panel).toContain("bidId={bidId}");
    expect(panel).toContain('recordLabel={bidName.trim() || "Untitled bid"}');
    expect(panel).toContain("open={documentsOpen}");
    // Only once the bid exists: a document hangs off bids.id.
    expect(estimate).toMatch(/\{bidId && \(\s*<DocumentsPanel/);
  });
  it("says so in the file's voice: the owner's ask, and that nothing is automatic", () => {
    expect(estimate).toMatch(/owner, Oct 26.*CenterPoint-style document generator/);
    expect(estimate).toMatch(/every document is a click/);
  });
});

describe("the Project Bids row button", () => {
  it("is beside Move to folder / Duplicate / Delete and does not open the bid", () => {
    const move = bids.indexOf("<FolderInput className");
    const duplicate = bids.indexOf('title="Duplicate this bid (a new draft copy)"');
    const docs = bids.indexOf('title="Documents (proposals, letters)"');
    const del = bids.indexOf('title="Delete this bid"');
    expect(move).toBeGreaterThan(0);
    expect(docs).toBeGreaterThan(duplicate);
    expect(del).toBeGreaterThan(docs);
    const button = bids.slice(docs, bids.indexOf("</Button>", docs));
    expect(button).toContain("e.stopPropagation();");
    expect(button).toContain("setDocumentsFor({ id: bid.id, name: bid.name })");
    expect(button).toContain("<FileText className");
  });
  it("has one panel at page level for the chosen bid", () => {
    expect(bids).toContain(
      'import { DocumentsPanel } from "@/components/documents/documents-panel";',
    );
    expect((bids.match(/<DocumentsPanel/g) ?? []).length).toBe(1);
    const panel = bids.slice(bids.indexOf("<DocumentsPanel"));
    expect(panel).toContain('kind="bid"');
    expect(panel).toContain("bidId={documentsFor.id}");
    expect(panel).toContain('recordLabel={documentsFor.name || "Untitled bid"}');
    expect(bids).toContain("setDocumentsFor(null)");
  });
});

describe("the ticket page's Documents icon (Oct 27: the header, not a fold)", () => {
  const actions = read("src/components/service/ticket-header-actions.tsx");
  it("sits in the header to the left of Delete, for the office only (where the fold was); the column has no fold", () => {
    const header = service.slice(
      service.indexOf("{showCloseOut && ("),
      service.indexOf('data-line="tags"'),
    );
    expect(header).toContain("<TicketHeaderActions");
    expect(header).toMatch(
      /documents=\{\s*officeOrAdmin\s*\?\s*\{\s*count: documents\.data\?\.length \?\? null,/,
    );
    expect(header).toMatch(/onOpen: \(\) => setDocumentsOpen\(true\)/);
    expect(header).toMatch(/\{officeOrAdmin && \(\s*<TicketDocumentsDialog\s+job=\{job\}/);
    // The count: the same query the dialog's list reads, only for the office with a saved ticket.
    expect(service).toMatch(
      /const documents = useDocumentsQuery\(\s*\{ serviceJobId: job\?\.id \},\s*\{ enabled: officeOrAdmin && !!job \},?\s*\);/,
    );
    // Documents (FileText) renders before Delete (Trash2) in the component.
    expect(actions.indexOf('aria-label="Documents"')).toBeLessThan(
      actions.indexOf('aria-label="Delete ticket"'),
    );
    const aside = service.slice(
      service.indexOf("<aside className={stacked ? STACKED_ASIDE : SIDE_ASIDE}"),
      service.indexOf("</aside>"),
    );
    expect(aside).toContain('{jobStage !== "done" && <InvoiceBlock job={job} />}');
    expect(aside).not.toMatch(/<TicketDocumentsFold|<DocumentsList|storageKey="documents"/);
    expect(service).not.toContain("TicketDocumentsFold");
    expect(service).toContain("const officeOrAdmin = !isTech;");
    expect(service).toContain("const twoPane = officeOrAdmin && !!job;");
  });
  it("opens a dialog listing the ticket's documents with New document for the ticket", () => {
    const dialog = actions.slice(actions.indexOf("export function TicketDocumentsDialog("));
    expect(dialog).toContain("<DialogTitle>Documents · Ticket #{job.number}</DialogTitle>");
    expect(dialog).toContain(
      "<DocumentsList serviceJobId={job.id} onNew={() => setNewOpen(true)} />",
    );
    // The list's own "New document" button is the only one — no duplicate in the dialog.
    expect((dialog.match(/New document/g) ?? []).length).toBe(0);
    expect(dialog).toContain('kind="ticket"');
    expect(dialog).toContain("serviceJobId={job.id}");
    expect(dialog).toContain("recordLabel={`Ticket ${job.number}`}");
    expect(actions).toContain(
      'import { DocumentsList } from "@/components/documents/documents-panel";',
    );
    expect(actions).toContain(
      'import { NewDocumentDialog } from "@/components/documents/new-document-dialog";',
    );
  });
  it("an inspection ticket gets the one-tap Inspection report button in the dialog — and only there (Oct 28: the copy on the Findings step was a duplicate)", () => {
    const dialog = actions.slice(actions.indexOf("export function TicketDocumentsDialog("));
    expect(dialog).toMatch(
      /\{job\.service_type === "inspection" && \(\s*<InspectionReportButton\s+serviceJobId=\{job\.id\}\s+ticketNumber=\{job\.number\}/,
    );
    expect(actions).toContain(
      'import { InspectionReportButton } from "@/components/documents/inspection-report-button";',
    );
    const closeout = read("src/components/service/closeout.tsx");
    expect(closeout).not.toContain("InspectionReportButton");
    expect(closeout).not.toContain('data-line="inspection-report"');
    // The button itself: the template by name, photos + marks on, no prices, straight to the editor.
    const button = read("src/components/documents/inspection-report-button.tsx");
    expect(button).toContain("findInspectionTemplate(templates)");
    expect(button).toContain("options: INSPECTION_REPORT_OPTIONS");
    expect(INSPECTION_REPORT_OPTIONS).toMatchObject({ prices: "none", photos: true, marks: true });
    expect(
      findInspectionTemplate([
        { id: "a", kind: "bid", name: "Inspection report" },
        { id: "b", kind: "ticket", name: " inspection REPORT " },
      ]),
    ).toMatchObject({ id: "b" });
    expect(
      findInspectionTemplate([{ id: "c", kind: "ticket", name: "Service letter" }]),
    ).toBeNull();
    expect(button).toContain('navigate({ to: "/documents", search: { id: r.id } })');
    expect(button).not.toContain("Dialog");
    expect(button).toContain("Inspection report\n");
  });
});

describe("the customer page's Documents section", () => {
  it("lists every document for the customer across bids and tickets", () => {
    expect(customers).toContain(
      'import { DocumentsList } from "@/components/documents/documents-panel";',
    );
    expect(customers).toContain("<DocumentsSection accountId={id} />");
    const section = customers.slice(customers.indexOf("function DocumentsSection("));
    expect(section).toContain('aria-label="Documents"');
    expect(section).toContain("<DocumentsList accountId={accountId} />");
    // Before the audit history, after the other sections.
    const pane = customers.slice(customers.indexOf("function AccountDetailPane("));
    expect(pane.indexOf("<DocumentsSection")).toBeGreaterThan(pane.indexOf("<TicketsSection"));
    expect(pane.indexOf("<DocumentsSection")).toBeLessThan(pane.indexOf("<AuditHistory"));
  });
});

describe("the opportunity's linked bid", () => {
  it("shows the bid's documents under the bid card, only when a bid is linked", () => {
    expect(opportunities).toContain(
      'import { DocumentsList } from "@/components/documents/documents-panel";',
    );
    const card = opportunities.slice(
      opportunities.indexOf("function BidCard("),
      opportunities.indexOf("function OppCustomerBlock("),
    );
    expect(card).toContain("<DocumentsList bidId={opp.bid_id!} compact />");
    expect(card).toMatch(/Documents\s*<\/h3>/);
    // BidCard itself renders only with a linked bid.
    expect(opportunities).toMatch(/opp\.bid_id \? \(\s*<BidCard opp=\{opp\} \/>/);
    expect((opportunities.match(/<DocumentsList/g) ?? []).length).toBe(1);
  });
});

describe("Admin › Documents", () => {
  it("is the /admin/documents route with the Templates, Saved snippets and PDF library tabs", () => {
    expect(admin).toContain('createFileRoute("/admin/documents")');
    expect(admin).toContain('<TabsTrigger value="templates">Templates</TabsTrigger>');
    expect(admin).toContain('<TabsTrigger value="modules">Saved snippets</TabsTrigger>');
    expect(admin).toContain('<TabsTrigger value="pdfs">PDF library</TabsTrigger>');
    expect(admin).toContain(
      'export const DOCUMENTS_TABS = ["templates", "modules", "pdfs"] as const;',
    );
  });
  it("templates: a table per kind, Edit / Duplicate / Set as default / Delete (confirmed), New template, the empty hint", () => {
    expect(admin).toContain("groupTemplatesByKind(list.data ?? [])");
    expect(admin).toContain("{KIND_TITLES[kind]}");
    expect(admin).toContain("templateEditorHref({ id })");
    expect(admin).toContain("templateEditorHref({ kind: newKind })");
    expect(admin).toContain("duplicate.mutate(t.id)");
    expect(admin).toContain("setDefault.mutate(t.id)");
    expect(admin).toContain("<AlertDialogTitle>Delete this template?</AlertDialogTitle>");
    expect(admin).toContain("New template");
    expect(admin).toContain('data-hint="no-templates"');
    // No "Restore defaults" button: the server seeds a kind with none (the header comment says so).
    expect(admin).not.toMatch(/Restore defaults\s*<\/Button>/);
  });
  it("saved snippets: name, type (MODULE_LABELS), updated; inline Rename and Delete; the editor note", () => {
    expect(admin).toContain("{MODULE_LABELS[m.module.type]}");
    expect(admin).toContain("setRenaming({ id: m.id, name: m.name })");
    expect(admin).toContain("saveFn({ data: { id: m.id, name: m.newName, module: m.module } })");
    expect(admin).toContain("<AlertDialogTitle>Delete this saved snippet?</AlertDialogTitle>");
    expect(admin).toContain("<CardTitle>Saved snippets</CardTitle>");
    expect(flat(admin)).toContain(
      "Pieces of content people keep for reuse — a terms block, a warranty paragraph, a signature. Save one from inside a document: fill in a module, then choose “Save as snippet…” on it. The module kinds themselves (Text, Photo Grid, Repair List …) are always on the editor's Modules tab and need no saving.",
    );
    expect(admin).toContain(
      "No saved snippets yet. Open a document, pick a module and choose “Save as snippet…”.",
    );
  });
  it("PDF library: Upload PDF (PDF only, 20 MB, base64) with a busy state, Delete (confirmed), the Insert PDF hint", () => {
    expect(admin).toContain('accept="application/pdf,.pdf"');
    expect(admin).toContain("pdfUploadProblem(file)");
    expect(admin).toContain("uploadFn({ data: { name: assetNameFromFile(file.name), base64 } })");
    expect(admin).toContain("disabled={uploading !== null}");
    expect(admin).toContain("{formatBytes(a.size_bytes)}");
    expect(admin).toContain(
      "<AlertDialogTitle>Delete this PDF from the library?</AlertDialogTitle>",
    );
    expect(admin).toContain(
      "Insert these into any document from the Insert PDF button under a page (award letters,",
    );
  });
  it("toasts the server's message on every failure", () => {
    const toasts = admin.match(/toast\.error\(`[^`]*\$\{errText\(e\)\}`\)/g) ?? [];
    expect(toasts.length).toBeGreaterThanOrEqual(6);
  });
});

describe("the sidebar and the gate", () => {
  it("lists Documents in the Admin group for managers and admins", () => {
    expect(sidebar).toContain(
      '{ title: "Documents", url: "/admin/documents", icon: Files, adminOnly: false },',
    );
    // The group opens for managers (as Setup does) so the one non-admin item shows.
    expect(sidebar).toContain('{(role === "admin" || managesTickets(profile)) && (');
    expect(sidebar).toContain('.filter((item) => !item.adminOnly || role === "admin")');
    // The three admin-only entries stay the admins'.
    for (const t of ["Owner", "Users & access", "Reminders"])
      expect(sidebar).toMatch(new RegExp(`title: "${t.replace("&", "&")}".*adminOnly: true`));
  });
  it("maps /admin/documents to managers and the editor to every signed-in user", () => {
    expect(pageForPath("/admin/documents")).toBe("manager");
    expect(pageForPath("/admin/documents?tab=pdfs")).toBe("manager");
    expect(pageForPath("/documents")).toBeNull();
    expect(pageForPath("/documents/abc")).toBeNull();
    // The rest of /admin stays Estimate Pricing's.
    expect(pageForPath("/admin/settings")).toBe("pricing");
  });
});

describe("Admin › Settings: the company's website and email", () => {
  it("are edited beside the phone and saved with the row", () => {
    const tab = settings.slice(settings.indexOf("function ContractorTab("));
    expect(tab).toContain('<Field label="Website">');
    expect(tab).toContain('<Field label="Email">');
    expect(tab).toContain('set("website", e.target.value)');
    expect(tab).toContain('set("email", e.target.value)');
    const save = settings.slice(settings.indexOf("function useCompanyDraft("));
    expect(save).toContain("website: c.website,");
    expect(save).toContain("email: c.email,");
  });
});

describe("Saved snippets (owner, Oct 28: 'saved modules' were confused with the module kinds)", () => {
  const route = read("src/routes/documents.tsx");
  const moduleView = read("src/components/documents/editor/module-view.tsx");
  const editorCtx = read("src/components/documents/editor/editor-context.tsx");
  const fns = read("src/lib/documents.functions.ts");
  it("the editor: 'Save as snippet…' on a module, its dialog, its toasts, and the Modules tab's 'Saved snippets' section (the kinds keep 'Modules')", () => {
    expect(moduleView).toContain('title="Save as snippet…"');
    expect(route).toContain('title="Save as snippet"');
    expect(route).toContain('label="Snippet name"');
    expect(route).toContain('toast.success("Snippet saved");');
    expect(route).toContain('<div className="text-sm font-medium">Saved snippets</div>');
    expect(route).toContain('<TabsTrigger value="modules">Modules</TabsTrigger>');
    expect(route).toContain(
      '<AlertDialogTitle>Delete the saved snippet "{pendingDelete?.name}"?</AlertDialogTitle>',
    );
  });
  it("no user-facing 'Saved modules' / 'Save as module' remains; the identifiers and the table do not change", () => {
    for (const src of [admin, route, moduleView, editorCtx, fns]) {
      expect(src).not.toMatch(/Saved modules?\b/);
      expect(src).not.toMatch(/Save as module/);
      expect(src).not.toMatch(/saved modules? (yet|and the PDF)/);
    }
    expect(fns).toContain('.from("document_modules")');
    expect(fns).toContain("export const listSavedModules");
    expect(fns).toContain("export const saveSavedModule");
    expect(admin).toContain("function SavedModulesTab()");
  });
});
