import { describe, expect, it } from "vitest";

import { applyUpdatesToScreen, revertChangesOnScreen, type ScreenData } from "./price-import-apply";

const screen = (): ScreenData => ({
  columns: ["Part #", "Subtype", "Description", "Price/Box", "Fasteners/Box"],
  rows: [
    {
      "Part #": "1446",
      Subtype: "Spade",
      Description: '2"',
      "Price/Box": 149.5,
      "Fasteners/Box": 1000,
    },
    {
      "Part #": "1751",
      Subtype: "Auger",
      Description: '2"',
      "Price/Box": 374.5,
      "Fasteners/Box": 500,
    },
    {
      "Part #": "1243",
      Subtype: "Stainless",
      Description: '1 5/8" #12',
      "Price/Box": 598,
      "Fasteners/Box": 1000,
    },
    {
      "Part #": "9999",
      Subtype: "",
      Description: "Blank one",
      "Price/Box": null,
      "Fasteners/Box": 1,
    },
  ],
});
const upd = (row_label: string, price: number, item_no = "x") => ({
  item_no,
  screen_id: "s",
  row_label,
  price_col: "Price/Box",
  price,
});

describe("price import — apply and revert on a screen", () => {
  it("writes by row key (subtype-qualified), records old → new, reports a gone row / column", () => {
    const d = screen();
    const r = applyUpdatesToScreen("s", d, [
      upd('2" [Auger]', 380, "1751"),
      upd('1 5/8" #12', 610, "1243"),
      upd("Blank one", 5, "9999"),
      upd('2"', 1, "bad-key"),
      { ...upd('2" [Spade]', 1, "1446"), price_col: "Nope" },
    ]);
    expect(r.applied).toEqual([
      {
        item_no: "1751",
        screen_id: "s",
        row_label: '2" [Auger]',
        price_col: "Price/Box",
        price: 380,
        old: 374.5,
        new: 380,
      },
      {
        item_no: "1243",
        screen_id: "s",
        row_label: '1 5/8" #12',
        price_col: "Price/Box",
        price: 610,
        old: 598,
        new: 610,
      },
      {
        item_no: "9999",
        screen_id: "s",
        row_label: "Blank one",
        price_col: "Price/Box",
        price: 5,
        old: null,
        new: 5,
      },
    ]);
    expect(r.missing.map((m) => m.item_no)).toEqual(["bad-key", "1446"]);
    // The Spade row is untouched; the Auger row moved.
    expect(d.rows![0]!["Price/Box"]).toBe(149.5);
    expect(d.rows![1]!["Price/Box"]).toBe(380);
  });

  it("revert restores the exact prior state, including a blank cell, and skips a cell edited since", () => {
    const d = screen();
    const before = JSON.stringify(d);
    const { applied } = applyUpdatesToScreen("s", d, [
      upd('2" [Auger]', 380, "1751"),
      upd("Blank one", 5, "9999"),
      upd('1 5/8" #12', 610, "1243"),
    ]);
    const log = applied.map((a, i) => ({
      id: i + 1,
      screen_id: "s",
      row_label: a.row_label,
      price_col: a.price_col,
      old_price: a.old,
      new_price: a.new,
    }));
    // Someone edits the stainless screw by hand after the import.
    d.rows![2]!["Price/Box"] = 650;
    const r = revertChangesOnScreen("s", d, log);
    expect(r.revertedIds).toEqual([1, 2]);
    expect(r.skipped).toEqual([
      { cell: 's › 1 5/8" #12 · Price/Box', reason: "edited since (now 650)" },
    ]);
    d.rows![2]!["Price/Box"] = 598; // put the hand edit back to compare the rest
    expect(JSON.stringify(d)).toBe(before);
  });

  it("adhesives screens go by product name", () => {
    const d: ScreenData = {
      kind: "adhesives",
      products: [{ name: "Water Based Adhesive", price: 120 }, { name: "Other" }],
    };
    const { applied } = applyUpdatesToScreen("a", d, [
      { ...upd("Water Based Adhesive", 125, "1111"), price_col: "price" },
      { ...upd("Other", 9, "x"), price_col: "price" },
      { ...upd("Missing", 9, "m"), price_col: "price" },
    ]);
    expect(applied.map((a) => [a.old, a.new])).toEqual([
      [120, 125],
      [null, 9],
    ]);
    const r = revertChangesOnScreen(
      "a",
      d,
      applied.map((a, i) => ({
        id: i,
        screen_id: "a",
        row_label: a.row_label,
        price_col: "price",
        old_price: a.old,
        new_price: a.new,
      })),
    );
    expect(r.revertedIds).toEqual([0, 1]);
    expect(d.products![0]!.price).toBe(120);
    expect(d.products![1]!.price).toBe(0);
  });
});
