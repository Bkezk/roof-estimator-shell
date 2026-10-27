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

  it("a family screen (epdm:sealants) is written like a Duro-Last one: by row label and column, old → new", () => {
    // The seeded family rows are plain rows — no `_locked`, no branch in the data — so the apply
    // needs nothing but the screen id the mapping names (owner, Oct 27: an upload updates the
    // new accessories by item number).
    const d: ScreenData = {
      columns: ["Description", "Part #", "Price"],
      rows: [
        { Description: "Lap Sealant (10.3 oz tube)", "Part #": "W56RAC4180", Price: 12.5 },
        { Description: "Water Block (10.3 oz tube)", "Part #": "W56RAC4190", Price: 9 },
      ],
    };
    const r = applyUpdatesToScreen("epdm:sealants", d, [
      {
        item_no: "W56RAC4180",
        screen_id: "epdm:sealants",
        row_label: "Lap Sealant (10.3 oz tube)",
        price_col: "Price",
        price: 13.75,
      },
      {
        item_no: "W56RAC9999",
        screen_id: "epdm:sealants",
        row_label: "Not here",
        price_col: "Price",
        price: 1,
      },
    ]);
    expect(r.applied).toEqual([
      {
        item_no: "W56RAC4180",
        screen_id: "epdm:sealants",
        row_label: "Lap Sealant (10.3 oz tube)",
        price_col: "Price",
        price: 13.75,
        old: 12.5,
        new: 13.75,
      },
    ]);
    expect(r.missing).toEqual([
      { item_no: "W56RAC9999", reason: 'row "Not here" not on epdm:sealants' },
    ]);
    expect(d.rows![0]!["Price"]).toBe(13.75);
    expect(d.rows![1]!["Price"]).toBe(9);
    expect(d.rows![0]!["Part #"]).toBe("W56RAC4180");
  });

  it("Exceptional Metals: a pitch pan's Unit Cost by description (the Firestone penetration pockets), and back", () => {
    const d: ScreenData = {
      kind: "metals",
      subscreens: {
        pitch_pans: {
          rows: [
            { description: "Pitch Pan 4x4", unit_cost: 20 },
            {
              description: "QuickSeam QS6 Penetration Pocket Kit (6 kits/ctn, $273)",
              unit_cost: 45.5,
            },
          ],
        },
      },
    };
    const label = "QuickSeam QS6 Penetration Pocket Kit (6 kits/ctn, $273)";
    const r = applyUpdatesToScreen("duro_last:exceptional_metals", d, [
      {
        item_no: "W56RACQS06",
        screen_id: "duro_last:exceptional_metals",
        row_label: label,
        price_col: "Unit Cost",
        price: 50,
      },
      {
        item_no: "W56RACQS06",
        screen_id: "duro_last:exceptional_metals",
        row_label: label,
        price_col: "Price",
        price: 1,
      },
      {
        item_no: "W56RACQS10",
        screen_id: "duro_last:exceptional_metals",
        row_label: "QS10",
        price_col: "Unit Cost",
        price: 1,
      },
    ]);
    expect(r.applied).toEqual([
      {
        item_no: "W56RACQS06",
        screen_id: "duro_last:exceptional_metals",
        row_label: label,
        price_col: "Unit Cost",
        price: 50,
        old: 45.5,
        new: 50,
      },
    ]);
    expect(r.missing.map((m) => m.item_no)).toEqual(["W56RACQS06", "W56RACQS10"]);
    expect(d.subscreens!.pitch_pans!.rows![1]!.unit_cost).toBe(50);
    expect(d.subscreens!.pitch_pans!.rows![0]!.unit_cost).toBe(20);
    const rv = revertChangesOnScreen("duro_last:exceptional_metals", d, [
      {
        id: 1,
        screen_id: "duro_last:exceptional_metals",
        row_label: label,
        price_col: "Unit Cost",
        old_price: 45.5,
        new_price: 50,
      },
      {
        id: 2,
        screen_id: "duro_last:exceptional_metals",
        row_label: "Pitch Pan 4x4",
        price_col: "Unit Cost",
        old_price: 1,
        new_price: 99,
      },
    ]);
    expect(rv.revertedIds).toEqual([1]);
    expect(rv.skipped).toEqual([
      {
        cell: "duro_last:exceptional_metals › Pitch Pan 4x4 · Unit Cost",
        reason: "edited since (now 20)",
      },
    ]);
    expect(d.subscreens!.pitch_pans!.rows![1]!.unit_cost).toBe(45.5);
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
