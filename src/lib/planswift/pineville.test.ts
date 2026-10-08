/**
 * The owner's "Pineville Independent Preschool" export (Oct 8): "it put gutters into accessories
 * as well as some other issues … refine the importer more so it will accurately put these where
 * they are supposed to go and if it doesn't know it'll ask". Before: the two Standing Seam areas
 * were read as membrane sections, `30" X 60" Saftey Wal Pads` became a 30 × 60 in curb, the
 * Gutter a Non-DL Sheet Metals line, and Ridge / Valley / Snow Rail / Expansion Joint / `45's`
 * were "place by hand". Now every row has a home, and the rows the name cannot place by itself
 * (the gutter's style and size, the elbows' size and style, the downspouts' size) are asked on
 * the review screen before Create bid.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { MetalsCatalogItem } from "@/lib/engine/adapters";
import { classifyRows, describeTarget, type ClassifiedRow } from "./classify";
import { readPlanSwiftWorkbook } from "./parse";
import {
  PICK_SEP,
  catalogDownspoutSizes,
  parseElbowPick,
  parseGutterPick,
  pickFor,
  sheetDownspoutSizes,
  unresolvedRows,
  type ReviewRow,
} from "./picks";
import { planSwiftSeed, type PlanSwiftChoice } from "./to-seed";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** The live Metals catalog's shape (buildMetalsCatalog), the 4"X5" rows this file needs. */
const item = (category: string, description: string, unitCost: number): MetalsCatalogItem => ({
  key: `metals::${category}::${description}`,
  category,
  description,
  unitCost,
  laborPerUnit: 0.05,
  laborRate: 45,
});
const METALS: MetalsCatalogItem[] = [
  item('Downspouts 3"X4"', '3"X4" Downspout - Open', 4.1),
  item('Downspouts 3"X4"', "45° A-Style Elbow", 7),
  item('Downspouts 4"X5"', '4"X5" Downspout - Open', 5.2),
  item('Downspouts 4"X5"', '4"X5" Downspout - Closed', 5.6),
  item('Downspouts 4"X5"', "Drop/Outlet", 11),
  item('Downspouts 4"X5"', "45° A-Style Elbow", 8),
  item('Downspouts 4"X5"', "45° B-Style Elbow", 8.2),
  item('Downspouts 4"X5"', "80° A-Style Elbow", 8.4),
  item('Downspouts 4"X5"', "80° B-Style Elbow", 8.6),
  item("Downspout accessories", "Downspout Straps", 1.2),
];
/** Metals › Gutters sizes by style (liveAdmin.metals.gutters.sizesByStyle, Oct 8). */
const GUTTERS: Record<string, readonly string[]> = {
  "D-Style": ['A = 6" B = 4" C = 4"', 'A = 7" B = 5" C = 5"'],
  "LX-Style": ['A = 6" B = 4" C = 4"', 'A = 7" B = 6" C = 5"'],
};
const BOOTS = ['2" Drain Boot', '3" Drain Boot', '4" Drain Boot'];
const RINGS = ['2" Drain Rings', '3" Drain Rings', '4" Drain Rings'];
const WALK_PADS = ['30" x 60" White - Walk Pad', '30" x 60" Safety - Walk Pad'];
const LISTS = {
  gutterSizesByStyle: GUTTERS,
  metalsCatalog: METALS,
  drainBoots: BOOTS,
  drainRings: RINGS,
};

describe("pineville.xlsx — the owner's export, row by row", async () => {
  const sheet = await readPlanSwiftWorkbook(fixture("pineville.xlsx"));
  const cs = classifyRows(sheet.rows);
  const by = (start: string) => cs.find((c) => c.row.name.startsWith(start))!;
  const at = (sheetRow: number) => cs.find((c) => c.row.sheetRow === sheetRow)!;

  it("27 rows, every one with a home — nothing left as 'place by hand'", () => {
    expect(sheet.rows).toHaveLength(27);
    expect(sheet.warnings).toEqual([]);
    expect(cs.filter((c) => c.target === "unmatched").map((c) => c.row.name)).toEqual([]);
  });
  it("the two Standing Seam Metal areas are Contractor Applications lines, not membrane sections", () => {
    for (const c of [at(2), at(3)]) {
      expect(c.target).toBe("nondl");
      expect(c.reason).toMatch(/metal \/ shingle roof area/);
      expect(describeTarget(c)).toContain("a Contractor Applications line");
    }
    // The real TPO section stays a section, with its tapered quote.
    expect(by("( 3 ) White 60 Mil TPO")).toMatchObject({
      target: "section",
      confidence: "high",
      details: { quoteBoard: "Tapered ISO", taperedInName: true },
    });
  });
  it("ridge, valley, snow rail (and drip edge, rake) are sheet metals by the foot", () => {
    for (const name of ["Drip Edge", "Rake", "Valley", "Ridge", "Snow Rail"])
      expect([name, by(name).target, by(name).confidence]).toEqual([name, "metals", "high"]);
    expect(by("Snow Rail").details.kind).toBe("Snow rail");
    expect(by("Valley").details.kind).toBe("Valley");
    expect(by("Ridge").details.kind).toBe("Ridge");
  });
  it("the gutter goes to Metals › Gutters (never a Sheet Metals / accessories line)", () => {
    expect(by("Gutter")).toMatchObject({
      target: "gutter",
      confidence: "high",
      details: { where: "Metals › Gutters" },
    });
  });
  it("`Expansion Joint for Gutter` ×6 is a sheet metal piece, not a downspout part", () => {
    expect(by("Expansion Joint")).toMatchObject({
      target: "metals",
      details: { kind: "Expansion joint", where: "Non-DL › Sheet Metals" },
    });
  });
  it("downspouts: sized drops, an unsized length, and `45's` ×72 as elbows", () => {
    expect(by('4" X 5" Down Spout Drops')).toMatchObject({
      target: "downspout",
      confidence: "high",
      details: { dsSize: '4"X5"', dsPart: "Drop/Outlet" },
    });
    expect(by("Down Spouts")).toMatchObject({ target: "downspout", details: { dsPart: "length" } });
    expect(by("Down Spouts").details.dsSize).toBeUndefined();
    expect(by("45's")).toMatchObject({ target: "downspout", details: { dsPart: "elbow" } });
    expect(describeTarget(by("45's"))).toBe(
      "elbows (no size in the name), ×72 (Metals › Downspouts)",
    );
  });
  it('`30" X 60" Saftey Wal Pads` ×10 are walk pads — not a 30 × 60 in curb', () => {
    expect(by('30" X 60" Saftey Wal Pads')).toMatchObject({
      target: "accessory",
      confidence: "high",
      details: { kind: "Walk pads", widthIn: 30, lengthIn: 60 },
    });
    // The hatch beside it is still the curb.
    expect(by('30" X 54" X 12" Roof Hatch')).toMatchObject({
      target: "curb",
      details: { widthIn: 30, lengthIn: 54, heightIn: 12 },
    });
  });
  it('`3" Drain Boot` ×2 is a 3 in drain; coping and the two parapets as before', () => {
    expect(by('3" Drain Boot')).toMatchObject({ target: "drain", details: { sizeIn: 3 } });
    expect(describeTarget(by('3" Drain Boot'))).toBe('drains 3" ×2');
    expect(by("Flat Coping").target).toBe("coping");
    expect(by("Parapet 01")).toMatchObject({
      target: "parapet",
      details: { skirtIn: 6, verticalIn: 60 },
    });
    expect(by("Parapet 02")).toMatchObject({
      target: "parapet",
      details: { skirtIn: 6, verticalIn: 24 },
    });
  });
  it("the wall rows: soffit as a Contractor Applications line, the rest sheet metals", () => {
    expect(by("Metal Soffit").target).toBe("nondl");
    for (const name of [
      "J-Chanel",
      '16" Metal Fascia',
      "Metal Wall Pannel",
      "Base",
      "Header",
      "Jams",
    ])
      expect([name, by(name).target]).toEqual([name, "metals"]);
  });

  describe("→ what the review screen asks", () => {
    const review = (
      pick: (c: ClassifiedRow) => string | undefined = () => undefined,
    ): ReviewRow[] => cs.map((c) => ({ row: c, target: c.target, pick: pick(c) }));
    const sizes = sheetDownspoutSizes(review());

    it('the sheet names one downspout size, 4"X5" (from the drops)', () => {
      expect(sizes).toEqual(['4"X5"']);
    });
    it("the gutter asks for its style and size from Metals › Gutters", () => {
      const p = pickFor(by("Gutter"), "gutter", LISTS, sizes)!;
      expect(p.question).toBe("Which gutter (style and size)?");
      expect(p.options.map((o) => o.value)).toEqual([
        `D-Style${PICK_SEP}A = 6" B = 4" C = 4"`,
        `D-Style${PICK_SEP}A = 7" B = 5" C = 5"`,
        `LX-Style${PICK_SEP}A = 6" B = 4" C = 4"`,
        `LX-Style${PICK_SEP}A = 7" B = 6" C = 5"`,
      ]);
      expect(p.options[3]!.label).toBe('LX · A = 7" B = 6" C = 5"');
      // Without the gutter list nothing can be asked.
      expect(pickFor(by("Gutter"), "gutter", { metalsCatalog: METALS }, sizes)).toBeNull();
    });
    it("`45's` asks which 45° elbow of the sheet's size — the 80° rows and other sizes are not offered", () => {
      const p = pickFor(by("45's"), "downspout", LISTS, sizes)!;
      expect(p.question).toBe("Which elbow?");
      expect(p.options.map((o) => o.value)).toEqual([
        `4"X5"${PICK_SEP}45° A-Style Elbow`,
        `4"X5"${PICK_SEP}45° B-Style Elbow`,
      ]);
      expect(p.options.map((o) => o.label)).toEqual(["45° A-Style Elbow", "45° B-Style Elbow"]);
      // With no size on the sheet, every catalog size is offered, labelled with its size.
      const all = pickFor(by("45's"), "downspout", LISTS, [])!;
      expect(all.options.map((o) => o.label)).toEqual([
        '3"X4" · 45° A-Style Elbow',
        '4"X5" · 45° A-Style Elbow',
        '4"X5" · 45° B-Style Elbow',
      ]);
    });
    it("`Down Spouts` (no size) asks for the size, the sheet's first", () => {
      const p = pickFor(by("Down Spouts"), "downspout", LISTS, sizes)!;
      expect(p.question).toBe("Which size of downspout?");
      expect(p.options.map((o) => o.value)).toEqual(['4"X5"']);
      expect(
        pickFor(by("Down Spouts"), "downspout", LISTS, [])!.options.map((o) => o.value),
      ).toEqual(catalogDownspoutSizes(METALS));
    });
    it("rows the name already places ask nothing: the drops, the 3 in drain, sheet metals", () => {
      expect(pickFor(by('4" X 5" Down Spout Drops'), "downspout", LISTS, sizes)).toBeNull();
      expect(pickFor(by('3" Drain Boot'), "drain", LISTS, sizes)).toBeNull();
      expect(pickFor(by("Ridge"), "metals", LISTS, sizes)).toBeNull();
      // A drain whose size the list lacks asks which boot (the ring follows).
      const odd = { ...by('3" Drain Boot'), details: { sizeIn: 5 } };
      expect(pickFor(odd, "drain", LISTS, sizes)).toEqual({
        question: "Which drain size?",
        options: BOOTS.map((b) => ({ value: b, label: b })),
      });
    });
    it("Create bid waits on exactly the gutter, the `45's` and the unsized downspouts — and on any row with no target", () => {
      const rows = review();
      const names = (idx: number[]) => idx.map((i) => rows[i]!.row.row.name);
      expect(names(unresolvedRows(rows, LISTS, sizes))).toEqual(["Gutter", "Down Spouts", "45's"]);
      // Answered rows are resolved; a pick that is not one of the choices is not an answer.
      const answered = review((c) =>
        c.row.name === "Gutter"
          ? `LX-Style${PICK_SEP}A = 7" B = 6" C = 5"`
          : c.row.name === "Down Spouts"
            ? '4"X5"'
            : c.row.name === "45's"
              ? `4"X5"${PICK_SEP}45° A-Style Elbow`
              : undefined,
      );
      expect(unresolvedRows(answered, LISTS, sizes)).toEqual([]);
      const wrong = answered.map((r) =>
        r.row.row.name === "Gutter" ? { ...r, pick: "Gutter|7 inch" } : r,
      );
      expect(names(unresolvedRows(wrong, LISTS, sizes))).toEqual(["Gutter"]);
      // An unsure row starts with no target: it blocks until the estimator picks one.
      const blank = answered.map((r) => (r.row.row.name === "Ridge" ? { ...r, target: null } : r));
      expect(names(unresolvedRows(blank, LISTS, sizes))).toEqual(["Ridge"]);
      // Skipped and "place by hand" rows never block.
      const skipped = answered.map((r) =>
        r.row.row.name === "Gutter" ? { ...r, target: "skip" as const, pick: undefined } : r,
      );
      expect(unresolvedRows(skipped, LISTS, sizes)).toEqual([]);
      // Without the price lists there is nothing to ask: no gating.
      expect(unresolvedRows(rows, {}, sizes)).toEqual([]);
    });
    it("the picks read back", () => {
      expect(parseGutterPick(`LX-Style${PICK_SEP}A = 7" B = 6" C = 5"`)).toEqual({
        style: "LX-Style",
        size: 'A = 7" B = 6" C = 5"',
      });
      expect(parseElbowPick(`4"X5"${PICK_SEP}45° B-Style Elbow`)).toEqual({
        size: '4"X5"',
        description: "45° B-Style Elbow",
      });
      for (const bad of [undefined, "", "LX-Style", "|x", "x|"]) {
        expect(parseGutterPick(bad)).toBeNull();
        expect(parseElbowPick(bad)).toBeNull();
      }
    });
  });

  describe("→ seed, with the review screen's answers", () => {
    const choices: PlanSwiftChoice[] = cs.map((c) => {
      const ch: PlanSwiftChoice = { row: c, target: c.target };
      if (c.row.name === "Gutter") ch.pick = `LX-Style${PICK_SEP}A = 7" B = 6" C = 5"`;
      if (c.row.name === "Down Spouts") ch.pick = '4"X5"';
      if (c.row.name === "45's") ch.pick = `4"X5"${PICK_SEP}45° A-Style Elbow`;
      return ch;
    });
    const seed = planSwiftSeed(sheet, choices, {
      fileName: "Pineville_Independent_Preschool.xlsx",
      ...LISTS,
      walkPadRows: WALK_PADS,
      boardNames: ['2" ISO', '1/2" HD ISO', "Tapered ISO"],
    });

    it('Metals › Gutters: 322.3 ft of LX-Style A = 7" B = 6" C = 5" — not an accessories or Non-DL line', () => {
      expect(seed.metalsCalc.gutters).toEqual([
        { style: "LX-Style", size: 'A = 7" B = 6" C = 5"', lengthFt: 322.3, accQty: {} },
      ]);
      expect(seed.nonDlCustom.sheetMetal?.map((r) => r.description) ?? []).not.toContain("Gutter");
      expect(seed.unmapped.filter((u) => /gutter/i.test(u.label))).toEqual([]);
      expect(seed.warnings).toContain(
        'Gutter: 322.3 ft on Metals › Gutters as LX A = 7" B = 6" C = 5" — add its miters, end caps and splice plates there.',
      );
    });
    it('Metals › Downspouts: one 4"X5" entry — 254.58 ft open, 18 drops and 72 × 45° A-Style elbows', () => {
      expect(seed.metalsCalc.downspouts).toHaveLength(1);
      expect(seed.metalsCalc.downspouts[0]).toMatchObject({
        size: '4"X5"',
        lengthByDesc: { '4"X5" Downspout - Open': 254.58 },
        accQty: { "Drop/Outlet": 18, "45° A-Style Elbow": 72 },
      });
    });
    it("the Standing Seam areas are two Contractor Applications lines; the TPO roof is the only section", () => {
      const apps = seed.nonDlCustom.customApps?.map((r) => [r.description, r.qty]) ?? [];
      expect(apps).toContainEqual([
        '( 1 ) Standing Seam Metal, HT Underlayment, Coverboard, 2 Layers of 2" ISO, Steel Deck',
        6646.48,
      ]);
      expect(apps).toContainEqual([
        '( 2 ) Standing Seam Metal, HT Underlayment, Coverboard, 2 Layers of 2" Poly ISO, Wood Deck',
        3803.57,
      ]);
      expect(seed.sections).toHaveLength(1);
      const s = seed.sections[0]!;
      // Two-decimal sides: within 0.02 % of the sheet (planSwiftSectionRect).
      expect(Math.abs(s.length! * s.width! - 1904.15) / 1904.15).toBeLessThan(1e-3);
      expect(2 * (s.length! + s.width!)).toBeCloseTo(213.14, 1);
    });
    it("Sheet Metals lines: ridge, valley, snow rail, drip edge, rake, the gutter's expansion joints", () => {
      const sheetMetal = seed.nonDlCustom.sheetMetal?.map((r) => [r.description, r.qty]) ?? [];
      expect(sheetMetal).toEqual(
        expect.arrayContaining([
          ["Drip Edge", 314.11],
          ["Rake", 146.07],
          ["Valley", 45.14],
          ["Ridge", 247.45],
          ["Snow Rail", 344.59],
          ["Expansion Joint for Gutter", 6],
        ]),
      );
    });
    it("Accessories › Walk Pads: 10 of the 30 x 60 pad; Roof Drains & Boots: two 3 in drains with boot and ring; one curb", () => {
      // "Saftey" is misspelt, so the colour falls back to White with the usual check-it warning.
      expect(seed.walkPads).toEqual({ '30" x 60" White - Walk Pad': 10 });
      expect(seed.drains).toEqual([
        expect.objectContaining({
          quantity: 2,
          bootSize: '3" Drain Boot',
          ringSize: '3" Drain Rings',
        }),
      ]);
      expect(seed.curbs.map((k) => [k.name, k.quantity, k.widthIn, k.lengthIn])).toEqual([
        ['30" X 54" X 12" Roof Hatch', 1, 30, 54],
      ]);
    });
    it("nothing is left to place by hand", () => {
      expect(seed.unmapped).toEqual([]);
    });
    it("without the answers, the gutter, downspouts and elbows are listed to place, with the ask", () => {
      const plain = planSwiftSeed(
        sheet,
        cs.map((c) => ({ row: c, target: c.target })),
        { fileName: "p.xlsx", ...LISTS, walkPadRows: WALK_PADS },
      );
      expect(plain.metalsCalc.gutters).toEqual([]);
      expect(plain.unmapped.map((u) => [u.label, u.detail])).toEqual([
        [
          "Gutter: 322.3 ft",
          "Gutter — pick its style and size on the review screen, or add it on Metals › Gutters.",
        ],
        [
          "Down Spouts: 254.58 ft",
          "Downspouts with no size in the name — pick the size on Metals › Downspouts.",
        ],
        ["72 × 45's", "Elbows with no size in the name — pick the size on Metals › Downspouts."],
      ]);
    });
  });
});

describe("the review screen asks before Create bid", () => {
  const dialog = read("../../components/import-planswift-dialog.tsx");
  it("an unsure row starts with no target and a 'Pick where it goes…' box", () => {
    expect(dialog).toContain('target: c.confidence === "low" && !c.remembered ? null : c.target');
    expect(dialog).toContain('<SelectValue placeholder="Pick where it goes…" />');
  });
  it("each row gets its pick box from pickFor, and Create bid is disabled while rows are unresolved", () => {
    expect(dialog).toContain("pickFor(c, r.target, lists, sheetSizes)");
    expect(dialog).toContain("unresolvedRows(rows as ReviewRow[], lists, sheetSizes)");
    expect(dialog).toContain("disabled={busy || !preview?.seed || unresolved.length > 0}");
    expect(dialog).toContain("gutterSizesByStyle: liveAdmin?.metals?.gutters?.sizesByStyle");
  });
});
