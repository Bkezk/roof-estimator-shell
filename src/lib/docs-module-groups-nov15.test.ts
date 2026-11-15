/**
 * Owner, Nov 15: "I'd like to have the modules grouped by type under headers such as text,
 * pictures, etc (please make some suggestions for this before implementation)". Of three
 * mock-ups the owner picked "Option A": five headers, always open. The names "are good", and
 * Photo on left / Photo on right belong under Pictures ("yes that's correct").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MODULE_GROUPS, MODULE_LABELS, MODULE_TILES } from "./documents/model";

const screen = readFileSync("src/components/documents/editor-screen.tsx", "utf8");
const names = (label: string) =>
  MODULE_GROUPS.find((g) => g.label === label)!.types.map((t) => MODULE_LABELS[t]);

describe("the five headers the owner picked", () => {
  it("in this order", () => {
    expect(MODULE_GROUPS.map((g) => g.label)).toEqual([
      "Text",
      "Pictures",
      "Tables and prices",
      "Service",
      "Page parts",
    ]);
  });
  it("Text", () => {
    expect(names("Text")).toEqual(["Body", "Two columns"]);
  });
  it("Pictures, with Photo on left and Photo on right", () => {
    expect(names("Pictures")).toEqual([
      "Full Photo",
      "Two photos",
      "Photo on left",
      "Photo on right",
      "Photo Grid",
    ]);
  });
  it("Tables and prices", () => {
    expect(names("Tables and prices")).toEqual(["Full Table", "Pricing Table", "Price lines"]);
  });
  it("Service", () => {
    expect(names("Service")).toEqual(["Repair List", "Checklist item"]);
  });
  it("Page parts", () => {
    expect(names("Page parts")).toEqual(["Letterhead", "Signature", "Horizontal Line"]);
  });
});

describe("no module is lost or shown twice", () => {
  const all = MODULE_GROUPS.flatMap((g) => g.types);
  it("every tile is under exactly one header", () => {
    expect(all).toHaveLength(MODULE_TILES.length);
    expect([...all].sort()).toEqual([...MODULE_TILES].sort());
    expect(new Set(all).size).toBe(all.length);
  });
  it("an inserted PDF still comes from Import document, not from a tile", () => {
    expect(all).not.toContain("pdf");
  });
});

describe("the Modules tab", () => {
  const tab = screen.slice(
    screen.indexOf("{MODULE_GROUPS.map((group) => ("),
    screen.indexOf('<div className="text-sm font-medium">Saved snippets</div>'),
  );
  it("shows each group under its header, always open", () => {
    expect(tab).toContain("data-module-group={group.label}");
    expect(tab).toContain("{group.label}");
    expect(tab).not.toMatch(/Collapsible|Accordion|useState/);
  });
  it("a tile is what it was: it drags onto a page and its + adds to the selected page", () => {
    expect(tab).toContain("e.dataTransfer.setData(MODULE_DRAG_TYPE, type);");
    expect(tab).toContain("title={`${MODULE_LABELS[type]} — drag onto a page`}");
    expect(tab).toContain("title={`Add ${MODULE_LABELS[type]} to the selected page`}");
    expect(tab).toContain("onClick={() => props.onAdd(type)}");
  });
  it("two tiles to a row, as before", () => {
    expect(tab).toContain('<div className="grid grid-cols-2 gap-2">');
  });
  it("the saved snippets stay below the groups", () => {
    expect(screen.indexOf("Saved snippets</div>")).toBeGreaterThan(
      screen.indexOf("{MODULE_GROUPS.map((group) => ("),
    );
  });
});
