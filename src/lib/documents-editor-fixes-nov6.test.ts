/**
 * The Documents editor fixes of Nov 6 (owner: "Fix 1, 2, 3 … 8"): edits no longer lost on a
 * sidebar click (1), Undo / Redo with "deleted — Undo" toasts (2), the editor usable on a phone
 * (3), and the Document tab's duplicated buttons gone (8). Each pin reads the source so a
 * revert fails here; the reducer's undo is exercised directly.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  addModule,
  DEFAULT_OPTIONS,
  type DocPage,
  newModule,
  newPage,
  removeModule,
  removePage,
} from "@/lib/documents/model";
import {
  editorReducer,
  EMPTY_EDITOR,
  HISTORY_MAX,
  type EditorState,
} from "@/components/documents/editor/editor-state";

const read = (p: string) => readFileSync(p, "utf8");
const route = read("src/routes/documents.tsx");
const moduleView = read("src/components/documents/editor/module-view.tsx");
const richText = read("src/components/documents/editor/rich-text.tsx");
const canvas = read("src/components/documents/editor/page-canvas.tsx");

const pages = (): DocPage[] => [
  newPage([newModule("letterhead"), newModule("hr"), newModule("body")]),
  newPage([newModule("body")]),
];
const loaded = (): EditorState =>
  editorReducer(EMPTY_EDITOR, {
    type: "load",
    doc: { title: "Proposal", pages: pages(), options: { ...DEFAULT_OPTIONS } },
  });

describe("1. leaving the editor with unsaved edits asks", () => {
  it("the shell blocks in-app navigation while dirty (Save and leave / Leave without saving / Stay); the Back button no longer confirm()s", () => {
    expect(route).toContain("useBlocker({");
    expect(route).toContain("shouldBlockFn: () => dirtyRef.current,");
    expect(route).toContain("enableBeforeUnload: () => dirtyRef.current,");
    expect(route).toContain("Leave without saving?");
    expect(route).toContain(">Stay</AlertDialogCancel>");
    expect(route).toContain("Leave without saving\n");
    expect(route).toContain("Save and leave");
    expect(route).toContain("const ok = await props.onSaveAsync();");
    expect(route).not.toContain("window.confirm(");
    expect(route).not.toContain("useLeaveGuard");
    // Both editors hand the shell an awaited save.
    expect(route.match(/onSaveAsync=\{saveAsync\}/g)).toHaveLength(2);
  });
});

describe("2. undo and redo", () => {
  it("a deleted module comes back with Undo, goes again with Redo", () => {
    const s = loaded();
    const hr = s.pages[0]!.modules[1]!;
    const del = editorReducer(s, { type: "setPages", op: (p) => removeModule(p, hr.id) });
    expect(del.pages[0]!.modules).toHaveLength(2);
    expect(del.past).toHaveLength(1);
    const back = editorReducer(del, { type: "undo" });
    expect(back.pages).toBe(s.pages);
    expect(back.dirty).toBe(false);
    expect(back.future).toHaveLength(1);
    const again = editorReducer(back, { type: "redo" });
    expect(again.pages).toBe(del.pages);
    expect(again.dirty).toBe(true);
    // Nothing to undo: the same state.
    expect(editorReducer(s, { type: "undo" })).toBe(s);
    expect(editorReducer(s, { type: "redo" })).toBe(s);
  });
  it("typing in one text box is one step however many keystrokes; a keystroke in another box is a new step", () => {
    const s = loaded();
    const body = s.pages[0]!.modules[2]!;
    const other = s.pages[1]!.modules[0]!;
    const type = (st: EditorState, id: string, n: number) =>
      editorReducer(st, {
        type: "setPages",
        op: (p) => p.map((pg) => ({ ...pg, modules: pg.modules.map((m) => ({ ...m, n })) })),
        text: id,
      });
    let st = type(s, body.id, 1);
    st = type(st, body.id, 2);
    st = type(st, body.id, 3);
    expect(st.past).toHaveLength(1);
    st = type(st, other.id, 4);
    expect(st.past).toHaveLength(2);
    // Undo takes the whole typing in the second box back, then the first box's.
    const u1 = editorReducer(st, { type: "undo" });
    expect(u1.past).toHaveLength(1);
    const u2 = editorReducer(u1, { type: "undo" });
    expect(u2.pages).toBe(s.pages);
  });
  it("options and Start over are steps; a new change after an undo drops the redo; load clears the history; the stack is capped", () => {
    const s = loaded();
    const opt = editorReducer(s, { type: "setOptions", patch: { footer: false } });
    expect(opt.past).toHaveLength(1);
    const back = editorReducer(opt, { type: "undo" });
    expect(back.options.footer).toBe(true);
    expect(back.future).toHaveLength(1);
    const forked = editorReducer(back, {
      type: "setPages",
      op: (p) => addModule(p, 0, newModule("signature")),
    });
    expect(forked.future).toHaveLength(0);
    const over = editorReducer(forked, {
      type: "startOver",
      pages: [newPage()],
      template: { id: "t", name: "T" },
    });
    expect(over.past).toHaveLength(forked.past.length + 1);
    expect(
      editorReducer(over, {
        type: "load",
        doc: { title: "x", pages: pages(), options: DEFAULT_OPTIONS },
      }).past,
    ).toEqual([]);
    let st = s;
    for (let i = 0; i < HISTORY_MAX + 20; i++)
      st = editorReducer(st, { type: "setPages", op: (p) => addModule(p, 0, newModule("hr")) });
    expect(st.past).toHaveLength(HISTORY_MAX);
  });
  it("an op that changes nothing is not a step", () => {
    const s = loaded();
    expect(editorReducer(s, { type: "setPages", op: (p) => p as DocPage[] })).toBe(s);
  });
  it("the editor: Undo / Redo buttons, Ctrl+Z outside text boxes and inputs, the toasts with Undo on a module and a page delete, the text box following a changed value", () => {
    expect(route).toContain('title="Undo (Ctrl+Z)"');
    expect(route).toContain('title="Redo (Ctrl+Shift+Z)"');
    expect(route).toContain("disabled={state.past.length === 0}");
    expect(route).toContain("disabled={state.future.length === 0}");
    expect(route).toContain("if (inOwnUndoField(e.target)) return;");
    expect(route).toContain('dispatch({ type: k === "y" || e.shiftKey ? "redo" : "undo" });');
    expect(route).toContain('if (target.closest(".ProseMirror")) return true;');
    expect(route).toContain("toast(`Page ${i + 1} deleted`, {");
    expect(route).toContain("onClick: () => op((p) => addPage(p, i, page)),");
    expect(moduleView).toContain("toast(`${MODULE_LABELS[m.type]} deleted`, {");
    expect(moduleView).toContain("addModule(p, pageIndex, m, index)");
    expect(canvas).toContain("pageIndex={props.index}");
    // Keystrokes are tagged with the module, so one box is one step.
    expect(moduleView.match(/as DocModule, true\)\}/g)?.length).toBeGreaterThanOrEqual(6);
    expect(richText).toContain(
      "editor.commands.setContent(props.value as unknown as JSONContent, { emitUpdate: false });",
    );
    expect(richText).toContain("lastJson.current = JSON.stringify(json);");
  });
  it("a page delete is restored where it was", () => {
    const s = loaded();
    const page = s.pages[0]!;
    const del = editorReducer(s, { type: "setPages", op: (p) => removePage(p, page.id) });
    expect(del.pages).toHaveLength(1);
    const back = editorReducer(del, {
      type: "setPages",
      op: (p) => [...p.slice(0, 0), page, ...p.slice(0)],
    });
    expect(back.pages.map((p) => p.id)).toEqual(s.pages.map((p) => p.id));
  });
});

describe("3. the editor on a phone", () => {
  it("the panel's tabs open from a Tools button in a sheet below md; adding a module closes it", () => {
    expect(route).toContain('className="md:hidden"');
    expect(route).toContain("Tools\n");
    expect(route).toContain("<Sheet open={toolsOpen} onOpenChange={setToolsOpen}>");
    expect(route).toContain('className="w-full overflow-y-auto p-0 sm:max-w-md md:hidden"');
    expect(route.match(/\{panelTabs\}/g)).toHaveLength(2);
    expect(route).toContain("const addToSelected = (m: DocModule) => {\n    setToolsOpen(false);");
  });
  it("a tap shows a module's toolbar (focus-within, the module focusable); the sheet never shrinks below 3/4 and the canvas scrolls sideways", () => {
    expect(moduleView).toContain("group-focus-within/module:flex group-hover/module:flex");
    expect(moduleView).toContain("tabIndex={-1}");
    expect(read("src/lib/documents/editor-helpers.ts")).toContain(
      "export const SHEET_SCALE_MIN = 0.75;",
    );
    expect(canvas).toContain('className="min-h-full overflow-x-auto bg-muted/40 px-4 py-4"');
  });
});

describe("8. no duplicated buttons on the Document tab", () => {
  it("Save Template As, Manage Templates and Revisions live in the Save menu only", () => {
    const tab = route.slice(
      route.indexOf("function DocumentTab("),
      route.indexOf("function StartOverPicker("),
    );
    expect(tab).not.toContain("Save Template As");
    expect(tab).not.toContain("Manage Templates");
    expect(tab).not.toContain("Revisions");
    const menu = route.slice(
      route.indexOf('title="More ways to save"'),
      route.indexOf("{props.headerExtra}"),
    );
    expect(menu).toContain("Save Template As…");
    expect(menu).toContain("Revisions…");
    expect(menu).toContain("Manage Templates");
  });
});
