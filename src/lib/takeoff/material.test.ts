/**
 * A material on a linear (owner, Oct 27): the search list is built from the SAME sources and keys
 * as the estimator's own pickers; the pick is a clean snapshot; the bid seed turns it into the
 * line the engine bills (by branch), re-priced from the live list; the update path keeps it.
 */
import { describe, expect, it } from "vitest";

import {
  buildFamilyAccessoryData,
  type AdminSnapshot,
  type CatalogRow,
} from "@/lib/accessory-families";
import {
  buildAccessoryCatalog,
  buildMetalsCatalog,
  buildNonDlCatalog,
} from "@/lib/engine/adapters";
import { emptyCustomer, type SavedBidState } from "@/lib/proposal-bid";
import {
  DURO_LAST_OTHER_SCREEN,
  FAMILY_SCREENS,
  type SeedScreen,
} from "@/lib/pricing-seed/accessory-families";

import { applyTakeoffToBid, bidSeedFromTakeoff } from "./create-bid";
import {
  catalogSearchItems,
  categoryLabel,
  liveMaterial,
  materialFromItem,
  materialHome,
  materialLine,
  otherItemKey,
  searchCatalog,
  type CatalogSearchItem,
} from "./material";
import { markupSummary, objectLabelText } from "./markup-pdf";
import {
  takeoffQuantities,
  type LinearMaterial,
  type TakeoffObject,
  type TakeoffPage,
  type TakeoffSetup,
} from "./model";
import { newBidFromSeed } from "./seed-to-bid";

// ── The price list, through the estimator's own builders ─────────────────────────────────────
const toRow = (s: SeedScreen): CatalogRow => ({
  id: s.id,
  category: s.category,
  data: { columns: s.columns, rows: s.rows },
});
const ventsScreen: CatalogRow = {
  id: "duro_last:vents",
  category: "Vents",
  data: {
    columns: ["Description", "Part #", "White Price", "Tan Price"],
    rows: [{ Description: "One-way vent", "Part #": "V1", "White Price": 40, "Tan Price": 42 }],
  },
};
const duroLastRows: CatalogRow[] = [ventsScreen, toRow(DURO_LAST_OTHER_SCREEN)];
const accessories = buildAccessoryCatalog(duroLastRows);
const accessoryLabor = { "One-way vent": 0.25 };
const nonDl = buildNonDlCatalog([
  {
    id: "non_dl:sheet_metal_work",
    category: "Sheet Metal Work",
    data: {
      columns: ["Description", "Price", "LaborPerUnit", "Labor Rate"],
      rows: [{ Description: 'Counterflashing 6"', Price: 4, LaborPerUnit: 0.05, "Labor Rate": 40 }],
    },
  },
]);
const metals = buildMetalsCatalog({
  kind: "metals",
  subscreens: {
    pitch_pans: {
      rows: [
        { description: "Pitch pan 6 x 6", unit_cost: 25, labor_per_unit_lf: 0.5, labor_rate: 50 },
      ],
    },
  },
});
const fam = buildFamilyAccessoryData({
  duroLastRows,
  familyRows: FAMILY_SCREENS.map(toRow),
  laborRows: [],
});
const admin = {
  deckOrder: [],
  priceMatrix: {},
  labor: {},
  settings: {},
  accessoryFamilies: fam,
} as unknown as AdminSnapshot;
const items = catalogSearchItems({ admin, accessories, accessoryLabor, metals, nonDl });
const byKey = (key: string) => items.find((i) => i.key === key)!;

describe("catalogSearchItems — the estimator's rows, the estimator's keys", () => {
  it("accessories catalog rows keep the picker's key, category and price; hours as the picker prefills them", () => {
    const white = byKey("duro_last:vents::One-way vent::White");
    expect(white).toEqual({
      key: "duro_last:vents::One-way vent::White",
      branch: "accessories",
      screen: "Vents",
      description: "One-way vent — White",
      price: 40,
      laborHoursPerUnit: 0.25,
    });
    expect(byKey("duro_last:vents::One-way vent::Tan").price).toBe(42);
    // The same key the estimator's picker would add (estimate.tsx `accCatalog.find(a => a.key === key)`).
    expect(accessories.some((a) => a.key === white.key)).toBe(true);
  });
  it("each family's Other Accessories items, once (the DL catalog's own copy of the screen is dropped)", () => {
    const dlOther = fam.other.duroLast;
    expect(dlOther.length).toBeGreaterThan(3);
    for (const it of dlOther) {
      const hit = byKey(otherItemKey("duroLast", it.description));
      expect(hit.branch).toBe("other");
      expect(hit.screen).toBe("DL accessories · Other Accessories");
      expect(hit.price).toBe(it.price);
      expect(hit.laborHoursPerUnit).toBe(it.laborHoursPerUnit);
      expect(hit.description).toBe(it.part ? `${it.description} (${it.part})` : it.description);
    }
    expect(items.filter((i) => i.key.startsWith("duro_last:other_accessories::"))).toHaveLength(
      dlOther.length,
    );
    expect(items.some((i) => i.screen === "Non-DL TPO accessories · Other Accessories")).toBe(true);
    expect(items.some((i) => i.screen === "EPDM accessories · Other Accessories")).toBe(true);
    expect(fam.other.nonDlTpo.length + fam.other.epdm.length).toBe(
      items.filter((i) => i.branch === "other" && !i.key.startsWith("duro_last:")).length,
    );
  });
  it("metals and Non-DL rows carry their own labor rate and raw category (the Non-DL category routes the bid line)", () => {
    expect(byKey("metals::Pitch Pans::Pitch pan 6 x 6")).toEqual({
      key: "metals::Pitch Pans::Pitch pan 6 x 6",
      branch: "metals",
      screen: "Pitch Pans",
      description: "Pitch pan 6 x 6",
      price: 25,
      laborHoursPerUnit: 0.5,
      laborRate: 50,
    });
    expect(byKey('non_dl:sheet_metal_work::Counterflashing 6"')).toEqual({
      key: 'non_dl:sheet_metal_work::Counterflashing 6"',
      branch: "non_dl",
      screen: "Sheet Metal Work",
      description: 'Counterflashing 6"',
      price: 4,
      laborHoursPerUnit: 0.05,
      laborRate: 40,
    });
    expect(categoryLabel(byKey("metals::Pitch Pans::Pitch pan 6 x 6"))).toBe("Metals · Pitch Pans");
    expect(categoryLabel(byKey('non_dl:sheet_metal_work::Counterflashing 6"'))).toBe(
      "Non-DL · Sheet Metal Work",
    );
    expect(categoryLabel(byKey("duro_last:vents::One-way vent::White"))).toBe("Vents");
  });
  it("sources still loading contribute nothing; no duplicate keys", () => {
    expect(
      catalogSearchItems({
        admin: null,
        accessories: null,
        accessoryLabor: null,
        metals: null,
        nonDl: null,
      }),
    ).toEqual([]);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
  it("type-search: every word must match the category or description, case-insensitively", () => {
    expect(searchCatalog(items, "vent white").map((i) => i.key)).toEqual([
      "duro_last:vents::One-way vent::White",
    ]);
    expect(searchCatalog(items, "non-dl counter")).toHaveLength(1);
    expect(searchCatalog(items, "metals pitch")).toHaveLength(1);
    expect(searchCatalog(items, "")).toEqual([]);
    expect(searchCatalog(items, "zzz-nothing")).toEqual([]);
    expect(searchCatalog(items, "e", 5)).toHaveLength(5);
  });
});

describe("materialFromItem / materialLine", () => {
  const vent = materialFromItem(byKey("duro_last:vents::One-way vent::White"));
  const pan = materialFromItem(byKey("metals::Pitch Pans::Pitch pan 6 x 6"));
  const flash = materialFromItem(byKey('non_dl:sheet_metal_work::Counterflashing 6"'));
  it("the snapshot has no undefined keys (it is saved as JSON on the object)", () => {
    const noHours: CatalogSearchItem = {
      key: "k",
      branch: "accessories",
      screen: "S",
      description: "D",
      price: 1,
    };
    const m = materialFromItem(noHours);
    expect(Object.keys(m)).toEqual(["key", "description", "price", "screen", "branch"]);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    expect(vent).toEqual({
      key: "duro_last:vents::One-way vent::White",
      description: "One-way vent — White",
      price: 40,
      screen: "Vents",
      branch: "accessories",
      laborHoursPerUnit: 0.25,
    });
    expect(pan.laborRate).toBe(50);
  });
  it("accessories and Other items → an Other Accessories line (quantity = feet, 1 dp)", () => {
    expect(materialHome("accessories")).toBe("otherAccessories");
    expect(materialHome("other")).toBe("otherAccessories");
    expect(materialLine("Line 1", 12.345, vent)).toEqual({
      home: "otherAccessories",
      line: {
        description: "Line 1 · 12.3 ft — One-way vent — White",
        price: 40,
        quantity: 12.3,
        laborHoursPerUnit: 0.25,
      },
    });
  });
  it("metals → a flat metals line at its own rate; Non-DL → a categorised Non-DL line", () => {
    expect(materialLine("Gutter 1", 60, pan)).toEqual({
      home: "metals",
      line: {
        description: "Gutter 1 · 60 ft — Pitch pan 6 x 6",
        price: 25,
        laborPerUnit: 0.5,
        laborRate: 50,
        quantity: 60,
      },
    });
    expect(materialLine("Wall cap", 25, flash)).toEqual({
      home: "nonDlLines",
      line: {
        description: 'Wall cap · 25 ft — Counterflashing 6"',
        category: "Sheet Metal Work",
        price: 4,
        laborPerUnit: 0.05,
        laborRate: 40,
        quantity: 25,
      },
    });
  });
  it("liveMaterial finds the item by key, or null when it left the price list", () => {
    expect(liveMaterial({ ...vent, price: 1 }, items)).toEqual(vent);
    expect(liveMaterial({ ...vent, key: "duro_last:vents::Gone::White" }, items)).toBeNull();
  });
});

// ── Drawing → quantities → seed → bid ────────────────────────────────────────────────────────
const page: TakeoffPage = {
  index: 0,
  name: "A1",
  rotation: 0,
  scale: { ax: 0, ay: 0, bx: 100, by: 0, feet: 100 },
};
const setup: TakeoffSetup = { roofSystem: "Duro-Last", attachment: "mechanical" };
const vent = materialFromItem(byKey("duro_last:vents::One-way vent::White"));
const pan = materialFromItem(byKey("metals::Pitch Pans::Pitch pan 6 x 6"));
const flash = materialFromItem(byKey('non_dl:sheet_metal_work::Counterflashing 6"'));
const line = (id: string, name: string, len: number, material?: LinearMaterial): TakeoffObject => ({
  id,
  kind: "linear",
  page: 0,
  points: [
    [0, 0],
    [len, 0],
  ],
  attrs: { name, role: "other", ...(material ? { material } : {}) },
});
const area: TakeoffObject = {
  id: "a",
  kind: "area",
  page: 0,
  points: [
    [0, 0],
    [100, 0],
    [100, 50],
    [0, 50],
  ],
  attrs: { name: "Section 1" },
};
const drawn: TakeoffObject[] = [
  area,
  line("l1", "Line 1", 12, vent),
  line("l2", "Line 2", 60, pan),
  line("l3", "Line 3", 25, flash),
  line("l4", "Line 4", 8),
];
const q = takeoffQuantities([page], drawn);

const make = {
  newSection: (d: object) => ({ id: "s", name: "S", length: 0, width: 0, ...d }) as never,
  newParapet: (d: object) => ({ id: "p", ...d }) as never,
  newCurb: (d: object) => ({ id: "c", ...d }) as never,
};
type SavedWithDefaults = SavedBidState & {
  sectionDefaults: NonNullable<SavedBidState["sectionDefaults"]>;
};
const saved = (roofSystem = "Duro-Last"): SavedWithDefaults => ({
  roofSystem,
  attachment: "mechanical",
  sections: [],
  accessories: [],
  nonDlLines: [],
  metals: [],
  customer: emptyCustomer(),
  markupMode: 2,
  markup: 0,
  laborRate: 45,
  commission: 0,
  taxExempt: true,
  sectionDefaults: { deckType: "Wood", thickness: 40, color: "White", sheetSizeLabel: "1500 sf" },
  parapetDefaults: {},
});

describe("the seed", () => {
  it("takeoffQuantities carries the material per linear", () => {
    expect(q.linears.map((l) => [l.name, l.lengthFt, l.material?.key])).toEqual([
      ["Line 1", 12, vent.key],
      ["Line 2", 60, pan.key],
      ["Line 3", 25, flash.key],
      ["Line 4", 8, undefined],
    ]);
  });
  it("a linear with a material becomes a line in its branch's home; one without stays in the notice", () => {
    const seed = bidSeedFromTakeoff(setup, q, { catalog: items });
    expect(seed.otherAccessories).toEqual([
      {
        description: "Line 1 · 12 ft — One-way vent — White",
        price: 40,
        quantity: 12,
        laborHoursPerUnit: 0.25,
        takeoffObjectId: "l1",
      },
    ]);
    expect(seed.metals).toEqual([
      {
        description: "Line 2 · 60 ft — Pitch pan 6 x 6",
        price: 25,
        laborPerUnit: 0.5,
        laborRate: 50,
        quantity: 60,
        takeoffObjectId: "l2",
      },
    ]);
    expect(seed.nonDlLines).toEqual([
      {
        description: 'Line 3 · 25 ft — Counterflashing 6"',
        category: "Sheet Metal Work",
        price: 4,
        laborPerUnit: 0.05,
        laborRate: 40,
        quantity: 25,
        takeoffObjectId: "l3",
      },
    ]);
    expect(seed.unmapped).toEqual([
      { label: "Line 4: 8 ft", detail: "Other — add as a Non-DL or custom line." },
    ]);
  });
  it("the live price wins over the snapshot; a vanished item or an unloaded list uses the snapshot and says so", () => {
    const stale = drawn.map((o) =>
      o.id === "l1" && o.kind === "linear"
        ? { ...o, attrs: { ...o.attrs, material: { ...vent, price: 1, laborHoursPerUnit: 9 } } }
        : o,
    );
    const live = bidSeedFromTakeoff(setup, takeoffQuantities([page], stale), { catalog: items });
    expect(live.otherAccessories![0]).toMatchObject({ price: 40, laborHoursPerUnit: 0.25 });
    expect(live.unmapped.map((u) => u.label)).toEqual(["Line 4: 8 ft"]);

    const gone = bidSeedFromTakeoff(setup, takeoffQuantities([page], stale), {
      catalog: items.filter((i) => i.key !== vent.key),
    });
    expect(gone.otherAccessories![0]).toMatchObject({ price: 1, laborHoursPerUnit: 9 });
    expect(gone.unmapped[1]).toEqual({
      label: "Line 1: 12 ft of One-way vent — White",
      detail:
        "Priced from the takeoff's snapshot ($1.00 per unit) — the item is no longer in the price list; check the line on Accessories › Other Accessories (the bid's active group).",
    });

    const unloaded = bidSeedFromTakeoff(setup, q, { catalog: null });
    expect(unloaded.unmapped.filter((u) => u.detail.includes("could not be loaded"))).toHaveLength(
      3,
    );
    expect(unloaded.unmapped[2]!.detail).toContain("Metals › Extra catalog lines");
    expect(unloaded.unmapped[3]!.detail).toContain("Non-DL › Extra catalog lines");
    // A pure caller with no list at all: snapshot prices, no notice.
    expect(bidSeedFromTakeoff(setup, q).unmapped.map((u) => u.label)).toEqual(["Line 4: 8 ft"]);
  });
  it("a parapet never carries a material into the bid", () => {
    const wall: TakeoffObject = {
      id: "w",
      kind: "linear",
      page: 0,
      points: [
        [0, 0],
        [30, 0],
      ],
      attrs: { name: "Wall", role: "parapet", material: vent },
    };
    const seed = bidSeedFromTakeoff(setup, takeoffQuantities([page], [area, wall]), {
      catalog: items,
    });
    expect(seed.otherAccessories).toBeUndefined();
    expect(seed.parapets.map((p) => p.name)).toEqual(["Wall"]);
  });
});

describe("newBidFromSeed", () => {
  const seed = bidSeedFromTakeoff(setup, q, { catalog: items });
  it("Other Accessories lines land in the ACTIVE family group of the seeded roof system", () => {
    const dl = newBidFromSeed(saved(), seed, make);
    expect(dl.otherAccessories).toEqual({
      duroLast: seed.otherAccessories,
      nonDlTpo: [],
      epdm: [],
    });
    expect(dl.metals).toEqual(seed.metals);
    expect(dl.nonDlLines).toEqual(seed.nonDlLines);
    const epdm = newBidFromSeed(
      saved(),
      bidSeedFromTakeoff({ ...setup, roofSystem: "EPDM Rubber" }, q, { catalog: items }),
      make,
    );
    expect(epdm.roofSystem).toBe("EPDM Rubber");
    expect(epdm.otherAccessories!.epdm).toHaveLength(1);
    expect(epdm.otherAccessories!.duroLast).toEqual([]);
    // No seeded roof system: the bid's.
    const tpo = newBidFromSeed(
      saved("Non-DL TPO"),
      bidSeedFromTakeoff({}, q, { catalog: items }),
      make,
    );
    expect(tpo.otherAccessories!.nonDlTpo).toHaveLength(1);
  });
  it("a seed without materials leaves the bid's line fields alone", () => {
    const none = newBidFromSeed(
      saved(),
      bidSeedFromTakeoff(setup, takeoffQuantities([page], [area]), {}),
      make,
    );
    expect(none.otherAccessories).toBeUndefined();
    expect(none.metals).toEqual([]);
    expect(none.nonDlLines).toEqual([]);
  });
});

describe("applyTakeoffToBid — the material lines follow the drawing", () => {
  const first = newBidFromSeed(saved(), bidSeedFromTakeoff(setup, q, { catalog: items }), make);
  const bidOf = (b: SavedBidState) => ({
    sections: b.sections,
    roofSystem: b.roofSystem,
    otherAccessories: b.otherAccessories,
    metals: b.metals,
    nonDlLines: b.nonDlLines,
  });
  const handLine = { description: "Hand pick", price: 2, quantity: 3, laborHoursPerUnit: 0 };
  it("re-measured: quantity, description and price follow; hand-added lines stay; a removed material drops its line", () => {
    const edited: SavedBidState = {
      ...first,
      otherAccessories: {
        ...first.otherAccessories!,
        duroLast: [handLine, ...first.otherAccessories!.duroLast],
      },
    };
    const redrawn = drawn.map((o) =>
      o.id === "l1"
        ? {
            ...o,
            points: [
              [0, 0],
              [20, 0],
            ] as [number, number][],
          }
        : o.id === "l2" && o.kind === "linear"
          ? { ...o, attrs: { name: "Line 2", role: "other" as const } }
          : o.id === "l4" && o.kind === "linear"
            ? { ...o, attrs: { ...o.attrs, material: flash } }
            : o,
    );
    const r = applyTakeoffToBid(
      bidOf(edited),
      bidSeedFromTakeoff(setup, takeoffQuantities([page], redrawn), { catalog: items }),
      make,
    );
    expect(r.otherAccessories.duroLast).toEqual([
      handLine,
      {
        description: "Line 1 · 20 ft — One-way vent — White",
        price: 40,
        quantity: 20,
        laborHoursPerUnit: 0.25,
        takeoffObjectId: "l1",
      },
    ]);
    expect(r.metals).toEqual([]);
    expect(r.nonDlLines.map((l) => [l.description, l.quantity])).toEqual([
      ['Line 3 · 25 ft — Counterflashing 6"', 25],
      ['Line 4 · 8 ft — Counterflashing 6"', 8],
    ]);
    expect(r.changes).toEqual([
      'Line 1 · 12 ft — One-way vent — White: now "Line 1 · 20 ft — One-way vent — White"; 12 → 20.',
      'Removed line "Line 2 · 60 ft — Pitch pan 6 x 6" (no material on it in the drawing).',
      'Added line "Line 4 · 8 ft — Counterflashing 6"" (×8).',
    ]);
  });
  it("nothing changed: no changes; a new line joins the BID's active group", () => {
    const same = applyTakeoffToBid(
      bidOf(first),
      bidSeedFromTakeoff(setup, q, { catalog: items }),
      make,
    );
    expect(same.changes).toEqual([]);
    expect(same.otherAccessories).toEqual(first.otherAccessories);
    const tpoBid = { ...bidOf(first), roofSystem: "Non-DL TPO" };
    const more = applyTakeoffToBid(
      tpoBid,
      bidSeedFromTakeoff(
        setup,
        takeoffQuantities([page], [...drawn, line("l5", "Line 5", 4, vent)]),
        { catalog: items },
      ),
      make,
    );
    // The existing line stays where it was (the DL group); the new one joins the active group.
    expect(more.otherAccessories.duroLast).toHaveLength(1);
    expect(more.otherAccessories.nonDlTpo.map((l) => l.description)).toEqual([
      "Line 5 · 4 ft — One-way vent — White",
    ]);
  });
});

describe("the material shows on the drawing's outputs", () => {
  it("markup PDF: the label and the summary table carry it", () => {
    const l1 = drawn[1]!;
    expect(objectLabelText(l1, q)).toBe("Line 1: 12 LF · One-way vent — White");
    const s = markupSummary(q, () => "A1");
    const other = s.groups.find((g) => g.title === "Linears: Other")!;
    expect(other.columns).toEqual(["Name", "Page", "Length (LF)", "Height (in)", "Material"]);
    expect(other.rows).toEqual([
      ["Line 1", "A1", "12", "", "One-way vent — White"],
      ["Line 2", "A1", "60", "", "Pitch pan 6 x 6"],
      ["Line 3", "A1", "25", "", 'Counterflashing 6"'],
      ["Line 4", "A1", "8", "", ""],
    ]);
  });
});
