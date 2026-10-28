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
  applyStartOver,
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
  // Oct 28: this pinned Marks off flipping the ticket photo's flag in the pages (and, through
  // stripMarks, deleting an upload's drawn marks). Photos and Marks are view switches now.
  it("marks and photos leave the pages alone (same array): the renderer hides, nothing is removed", () => {
    const photo = {
      ...newModule("fullPhoto"),
      image: { kind: "ticketPhoto" as const, photoId: "p1", marks: true },
    };
    const s0 = loaded([newPage([photo])]);
    const s = editorReducer(s0, { type: "setOptions", patch: { marks: false, photos: false } });
    expect(s.pages).toBe(s0.pages);
    expect(s.pages[0]!.modules[0]).toMatchObject({ image: { marks: true } });
    expect(s.options).toMatchObject({ marks: false, photos: false });
    expect(s.dirty).toBe(true);
    const back = editorReducer(s, { type: "setOptions", patch: { marks: true, photos: true } });
    expect(back.pages).toBe(s0.pages);
    expect(back.dirty).toBe(false);
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
      templateId: null,
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

describe("start over from a template (Oct 28: the label and the saved template_id follow the pick)", () => {
  const tpl = { id: "t2", name: "Inspection report" };
  it("applyStartOver replaces the pages and the template they come from; the selection follows; dirty", () => {
    const s = loaded();
    const pages = [newPage([newModule("body")])];
    const next = applyStartOver(s, pages, tpl);
    expect(next.pages).toBe(pages);
    expect(next.template).toEqual(tpl);
    expect(next.selectedPageId).toBe(pages[0]!.id);
    expect(next.dirty).toBe(true);
    expect(next.saved).toBe(s.saved);
    expect(next.title).toBe(s.title);
  });
  it("load carries the document's template (none for a blank document or a template); startOver is the reducer's", () => {
    const s = editorReducer(EMPTY_EDITOR, {
      type: "load",
      doc: { title: "Proposal", pages: twoPages(), options: { ...DEFAULT_OPTIONS } },
      template: { id: "t1", name: "Proposal — standard" },
    });
    expect(s.template).toEqual({ id: "t1", name: "Proposal — standard" });
    expect(loaded().template).toBeNull();
    const pages = [newPage([newModule("body")])];
    const next = editorReducer(s, { type: "startOver", pages, template: tpl });
    expect(next).toEqual(applyStartOver(s, pages, tpl));
    expect(next.template?.name).toBe("Inspection report");
  });
  it("buildSavePayload sends the template the pages come from now (null for blank)", () => {
    const s = loaded();
    expect(buildSavePayload(s, "doc1", 1).templateId).toBeNull();
    const next = applyStartOver(s, [newPage()], tpl);
    expect(buildSavePayload(next, "doc1", 1).templateId).toBe("t2");
  });
});
