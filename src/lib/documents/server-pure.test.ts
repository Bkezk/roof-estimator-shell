/**
 * The pure half of documents.functions.ts (owner, Oct 26): the bucket's file names, the share
 * link, the stale-save message in the office's zone, what a saved bid looks like to a document,
 * the reserved pricing variable, and the glue around generating.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_OPTIONS, newModule, newPage } from "./model";
import {
  backTo,
  bidFromSavedState,
  bytesFromBase64,
  copyName,
  displayName,
  displayVariables,
  DOCUMENT_SHARE_GONE_TEXT,
  documentAssetPath,
  documentDeletedMessage,
  documentFileName,
  documentImagePath,
  documentPdfPath,
  documentSaveIsStale,
  documentShareGonePage,
  documentShareLogLine,
  documentShareUrl,
  documentStaleMessage,
  isDocumentImagePath,
  isPdfBytes,
  isReservedVariable,
  pagesForNewDocument,
  personOf,
  pickContact,
  poLine,
  pricingSource,
  recordLabel,
  recordProblem,
  SECTIONS_KEY,
  shareOrigin,
  sniffImageType,
  storedPricing,
  withStoredPricing,
} from "./server-pure";
import { pricingRows } from "./variables";

describe("files in the documents bucket", () => {
  it("one PDF per version, library PDFs by id, pictures under the document or the template", () => {
    expect(documentPdfPath("d1", 3)).toBe("docs/d1/v3.pdf");
    expect(documentAssetPath("a1")).toBe("library/a1.pdf");
    expect(documentImagePath({ documentId: "d1" }, "f1", "jpeg")).toBe("docs/d1/f1.jpg");
    expect(documentImagePath({ templateId: "t1" }, "f1", "png")).toBe("docs/template-t1/f1.png");
    expect(documentImagePath({ documentId: "d1", templateId: "t1" }, "f1", "webp")).toBe(
      "docs/d1/f1.webp",
    );
    expect(() => documentImagePath({}, "f1", "png")).toThrow(/document or a template/);
    expect(isDocumentImagePath("docs/d1/f1.jpg")).toBe(true);
    expect(isDocumentImagePath("docs/template-t1/f1.png")).toBe(true);
    expect(isDocumentImagePath("library/a1.pdf")).toBe(false);
    expect(isDocumentImagePath("docs/../x/f1.jpg")).toBe(false);
  });
  it("sniffs jpeg / png / webp from the bytes and nothing else; a PDF by its header", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
    expect(sniffImageType(jpg)).toBe("jpeg");
    expect(sniffImageType(png)).toBe("png");
    expect(sniffImageType(webp)).toBe("webp");
    expect(sniffImageType(heic)).toBeNull();
    expect(sniffImageType(new Uint8Array(3))).toBeNull();
    expect(isPdfBytes(new Uint8Array(Buffer.from("%PDF-1.7\n")))).toBe(true);
    expect(isPdfBytes(png)).toBe(false);
  });
  it("bytesFromBase64 takes plain base64 and a data: URL", () => {
    const b64 = Buffer.from("hello").toString("base64");
    expect(Buffer.from(bytesFromBase64(b64)).toString()).toBe("hello");
    expect(Buffer.from(bytesFromBase64(`data:image/png;base64,${b64}`)).toString()).toBe("hello");
  });
  it("the download's file name is the title made safe", () => {
    expect(documentFileName("Proposal — Whitley County")).toBe("Proposal - Whitley County.pdf");
    expect(documentFileName('a/b:c*d?"e<f>g|h')).toBe("a b c d e f g h.pdf");
    expect(documentFileName("   ")).toBe("Document.pdf");
    expect(documentFileName("x".repeat(100))).toBe(`${"x".repeat(80)}.pdf`);
  });
});

describe("the share link", () => {
  it("is /d/<token> on the origin, APP_URL first, else the request's host", () => {
    expect(documentShareUrl("https://portal.example.com/", "tok")).toBe(
      "https://portal.example.com/d/tok",
    );
    const headers = (h: Record<string, string>) => ({
      get: (k: string) => h[k.toLowerCase()] ?? null,
    });
    expect(shareOrigin("https://app.example.com/", null)).toBe("https://app.example.com");
    expect(shareOrigin("", headers({ host: "preview.lovable.app" }))).toBe(
      "https://preview.lovable.app",
    );
    expect(
      shareOrigin(
        null,
        headers({
          "x-forwarded-host": "jbk.example.com",
          host: "internal",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://jbk.example.com");
    expect(shareOrigin(null, headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(shareOrigin(null, headers({}), "https://x.example.com/api/fn")).toBe(
      "https://x.example.com",
    );
    expect(shareOrigin(null, null)).toBe("");
  });
  it("the gone page and the log line never carry the token", () => {
    expect(documentShareGonePage()).toContain(DOCUMENT_SHARE_GONE_TEXT);
    expect(documentShareGonePage()).toContain('name="robots" content="noindex"');
    expect(documentShareLogLine("served", "Proposal")).toBe(
      'Document share link: "Proposal" — served',
    );
    expect(documentShareLogLine("malformed token")).toBe(
      "Document share link: no document — malformed token",
    );
    expect(documentShareLogLine("failed", null, "boom")).toBe(
      "Document share link: no document — failed (boom)",
    );
  });
});

describe("saving", () => {
  const now = new Date("2026-10-26T18:00:00Z");
  it("the stale message names the saver, the office time, and what to do; another tab of yours says so", () => {
    expect(documentStaleMessage("Brian", "2026-10-26T14:07:00Z", "Braden", now)).toBe(
      "Not saved: Brian saved this document at 10:07 AM after you opened it. Reload it to see that save, then make your changes again.",
    );
    expect(documentStaleMessage("Brian", "2026-10-22T19:07:00Z", "Brian", now)).toContain(
      "you saved this document from another tab at Oct 22 at 3:07 PM",
    );
    expect(documentStaleMessage(null, "2026-10-26T14:07:00Z", null, now)).toContain(
      "someone saved this document",
    );
    expect(documentDeletedMessage("2026-10-26T14:07:00Z", now)).toBe(
      "Not saved: this document was deleted at 10:07 AM. Restore it from the Documents list, then save again — your changes are still here.",
    );
  });
  it("a save is stale when the row's version moved on", () => {
    expect(documentSaveIsStale(3, 3)).toBe(false);
    expect(documentSaveIsStale(3, 4)).toBe(true);
  });
  it("names: the profile's full name, else the email; a copy is '<name> (copy)'", () => {
    expect(displayName({ full_name: " Brandon Keck ", email: "b@x" })).toBe("Brandon Keck");
    expect(displayName({ full_name: "", email: "b@x" })).toBe("b@x");
    expect(displayName(null)).toBeNull();
    expect(copyName("Proposal")).toBe("Proposal (copy)");
    expect(copyName("  ")).toBe("Template (copy)");
  });
});

describe("the record", () => {
  it("exactly one id, matching the kind", () => {
    expect(recordProblem({ kind: "bid", bidId: "b" })).toBeNull();
    expect(recordProblem({ kind: "ticket", serviceJobId: "j" })).toBeNull();
    expect(recordProblem({ kind: "bid", bidId: "b", serviceJobId: "j" })).toMatch(/not both/);
    expect(recordProblem({ kind: "bid", serviceJobId: "j" })).toMatch(/needs its bid/);
    expect(recordProblem({ kind: "ticket", bidId: "b" })).toMatch(/needs its ticket/);
  });
  it("labels and the way back", () => {
    expect(recordLabel("bid", { name: "Whitley" })).toBe("Whitley");
    expect(recordLabel("bid", null)).toBe("Bid");
    expect(recordLabel("ticket", { number: 6012 })).toBe("Ticket 6012");
    expect(recordLabel("ticket", {})).toBe("Ticket");
    expect(backTo("bid", { bidId: "b1", serviceJobId: null })).toEqual({
      to: "/estimate",
      search: { bid: "b1" },
    });
    expect(backTo("ticket", { bidId: null, serviceJobId: "j1" })).toEqual({
      to: "/service",
      search: { id: "j1" },
    });
    expect(backTo("ticket", { bidId: null, serviceJobId: null })).toEqual({
      to: "/documents",
      search: {},
    });
  });
  it("a new document's pages: the template's through the checkboxes; none → one empty page", () => {
    const tpl = [newPage([newModule("body"), newModule("fullPhoto")])];
    const withPhotos = pagesForNewDocument(tpl, DEFAULT_OPTIONS);
    expect(withPhotos[0]!.modules.map((m) => m.type)).toEqual(["body", "fullPhoto"]);
    expect(withPhotos[0]!.id).not.toBe(tpl[0]!.id);
    const without = pagesForNewDocument(tpl, { ...DEFAULT_OPTIONS, photos: false });
    expect(without[0]!.modules.map((m) => m.type)).toEqual(["body"]);
    expect(pagesForNewDocument(null, DEFAULT_OPTIONS)).toHaveLength(1);
    expect(pagesForNewDocument([], DEFAULT_OPTIONS)[0]!.modules).toEqual([]);
  });
});

describe("the saved bid", () => {
  const row = { name: "Whitley", grand_total: 242879.61, due_date: "2026-10-30" };
  it("sections, square feet, the roof system with its mil, the warranty — read leniently", () => {
    const bid = bidFromSavedState(
      {
        roofSystem: "Duro-Last",
        warrantyName: "20 Yr NDL",
        sections: [
          { name: "Main", length: 200, width: 150, thickness: 60 },
          { name: "", length: 50, width: 50, thickness: 60 },
        ],
      },
      row,
    );
    expect(bid.sections).toEqual([
      { name: "Main", lengthFt: 200, widthFt: 150, system: "Duro-Last 60 mil" },
      { name: "Section 2", lengthFt: 50, widthFt: 50, system: "Duro-Last 60 mil" },
    ]);
    expect(bid.sqFt).toBe(32500);
    expect(bid.system).toBe("Duro-Last 60 mil");
    expect(bid.warranty).toBe("20 Yr NDL");
    expect(bid.total).toBe(242879.61);
    expect(bid.dueDate).toBe("2026-10-30");
    expect(bid.name).toBe("Whitley");
  });
  it("mixed mils leave the mil off the system line; garbage gives empty sections", () => {
    const mixed = bidFromSavedState(
      {
        roofSystem: "Duro-Last",
        sections: [
          { thickness: 50, length: 1, width: 1 },
          { thickness: 60, length: 1, width: 1 },
        ],
      },
      row,
    );
    expect(mixed.system).toBe("Duro-Last");
    expect(mixed.sections[0]!.system).toBe("Duro-Last 50 mil");
    const none = bidFromSavedState(null, { ...row, grand_total: null });
    expect(none.sections).toEqual([]);
    expect(none.sqFt).toBeNull();
    expect(none.total).toBeNull();
    expect(none.system).toBe("");
    expect(bidFromSavedState("nonsense", row).sections).toEqual([]);
  });
});

describe("the reserved pricing variable", () => {
  const bid = {
    name: "W",
    total: 1000,
    system: "",
    dueDate: null,
    sections: [{ name: "Main", lengthFt: 100, widthFt: 50, system: "DL 60 mil" }],
    sqFt: 5000,
    warranty: "",
  };
  it("__sections stores the sections and total as JSON; a ticket stores none; old reserved keys are dropped", () => {
    const vars = withStoredPricing({ today: "x", __old: "y" }, bid);
    expect(Object.keys(vars).sort()).toEqual([SECTIONS_KEY, "today"]);
    expect(isReservedVariable(SECTIONS_KEY)).toBe(true);
    expect(isReservedVariable("today")).toBe(false);
    expect(storedPricing(vars)).toEqual({ sections: bid.sections, total: 1000 });
    expect(withStoredPricing({ a: "b" }, null)).toEqual({ a: "b" });
    expect(storedPricing({ a: "b" })).toBeNull();
    expect(storedPricing({ [SECTIONS_KEY]: "{not json" })).toBeNull();
    expect(storedPricing(null)).toBeNull();
  });
  it("pricingSource rebuilds what pricingRows needs; displayVariables hides the reserved keys", () => {
    const vars = withStoredPricing({ today: "x" }, bid);
    expect(pricingRows(pricingSource(vars), "total", true).rows).toEqual([
      ["Main", "50 × 100 ft", "5,000", "DL 60 mil"],
      ["Total", "", "", "$1,000.00"],
    ]);
    expect(pricingRows(pricingSource({}), "total", true).rows).toEqual([["Total", "", "", ""]]);
    expect(displayVariables(vars)).toEqual({ today: "x" });
    expect(displayVariables({ a: 1, b: "c" })).toEqual({ b: "c" });
    expect(displayVariables(null)).toEqual({});
  });
});

describe("the customer", () => {
  it("the first billing contact, else the first; POs joined; a profile as a person", () => {
    const a = { id: "a", is_billing: false };
    const b = { id: "b", is_billing: true };
    expect(pickContact([a, b])).toBe(b);
    expect(pickContact([a])).toBe(a);
    expect(pickContact([])).toBeNull();
    expect(poLine([{ po_number: "4471" }, { po_number: " 4480 " }, { po_number: "" }])).toBe(
      "4471, 4480",
    );
    expect(poLine([], "PO-1")).toBe("PO-1");
    expect(poLine([], null)).toBe("");
    expect(personOf({ full_name: "RoAnna Sims", email: "r@x" }, "(606) 523-9000")).toEqual({
      name: "RoAnna Sims",
      email: "r@x",
      phone: "(606) 523-9000",
    });
    expect(personOf(null, "")).toBeNull();
  });
});
