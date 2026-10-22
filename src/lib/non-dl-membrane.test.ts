/**
 * Non-DL TPO and EPDM get their own page under Non Duro-Last Pricing (owner, Oct 22: "the non dl
 * tpo and its thickness and epdm rubber with its thicknesses are under the durolast membrane tab
 * on estimate pricing. can we move those to a new page under non Durolast pricing and have the
 * page called Non-DL TPO and EPDM. this is a front end change dont change the back end"). The
 * rows stay in the one Duro-Last Membrane screen the engine reads (adapters.ts parses the family
 * from each Description); the new page shows only those rows and merges its edits back into the
 * screen on save, and the Duro-Last Membrane view hides them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pageForPath } from "@/lib/access";
import {
  isNonDlMembraneRow,
  MEMBRANE_CATEGORY,
  mergeRows,
  NON_DL_MEMBRANE_NEW_ROW,
  NON_DL_MEMBRANE_PATH,
} from "@/lib/non-dl-membrane";

const read = (p: string) => readFileSync(p, "utf8");
const row = (d: string, white = 1) => ({ Description: d, White: white });

describe("isNonDlMembraneRow", () => {
  it("the Non-DL TPO and EPDM Rubber families, by the name the engine parses", () => {
    expect(isNonDlMembraneRow(row("Non-DL TPO - 45"), "Description")).toBe(true);
    expect(isNonDlMembraneRow(row("EPDM Rubber - 90"), "Description")).toBe(true);
    expect(isNonDlMembraneRow(row("  EPDM Rubber - 60 "), "Description")).toBe(true);
    expect(isNonDlMembraneRow(row("Duro-Tech TPO - 45"), "Description")).toBe(false);
    expect(isNonDlMembraneRow(row("Duro-Last - 40mil Roll Goods"), "Description")).toBe(false);
    expect(isNonDlMembraneRow(row("Non-DL TPO"), "Description")).toBe(false);
    expect(isNonDlMembraneRow({ Name: "Non-DL TPO - 45" }, "Name")).toBe(true);
  });
});

describe("mergeRows: the edited subset goes back into the whole screen", () => {
  const keep = (r: Record<string, string | number | boolean>) =>
    isNonDlMembraneRow(r, "Description");
  const full = [
    row("Duro-Last - 40mil Roll Goods", 1),
    row("Non-DL TPO - 45", 2),
    row("Duro-Tech TPO - 45", 3),
    row("EPDM Rubber - 45", 4),
    row("Duro-Bond - 40", 5),
  ];
  it("edits land in place; the hidden rows and the order are untouched", () => {
    const out = mergeRows(full, keep, [row("Non-DL TPO - 45", 20), row("EPDM Rubber - 45", 40)]);
    expect(out.map((r) => [r["Description"], r["White"]])).toEqual([
      ["Duro-Last - 40mil Roll Goods", 1],
      ["Non-DL TPO - 45", 20],
      ["Duro-Tech TPO - 45", 3],
      ["EPDM Rubber - 45", 40],
      ["Duro-Bond - 40", 5],
    ]);
  });
  it("a deleted row is dropped; an added row lands after the last of its kind", () => {
    const out = mergeRows(full, keep, [row("EPDM Rubber - 45", 4), row("EPDM Rubber - 90", 9)]);
    expect(out.map((r) => r["Description"])).toEqual([
      "Duro-Last - 40mil Roll Goods",
      "EPDM Rubber - 45",
      "Duro-Tech TPO - 45",
      "EPDM Rubber - 90",
      "Duro-Bond - 40",
    ]);
  });
  it("the other side: the Duro-Last view edits everything but those rows", () => {
    const other = (r: Record<string, string | number | boolean>) => !keep(r);
    const out = mergeRows(full, other, [
      row("Duro-Last - 40mil Roll Goods", 10),
      row("Duro-Tech TPO - 45", 30),
      row("Duro-Bond - 40", 50),
      row("Duro-Bond - 50", 60),
    ]);
    expect(out.map((r) => [r["Description"], r["White"]])).toEqual([
      ["Duro-Last - 40mil Roll Goods", 10],
      ["Non-DL TPO - 45", 2],
      ["Duro-Tech TPO - 45", 30],
      ["EPDM Rubber - 45", 4],
      ["Duro-Bond - 40", 50],
      ["Duro-Bond - 50", 60],
    ]);
  });
  it("nothing kept in the screen yet: the edited rows are appended", () => {
    expect(
      mergeRows([row("Duro-Bond - 40")], keep, [row("Non-DL TPO - 60")]).map(
        (r) => r["Description"],
      ),
    ).toEqual(["Duro-Bond - 40", "Non-DL TPO - 60"]);
  });
});

describe("the page, the menu and the two views (front end only)", () => {
  it("is a pricing page at /admin/non-dl-membrane, titled Non-DL TPO and EPDM", () => {
    expect(NON_DL_MEMBRANE_PATH).toBe("/admin/non-dl-membrane");
    expect(pageForPath(NON_DL_MEMBRANE_PATH)).toBe("pricing");
    const route = read("src/routes/admin.non-dl-membrane.tsx");
    expect(route).toContain("Non-DL TPO and EPDM");
    expect(route).toContain(`category={MEMBRANE_CATEGORY}`);
    expect(route).toContain("hideCategoryPicker");
    expect(route).toContain("isNonDlMembraneRow(row, labelCol)");
    expect(route).toContain("newRowLabel={NON_DL_MEMBRANE_NEW_ROW}");
    expect(NON_DL_MEMBRANE_NEW_ROW).toBe("Non-DL TPO - ");
    expect(MEMBRANE_CATEGORY).toBe("Duro-Last Membrane");
  });
  it("sits under Non Duro-Last Pricing in the menu", () => {
    const nav = read("src/components/app-sidebar.tsx");
    expect(nav).toContain('{ title: "Non-DL TPO and EPDM", url: "/admin/non-dl-membrane" }');
  });
  it("the Duro-Last Membrane view hides those rows, and the editor merges a filtered draft back on save", () => {
    const dl = read("src/routes/admin.duro-last.tsx");
    expect(dl).toContain("!isNonDlMembraneRow(row, labelCol)");
    const editor = read("src/components/catalog-editor.tsx");
    expect(editor).toContain("mergeRows(");
    expect(editor).toContain("rowFilter");
    expect(editor).toContain("hideCategoryPicker");
  });
  it("the back end is untouched: the engine still parses both families from the one screen", () => {
    expect(read("src/lib/engine/adapters.ts")).toContain(
      "/^(Duro-Bond|Duro-Tuff|Duro-Fleece|Duro-Tech TPO|Non-DL TPO|EPDM Rubber) - (.+)$/",
    );
  });
});
