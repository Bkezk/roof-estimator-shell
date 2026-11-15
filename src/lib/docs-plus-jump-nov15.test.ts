/**
 * Owner, Nov 15: "if you click the plus to add a module the preview jumps to where the module
 * is added".
 *
 * The + adds a module to the bottom of the selected page. The canvas then went to the TOP of
 * that page, so on a long page the new module was out of sight. Now it goes to the module
 * itself and marks it for a moment.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync("src/components/documents/editor-screen.tsx", "utf8");
const dom = readFileSync("src/components/documents/editor/editor-dom.ts", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("the + on a module tile or a saved snippet", () => {
  const add = screen.slice(
    screen.indexOf("const addToSelected = (m: DocModule) => {"),
    screen.indexOf("/** A page snippet: a NEW page right after the selected one"),
  );
  it("goes to the new module, not to the top of its page", () => {
    expect(add).toContain("window.setTimeout(() => revealModule(m.id), 60);");
    expect(add).not.toContain("scrollToPage");
  });
  it("still adds to the bottom of the selected page and closes the phone's Tools sheet", () => {
    expect(add).toContain("setToolsOpen(false);");
    expect(add).toContain('dispatch({ type: "setPages", op: (pages) => addModule(pages, i, m) });');
  });
  it("both kinds of + use it: a new module and a copy of a saved snippet", () => {
    expect(screen).toContain("onAdd={(type) => addToSelected(newModule(type))}");
    expect(screen).toContain("onAddSaved={(m) => addToSelected(cloneModule(m))}");
  });
  it("a page snippet still goes to its new page", () => {
    expect(screen).toContain("window.setTimeout(() => scrollToPage(r.pageId), 80);");
  });
});

describe("showing the new module", () => {
  const fn = dom.slice(dom.indexOf("export function revealModule"));
  it("brings it to the middle of the canvas", () => {
    expect(fn).toContain('el.scrollIntoView({ behavior: "smooth", block: "center" });');
  });
  it("waits for it to be drawn, for about a second", () => {
    expect(dom).toContain("export function revealModule(moduleId: string, tries = 12) {");
    expect(fn).toContain(
      "if (tries > 0) window.setTimeout(() => revealModule(moduleId, tries - 1), 80);",
    );
  });
  it("follows it when the page is laid out again and moves it to another sheet", () => {
    expect(fn).toContain("if (again && again !== el) show(again);");
  });
  it("marks it, and takes the mark off again", () => {
    expect(dom).toContain('export const JUST_ADDED_ATTR = "data-just-added";');
    expect(dom).toContain("export const JUST_ADDED_MS = 1600;");
    expect(fn).toContain('el.setAttribute(JUST_ADDED_ATTR, "");');
    expect(fn).toContain(
      "window.setTimeout(() => el.removeAttribute(JUST_ADDED_ATTR), JUST_ADDED_MS);",
    );
  });
  it("the drop of a dragged module is as it was: it lands under the pointer", () => {
    expect(dom).toContain('?.scrollIntoView({ behavior: "smooth", block: "nearest" });');
  });
});

describe("the mark", () => {
  it("is an outline on screens only, never part of a printed or saved document", () => {
    expect(css).toMatch(
      /@media screen \{\s*\[data-just-added\] \{\s*outline: 2px solid var\(--primary\);\s*outline-offset: 3px;\s*border-radius: 2px;\s*\}\s*\}/,
    );
    expect(css).not.toMatch(/@media print[^}]*data-just-added/);
  });
});
