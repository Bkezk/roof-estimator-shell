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

const read = (p: string) => readFileSync(p, "utf8");
const estimate = read("src/routes/estimate.tsx");
const bids = read("src/routes/bids.tsx");
const service = read("src/components/service-page.tsx");
const customers = read("src/components/customers-page.tsx");
const opportunities = read("src/components/opportunities-page.tsx");
const admin = read("src/routes/admin.documents.tsx");
const sidebar = read("src/components/app-sidebar.tsx");
const settings = read("src/routes/admin.settings.tsx");

describe("the estimator's Documents button", () => {
  it("sits in the header row after Save, before Update Pricing & Labor, enabled once the bid is saved", () => {
    const save = estimate.indexOf('{saving ? "Saving…" : bidId ? "Save" : "Save bid"}');
    const docs = estimate.indexOf('"Documents for this bid: proposals and letters"');
    const update = estimate.indexOf('frmHome.btnUpdate ("Update Pricing & Labor")');
    expect(save).toBeGreaterThan(0);
    expect(docs).toBeGreaterThan(save);
    expect(update).toBeGreaterThan(docs);
    const button = estimate.slice(estimate.lastIndexOf("<Button", docs), docs);
    expect(button).toContain("disabled={!bidId}");
    expect(button).toContain("setDocumentsOpen(true)");
    // Icon only with a label (owner, Oct 26: "i dont like how this now takes two lines").
    expect(estimate).toContain('size="icon"\n            onClick={() => setDocumentsOpen(true)}');
    expect(estimate).toContain('aria-label="Documents"');
    expect(estimate).toContain('<FileText className="h-4 w-4" />');
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

describe("the ticket page's Documents fold", () => {
  it("is in the office's column next to the Invoice fold, never on a technician's page", () => {
    const aside = service.slice(
      service.indexOf("<aside className={stacked ? STACKED_ASIDE : SIDE_ASIDE}"),
      service.indexOf("</aside>"),
    );
    expect(aside).toContain('{jobStage !== "done" && <InvoiceBlock job={job} />}');
    expect(aside).toContain("<TicketDocumentsFold job={job} />");
    // The aside is the two-pane layout, which is the office's (officeOrAdmin = !isTech).
    expect(service).toContain("const officeOrAdmin = !isTech;");
    expect(service).toContain("const twoPane = officeOrAdmin && !!job;");
    expect(service).toMatch(/\{twoPane && job \? \(/);
    // The one-column branch (a technician) has no fold.
    const oneColumn = service.slice(
      service.indexOf("</aside>"),
      service.indexOf("</FoldAllContext.Provider>"),
    );
    expect(oneColumn).not.toContain("TicketDocumentsFold");
  });
  it("lists the ticket's documents compactly and opens New document for the ticket", () => {
    const fold = service.slice(service.indexOf("function TicketDocumentsFold("));
    expect(fold).toContain(
      "<DocumentsList serviceJobId={job.id} compact onNew={() => setNewOpen(true)} />",
    );
    expect(fold).toContain("New document");
    expect(fold).toContain('kind="ticket"');
    expect(fold).toContain("serviceJobId={job.id}");
    expect(fold).toContain("recordLabel={recordLabel}");
    expect(fold).toContain("const recordLabel = `Ticket ${job.number}`;");
    expect(fold).toContain('title="Documents"');
    expect(service).toContain('import { Box } from "@/components/service/field-shared";');
    expect(service).toContain(
      'import { DocumentsList } from "@/components/documents/documents-panel";',
    );
    expect(service).toContain(
      'import { NewDocumentDialog } from "@/components/documents/new-document-dialog";',
    );
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
  it("is the /admin/documents route with the Templates, Saved modules and PDF library tabs", () => {
    expect(admin).toContain('createFileRoute("/admin/documents")');
    expect(admin).toContain('<TabsTrigger value="templates">Templates</TabsTrigger>');
    expect(admin).toContain('<TabsTrigger value="modules">Saved modules</TabsTrigger>');
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
  it("saved modules: name, type (MODULE_LABELS), updated; inline Rename and Delete; the editor note", () => {
    expect(admin).toContain("{MODULE_LABELS[m.module.type]}");
    expect(admin).toContain("setRenaming({ id: m.id, name: m.name })");
    expect(admin).toContain("saveFn({ data: { id: m.id, name: m.newName, module: m.module } })");
    expect(admin).toContain("<AlertDialogTitle>Delete this saved module?</AlertDialogTitle>");
    expect(admin).toMatch(/saved from inside the editor \(“Save as module…” on any module\)/);
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
