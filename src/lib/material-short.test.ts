/**
 * Owner, Oct 9: "they need to be able to add materials via typing and selection from our
 * catalog even if there is not stock of that item in the shop or vehicle". A ticket's material
 * the app says is not there is logged anyway after a plain question — the count at that place
 * goes below zero and the entry's note says so — instead of the old "Not enough …" refusal on
 * the screen and "Only N on the shelf" from the server. The question first sends them to the
 * right place when it came from elsewhere; it never says the office will fix it (owner: "they
 * may see that and think they can just skip it").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("the server: short_ok on a ticket's consumed entry", () => {
  const src = read("src/lib/inventory.functions.ts");
  it("addMovement accepts short_ok and only then lets the count go below zero", () => {
    expect(src).toMatch(/short_ok: z\.boolean\(\)\.optional\(\),/);
    expect(src).toMatch(
      /if \(!\(data\.short_ok && data\.service_job_id\)\)\s*throw new Error\(\s*`Only \$\{/,
    );
  });
  it("the entry's note says the count was short", () => {
    expect(src).toMatch(/shortNote = `Short: inventory had \$\{had\}/);
    expect(src).toContain('note: [data.note, shortNote].filter(Boolean).join(" — ") || null,');
  });
});

describe("the screen: ask, then log it anyway", () => {
  const src = read("src/components/service/materials-section.tsx");
  it("add() asks instead of refusing when the place shows too little", () => {
    expect(src).toContain(
      "const add = (r: ListRow, units: number, checkStock = true, shortOk = false) => {",
    );
    // `ok` is the tap's short_ok or a remembered yes for the cell (closeout-batch-oct9.test.ts).
    expect(src).toMatch(
      /if \(checkStock && !ok && units > onHand \+ EPS\) \{\s*setShort\(\{ r, units \}\);\s*return;\s*\}/,
    );
    expect(src).not.toContain("take the rest from the shop or another truck");
  });
  it("the question names the item and the place and sends short_ok on yes", () => {
    // A real dialog (owner, Oct 9: a panel under the results was off screen).
    expect(src).toMatch(
      /<AlertDialog open=\{!!short\} onOpenChange=\{\(o\) => !o && setShort\(null\)\}>/,
    );
    expect(src).not.toContain('role="alertdialog"');
    expect(src).toContain("If it came from somewhere else, cancel and pick that place.");
    expect(src).not.toContain("until the office fixes it");
    expect(src).toMatch(/add\(s\.r, s\.units, false, true\);/);
    expect(src).toMatch(/record\(r, units, "consumed", ok\)/);
    expect(src).toContain("...(shortOk ? { short_ok: true } : {}),");
  });
  it("a source with nothing in inventory still has a tappable chip that says so", () => {
    expect(src).toContain('"none in inventory"');
    expect(src).not.toContain('left === "none";');
  });
});
