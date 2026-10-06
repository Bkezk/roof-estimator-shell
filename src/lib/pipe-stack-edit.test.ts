/**
 * Owner, Oct 6: pipe stacks default to OPEN on PlanSwift imports unless the row says closed; the
 * bid's Pipe Stacks screen gets an Edit button beside Remove (Open / Closed, size, quantity,
 * colour), and an edited row prices exactly as a freshly added row with the same values would.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { PipeStackEntry } from "@/lib/engine/accessories";
import { classifyRows } from "@/lib/planswift/classify";
import { readPlanSwiftWorkbook } from "@/lib/planswift/parse";
import { planSwiftSeed } from "@/lib/planswift/to-seed";
import { applyPipeStackEdit, pipeStackEditProblem, pipeStackOpenFromName } from "./pipe-stack-edit";

const SIZES = [
  { size: 1, label: '1"', closedOnly: false },
  { size: 2, label: '2"', closedOnly: false },
  { size: 4, label: '4"', closedOnly: false },
  { size: 8, label: '8" Closed only', closedOnly: true },
];
const row: PipeStackEntry & { takeoffObjectId?: string } = {
  id: "planswift-pipe-1",
  usage: "Hot Stack",
  color: "White",
  open: true,
  size: 2,
  quantity: 3,
  adjustPct: 10,
  takeoffObjectId: "planswift-row-10",
};

describe("applyPipeStackEdit", () => {
  it("changes only the four editable fields; id, usage, labor % and the takeoff link stay", () => {
    const out = applyPipeStackEdit(row, { open: false, size: 4, quantity: 5, color: "Tan" }, SIZES);
    expect(out).toEqual({ ...row, open: false, size: 4, quantity: 5, color: "Tan" });
    expect(out.id).toBe("planswift-pipe-1");
    expect(out.adjustPct).toBe(10);
    expect(out.usage).toBe("Hot Stack");
    expect(out.takeoffObjectId).toBe("planswift-row-10");
  });
  it("a partial edit keeps the rest", () => {
    expect(applyPipeStackEdit(row, { quantity: 7 }, SIZES)).toEqual({ ...row, quantity: 7 });
    expect(applyPipeStackEdit(row, {}, SIZES)).toEqual(row);
  });
  it("a closed-only size forces Closed, as the entry form does", () => {
    expect(applyPipeStackEdit(row, { size: 8, open: true }, SIZES).open).toBe(false);
    expect(applyPipeStackEdit({ ...row, size: 8, open: false }, { size: 2 }, SIZES).open).toBe(
      false,
    );
    expect(
      applyPipeStackEdit({ ...row, size: 8, open: false }, { size: 2, open: true }, SIZES).open,
    ).toBe(true);
  });
  it("prices as a fresh row would: the engine reads only usage, color, open, size, quantity, adjustPct", () => {
    // What Save on the entry form would push for the same choices, with this row's id and labor %.
    const fresh: PipeStackEntry = {
      id: row.id,
      usage: row.usage,
      color: "Gray",
      open: false,
      size: 4,
      quantity: 2,
      adjustPct: row.adjustPct,
    };
    const edited = applyPipeStackEdit(
      row,
      { color: "Gray", open: false, size: 4, quantity: 2 },
      SIZES,
    );
    const priced = (p: PipeStackEntry) => ({
      usage: p.usage,
      color: p.color,
      open: p.open,
      size: p.size,
      quantity: p.quantity,
      adjustPct: p.adjustPct,
    });
    expect(priced(edited)).toEqual(priced(fresh));
  });
  it("the edit's Save rule: a whole quantity above 0 and a known size", () => {
    expect(pipeStackEditProblem({ quantity: 2, size: 2 }, SIZES)).toBeNull();
    expect(pipeStackEditProblem({ quantity: 0, size: 2 }, SIZES)).toBe("Quantity must be above 0");
    expect(pipeStackEditProblem({ quantity: 1.5, size: 2 }, SIZES)).toBe(
      "Quantity must be a whole number",
    );
    expect(pipeStackEditProblem({ quantity: 2, size: 3 }, SIZES)).toBe("Pick a size");
  });
});

describe("PlanSwift pipe stacks are open unless the row says closed", () => {
  it("by name", () => {
    expect(pipeStackOpenFromName('4" Stack')).toBe(true);
    expect(pipeStackOpenFromName('3" Closed Stack')).toBe(false);
    expect(pipeStackOpenFromName('2" stack (closed)')).toBe(false);
    expect(pipeStackOpenFromName('Enclosed vent 2"')).toBe(true); // "enclosed" is not "closed"
  });
  it("the owner's file: both stacks import open", async () => {
    const bytes = readFileSync(
      fileURLToPath(new URL("./planswift/fixtures/monticello.xlsx", import.meta.url)),
    );
    const sheet = await readPlanSwiftWorkbook(new Uint8Array(bytes));
    const cs = classifyRows(sheet.rows);
    const seed = planSwiftSeed(
      sheet,
      cs.map((c) => ({ row: c, target: c.target })),
      { fileName: "Monicello Banking Company 2026.xlsx" },
    );
    expect(seed.pipeStacks.map((p) => [p.size, p.quantity, p.open])).toEqual([
      [4, 1, true],
      [2, 1, true],
    ]);
  });
  it("the drawing takeoff keeps the entry form's default (Closed)", () => {
    const src = readFileSync("src/lib/takeoff/create-bid.ts", "utf8");
    expect(src).toMatch(/usage: "Plumbing",\s*color: setup\.color \?\? "White",\s*open: false,/);
  });
});

describe("the Pipe Stacks screen", () => {
  const src = readFileSync("src/components/accessories-screens.tsx", "utf8");
  const screen = src.slice(
    src.indexOf("function PipeStacksScreen"),
    src.indexOf("function DrainsScreen"),
  );
  it("has Edit beside Remove on each saved row", () => {
    expect(screen).toMatch(/>\s*Edit\s*<\/Button>/);
    expect(screen).toMatch(/>\s*Remove\s*<\/Button>/);
    expect(screen).toContain("setEditing({");
  });
  it("the editing row offers Color, Open/Closed, Size and Quantity; usage stays as text", () => {
    const editRow = screen.slice(
      screen.indexOf('data-editing="pipe-stack"'),
      screen.indexOf(") : ("),
    );
    for (const label of [
      'aria-label="Color"',
      'aria-label="Open/Closed"',
      'aria-label="Size"',
      'aria-label="Quantity"',
    ])
      expect(editRow).toContain(label);
    expect(editRow).toMatch(/<td className="border px-2 py-0\.5">\{ps\.usage\}<\/td>/);
    expect(editRow).toContain("disabled={editClosedOnly}");
  });
  it("Save goes through applyPipeStackEdit on the row with that id, and is held back by the rule", () => {
    expect(screen).toContain(
      "d.pipeStacks[at] = applyPipeStackEdit(d.pipeStacks[at]!, editing, sizes);",
    );
    expect(screen).toContain("const at = d.pipeStacks.findIndex((p) => p.id === editing.id);");
    expect(screen).toContain("disabled={!!editProblem}");
    expect(screen).toMatch(/>\s*Cancel\s*<\/Button>/);
  });
});
