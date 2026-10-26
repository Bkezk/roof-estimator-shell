/**
 * The Documents editor's reducer: loading, title and page edits, the options checkboxes applied
 * to the pages, page selection, the dirty flag against the saved copy, and the save payloads.
 */
import { describe, expect, it } from "vitest";

import {
  addModule,
  addPage,
  DEFAULT_OPTIONS,
  type DocPage,
  newModule,
  newPage,
  type PricingTableModule,
  removePage,
} from "@/lib/documents/model";

import {
  buildSavePayload,
  buildTemplatePayload,
  type EditorDoc,
  editorReducer,
  EMPTY_EDITOR,
  isDirty,
  selectedPageIndex,
} from "./editor-state";

const twoPages = (): DocPage[] => [
  newPage([newModule("letterhead"), newModule("pricingTable")]),
  newPage([newModule("body")]),
];
const loaded = (pages = twoPages()) =>
  editorReducer(EMPTY_EDITOR, {
    type: "load",
    doc: { title: "Proposal — 4344", pages, options: { ...DEFAULT_OPTIONS } },
  });

describe("load", () => {
  it("takes the server's copy as the saved one, clean, first page selected", () => {
    const s = loaded();
    expect(s.dirty).toBe(false);
    expect(s.saved?.title).toBe("Proposal — 4344");
    expect(s.selectedPageId).toBe(s.pages[0]!.id);
  });
  it("a document with no pages gets one empty page so there is somewhere to type", () => {
    const s = loaded([]);
    expect(s.pages).toHaveLength(1);
    expect(s.pages[0]!.modules).toEqual([]);
    expect(s.dirty).toBe(false);
  });
  it("keeps the selection when the reloaded copy still has that page", () => {
    const pages = twoPages();
    let s = loaded(pages);
    s = editorReducer(s, { type: "selectPage", pageId: pages[1]!.id });
    s = editorReducer(s, {
      type: "load",
      doc: { title: "x", pages, options: { ...DEFAULT_OPTIONS } },
    });
    expect(s.selectedPageId).toBe(pages[1]!.id);
  });
});

describe("edits and dirty", () => {
  it("the title", () => {
    let s = loaded();
    s = editorReducer(s, { type: "setTitle", title: "Proposal — 4344 rev B" });
    expect(s.dirty).toBe(true);
    s = editorReducer(s, { type: "setTitle", title: "Proposal — 4344" });
    expect(s.dirty).toBe(false);
  });
  it("a page operation", () => {
    let s = loaded();
    s = editorReducer(s, { type: "setPages", op: (p) => addPage(p) });
    expect(s.pages).toHaveLength(3);
    expect(s.dirty).toBe(true);
  });
  it("a module added to the selected page", () => {
    let s = loaded();
    s = editorReducer(s, { type: "selectPage", pageId: s.pages[1]!.id });
    const i = selectedPageIndex(s);
    expect(i).toBe(1);
    s = editorReducer(s, { type: "setPages", op: (p) => addModule(p, i, newModule("hr")) });
    expect(s.pages[1]!.modules.map((m) => m.type)).toEqual(["body", "hr"]);
  });
  it("markSaved makes the current copy the saved one", () => {
    let s = loaded();
    s = editorReducer(s, { type: "setTitle", title: "B" });
    s = editorReducer(s, { type: "markSaved" });
    expect(s.dirty).toBe(false);
    expect(s.saved?.title).toBe("B");
  });
  it("selecting a page that no longer exists falls back to the first", () => {
    let s = loaded();
    const second = s.pages[1]!.id;
    s = editorReducer(s, { type: "selectPage", pageId: second });
    s = editorReducer(s, { type: "setPages", op: (p) => removePage(p, second) });
    expect(s.selectedPageId).toBe(s.pages[0]!.id);
    s = editorReducer(s, { type: "selectPage", pageId: "nope" });
    expect(s.selectedPageId).toBe(s.pages[0]!.id);
  });
});

describe("options", () => {
  it("flipping prices applies to every pricing table at once; the text is kept", () => {
    const s0 = loaded();
    const s = editorReducer(s0, { type: "setOptions", patch: { prices: "none" } });
    const pt = s.pages[0]!.modules[1] as PricingTableModule;
    expect(pt.mode).toBe("none");
    // The body module is untouched (the very same object).
    expect(s.pages[1]!.modules[0]).toBe(s0.pages[1]!.modules[0]);
    expect(s.dirty).toBe(true);
  });
  it("footer and page break leave the pages alone (same array)", () => {
    const s0 = loaded();
    const s = editorReducer(s0, { type: "setOptions", patch: { footer: false, pageBreakIn: 7 } });
    expect(s.pages).toBe(s0.pages);
    expect(s.options.footer).toBe(false);
    expect(s.options.pageBreakIn).toBe(7);
    expect(s.dirty).toBe(true);
  });
  it("marks off strips the marks from ticket photos", () => {
    const photo = {
      ...newModule("fullPhoto"),
      image: { kind: "ticketPhoto" as const, photoId: "p1", marks: true },
    };
    let s = loaded([newPage([photo])]);
    s = editorReducer(s, { type: "setOptions", patch: { marks: false } });
    expect(s.pages[0]!.modules[0]).toMatchObject({ image: { marks: false } });
  });
});

describe("isDirty", () => {
  const doc: EditorDoc = { title: "t", pages: twoPages(), options: { ...DEFAULT_OPTIONS } };
  it("nothing saved yet is never dirty", () => {
    expect(isDirty(null, doc)).toBe(false);
  });
  it("compares title, options and pages deeply", () => {
    expect(isDirty(doc, { ...doc, pages: JSON.parse(JSON.stringify(doc.pages)) })).toBe(false);
    expect(isDirty(doc, { ...doc, options: { ...doc.options, footer: false } })).toBe(true);
    expect(isDirty(doc, { ...doc, pages: [...doc.pages].reverse() })).toBe(true);
  });
});

describe("payloads", () => {
  it("buildSavePayload carries the version the tab opened and never a blank title", () => {
    const s = loaded();
    expect(buildSavePayload(s, "doc1", 4)).toEqual({
      id: "doc1",
      title: "Proposal — 4344",
      pages: s.pages,
      options: s.options,
      expectVersion: 4,
    });
    expect(buildSavePayload({ ...s, title: "   " }, "doc1", 1).title).toBe("Untitled document");
  });
  it("buildTemplatePayload: the title box is the name; no id key for a new template", () => {
    const s = loaded();
    const p = buildTemplatePayload(s, { kind: "bid", description: " Cover + letter " });
    expect(p).toEqual({
      kind: "bid",
      name: "Proposal — 4344",
      description: "Cover + letter",
      pages: s.pages,
      options: s.options,
    });
    expect("id" in p).toBe(false);
    expect(buildTemplatePayload(s, { id: "t1", kind: "ticket", description: "" }).id).toBe("t1");
  });
});
