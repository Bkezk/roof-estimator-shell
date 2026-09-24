import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readBaxXml } from "./zip";
import {
  applyLegacyPricing,
  applyLegacyWarranty,
  convertBax,
  legacyCurbTermOption,
  legacyMarkupMode,
  legacyStatusToWeb,
  normalizeLegacyName,
  parseBax,
  parseLegacyDate,
  parsePerDiemChart,
} from "./bax-import";
import { parseXml } from "./xml";
import type { EngineAdminData } from "@/lib/engine/adapters";
import type { AccessoriesState } from "@/lib/engine/accessories";
import type { NonDlState } from "@/lib/engine/nondl";
import type { WarrantyData } from "@/lib/proposal-bid";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))));

async function load(name: string) {
  const xml = await readBaxXml(fixture(name));
  return parseBax(xml);
}

const BOARDS = [
  '2 1/2" ISO',
  '2" ISO',
  '1/4" DensDeck Prime',
  "Tapered ISO",
  "Flute Filler",
  '1" ISO',
  '3" ISO',
  '5/8" DensDeck Prime',
];

describe("xml", () => {
  it("parses elements, attributes, text and entities", () => {
    const doc = parseXml(`<a x="1&amp;2"><b>t &lt; u</b><c y='q'/><b>2</b></a>`);
    expect(doc.tag).toBe("a");
    expect(doc.attrs["x"]).toBe("1&2");
    expect(doc.children.map((c) => c.tag)).toEqual(["b", "c", "b"]);
    expect(doc.children[0]!.text).toBe("t < u");
    expect(doc.children[1]!.attrs["y"]).toBe("q");
  });
  it("rejects mismatched tags", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(/Mismatched/);
  });
});

describe("helpers", () => {
  it("normalizes legacy fraction glyphs to the app's spelling", () => {
    expect(normalizeLegacyName('2½" ISO')).toBe('2 1/2" ISO');
    expect(normalizeLegacyName('¼" Dens Deck')).toBe('1/4" Dens Deck');
    expect(normalizeLegacyName('1½"')).toBe('1 1/2"');
  });
  it("reads legacy dates", () => {
    expect(parseLegacyDate("3/17/2025 9:54:19 AM")).toBe(
      new Date(2025, 2, 17, 9, 54, 19).toISOString(),
    );
    expect(parseLegacyDate("9/22/2026 2:36:51 PM")).toBe(
      new Date(2026, 8, 22, 14, 36, 51).toISOString(),
    );
    expect(parseLegacyDate("10/24/2024 12:00:00 AM")).toBe(
      new Date(2024, 9, 24, 0, 0, 0).toISOString(),
    );
    expect(parseLegacyDate("")).toBeNull();
  });
  it("maps markup modes, statuses and curb terminations", () => {
    expect(legacyMarkupMode("AccountingPercentage")).toBe(2);
    expect(legacyMarkupMode("PercentageOfSubtotal")).toBe(0);
    expect(legacyStatusToWeb("In Progress")).toBe("draft");
    expect(legacyStatusToWeb("Accepted")).toBe("won");
    expect(legacyStatusToWeb("Denied")).toBe("lost");
    expect(legacyStatusToWeb("Submitted")).toBe("submitted");
    expect(legacyCurbTermOption("IsNone")).toBe(0);
    expect(legacyCurbTermOption("IsLiftAndTuck")).toBe(2);
    expect(legacyCurbTermOption("IsNoLiftTBar")).toBe(4);
  });
  it("reads the per-diem breakdown out of the legacy notes", () => {
    const c = parsePerDiemChart(
      "Per Deim based on 45 days 5 men\n\nSupervision          7500.00\nBoom Truck        500.00\nPorta John       250.00.\nDumpsters      5000.00\nBond        8000.00\n\nTotal      22,250",
    )!;
    expect(c.men).toBe(5);
    expect(c.days).toBe(45);
    const by = Object.fromEntries(c.items.map((i) => [i.label, i]));
    expect(by["Supervision"]).toMatchObject({ checked: true, price: 7500 });
    expect(by["Boom truck"]).toMatchObject({ checked: true, price: 500 });
    expect(by["Porta jon"]).toMatchObject({ checked: true, price: 250 });
    expect(by["Dumpsters / trash"]).toMatchObject({ checked: true, price: 5000 });
    expect(by["Security bond"]).toMatchObject({ checked: true, price: 8000 });
    expect(by["Hotel"]).toMatchObject({ checked: false, price: 0 });
  });
});

describe("Knox County Fiscal Court .bax", () => {
  it("converts sections, parapets, curbs, non-DL and money settings", async () => {
    const doc = await load("knox-county-fiscal-court.bax");
    const r = convertBax(doc, { fileName: "knox.bax", boardNames: BOARDS });
    expect(r.name).toBe("Knox County Fiscal Court - Administrative Office");
    expect(r.legacyStatus).toBe("In Progress");
    expect(r.status).toBe("draft");
    expect(r.lastSavedAt).toBe(new Date(2025, 2, 17, 9, 54, 19).toISOString());
    const s = r.saved;
    expect(s.roofSystem).toBe("Duro-Bond");
    expect(s.attachment).toBe("mechanical");
    expect(s.laborRate).toBe(37);
    expect(s.markup).toBe(35);
    expect(s.markupMode).toBe(2);
    expect(s.commission).toBe(1.5);
    expect(s.perDiem).toBeCloseTo(110.6415, 4);
    expect(s.extraShipping).toBe(2000);
    expect(s.salesTaxRate).toBe(0.0625);
    expect(s.taxExempt).toBe(false);
    expect(s.taxMaterialOnly).toBe(false);
    expect(s.hoursPerDay).toBe(9);
    expect(s.warrantyName).toBe("20 Yr NDL");
    expect(s.maxWindExpected).toBe(72);
    expect(s.laborTemplateName).toBe("Standard");
    expect(s.startDate).toBe("2024-10-24");
    expect(s.formulasVersion).toBe("4.0.237");
    expect(s.importInfo?.whatIfMarkup).toBe(22.5);

    expect(s.sections).toHaveLength(3);
    const a = s.sections[0]!;
    expect(a).toMatchObject({
      length: 79.5,
      width: 98,
      deckType: "Concrete",
      thickness: 60,
      color: "White",
      sheetSizeLabel: "1000 sf",
      roofSystem: "Duro-Bond",
      attachment: "mechanical",
      pullTest: 425,
      designTable: 60,
      fieldLap: 0,
      tearOff: true,
      tearOffType: "Mechanically Fastened SP 5' centers",
      toThicknessInches: 3,
      tearOffAdditionalPct: -50,
      adjustLaborPct: -30,
      adjustUnderlaymentLaborPct: -30,
      isQuickBid: true,
    });
    expect(a.complexity).toBeUndefined();
    expect(a.layers!.map((l) => [l.board, l.attachment])).toEqual([
      ['2 1/2" ISO', "durobond"],
      ['2 1/2" ISO', "durobond"],
      ["Tapered ISO", "durobond"],
    ]);
    expect(a.layers![2]!.quote).toMatchObject({
      name: "New Quote",
      lumpSum: 36312,
      laborAmount: 100,
      laborInDays: false,
    });
    // The same quote id on every section bills once — shared id.
    expect(s.sections[1]!.layers![2]!.quote!.id).toBe(a.layers![2]!.quote!.id);
    expect(a.edges!.map((e) => [e.side, e.lengthFt, e.termination, e.termLengthFt])).toEqual([
      ["A", 79.5, '6" 2-pc Metal', 80],
      ["B", 98, '6" 2-pc Metal', 100],
      ["C", 79.5, '6" 2-pc Metal', 80],
      ["D", 98, '6" 2-pc Metal', 100],
    ]);
    expect(s.sections[1]!.deckType).toBe("Steel");
    expect(s.sections[1]!.edges![1]!.termination).toBe("No Termination");
    expect(s.sections[1]!.tearOffType).toBe("Single Ply MF 5' over BUR < 2\"");
    expect(s.sections[2]!.sheetSizeLabel).toBe("500 sf");
    expect(s.sections[2]!.adjustUnderlaymentLaborPct).toBe(9189);
    expect(r.warnings.some((w) => /9189%/.test(w))).toBe(true);

    expect(s.parapets).toHaveLength(2);
    expect(s.parapets![0]).toMatchObject({
      lengthFt: 240,
      pieces: 3,
      skirtInches: 6,
      verticalInches: 18,
      girthInches: 24,
      wallType: 4,
      thicknessMil: 60,
      roofSystem: "Duro-Last",
      attachment: "mechanical",
      termOptionId: 2,
      termLengthFt: 40,
      deckType: "Steel",
    });
    expect(s.parapets![1]!.termOptionId).toBeUndefined();
    expect(s.curbs).toHaveLength(2);
    expect(s.curbs![0]).toMatchObject({
      widthIn: 32,
      lengthIn: 38,
      dimCIn: 12,
      dimDIn: 6,
      curbType: "Open",
      styleId: 1,
      thicknessMil: 40,
      deckType: "Steel",
    });
    expect(s.curbs![0]!.termOption).toBeUndefined();

    const custom = (s.nonDlCalc as NonDlState).custom;
    expect(custom.customApps).toHaveLength(19);
    expect(custom.customApps![0]).toEqual({
      description: "Standard Roof Hatch",
      qty: 1,
      unitCost: 750,
      laborPerUnit: 10,
      laborRate: 37,
      laborHours: 10,
    });
    expect(custom.subcontractors![0]).toMatchObject({
      description: "HVAC",
      unitCost: 13438,
      laborRate: 40,
    });
    expect(custom.roofEdgeBlocking).toHaveLength(2);
    expect(custom.sheetMetal![0]).toMatchObject({
      description: '8" Edge Extender & Cleat',
      qty: 1160,
      unitCost: 5.85,
      laborPerUnit: 0.08,
      laborHours: 96,
    });
    expect(custom.deckMaterials![0]).toMatchObject({ description: "5/8 OSB", qty: 50 });

    const acc = s.accessoriesCalc as AccessoriesState;
    expect(acc.corners.qty).toEqual({ 'Outside 6" x 6"': { White: 20 } });
    expect(acc.drains).toHaveLength(1);
    expect(acc.drains[0]).toMatchObject({
      quantity: 9,
      bootSize: '4" Drain Boot',
      ringSize: '4" Drain Rings',
      roofType: "None",
      reuseRings: false,
    });
    expect(acc.fastenerQty.concrete).toMatchObject({ "Induction Welding Plates|DL-Plates": 1500 });
    expect(acc.fastenerQty.metal).toMatchObject({
      "Induction Welding Plates|DL-Plates": 2000,
      '2" Poly Plates|DL-Plates': 1100,
    });
    expect(acc.fastenerQty.parapet).toMatchObject({ '1 1/2"|Spade': 1000 });
    expect(acc.fastenerQty.snapCover).toMatchObject({ '1 1/2"|Spade': 4000 });
    expect(acc.fastenerQty.termBar).toMatchObject({ '1 1/2"|Spade': 200 });
    expect(acc.pipeStacks[0]).toMatchObject({
      quantity: 1,
      size: 3,
      open: false,
      usage: "Plumbing",
      color: "White",
    });
    expect(acc.sealants.extra).toEqual({ "1136": 16 });
    expect(acc.strainers.qty).toEqual({ "Dome Strainer": 90 });
    expect(acc.snapCover["6"]).toMatchObject({ coversOn: true, coversQty: 600 });
    expect(acc.vents.delta).toEqual({ "White Vent": 1 });
    expect(acc.walkPads.qty).toEqual({ '30"X 60" Safety Fully Skirted Walk Pad': 10 });
    expect(s.metals).toEqual([]);

    expect(s.customer.perDiemChart?.men).toBe(5);
    expect(s.customer.perDiemChart?.days).toBe(45);
    expect(s.customer.notes).toMatch(/^Per Deim based on 45 days 5 men/);
    expect(s.sectionDefaults).toMatchObject({ deckType: "Steel", thickness: 60, color: "White" });
  });
});

describe("Summit Project .bax", () => {
  it("converts an adhered Duro-Fleece bid with metals and layer adhesives", async () => {
    const doc = await load("summit-project.bax");
    const r = convertBax(doc, { fileName: "summit.bax", boardNames: BOARDS });
    const s = r.saved;
    expect(r.name).toBe("Summit Project");
    expect(s.roofSystem).toBe("Duro-Fleece");
    expect(s.attachment).toBe("adhered");
    expect(s.membraneAdhesiveName).toBe("Duro-Grip Adhesive(CR-20)");
    expect(s.laborRate).toBe(45);
    expect(s.markup).toBe(35);
    expect(s.importInfo?.whatIfMarkup).toBeNull();
    const a = s.sections[0]!;
    expect(a).toMatchObject({
      length: 100,
      width: 80,
      deckType: "Steel",
      thickness: 60,
      sheetSizeLabel: "Roll Good",
      fieldLap: 60,
      complexity: 3,
    });
    expect(a.layers!.map((l) => [l.board, l.attachment, l.adhesiveName])).toEqual([
      ['2" ISO', "none", ""],
      ['2" ISO', "mechanical", ""],
      ['1/4" DensDeck Prime', "adhesive", "Duro-Grip Adhesive(CR-20)"],
    ]);
    expect(a.edges!.map((e) => e.termination)).toEqual([
      "T-Bar",
      '6" 2-pc Metal',
      "T-Bar",
      '6" 2-pc Metal',
    ]);
    const acc = s.accessoriesCalc as AccessoriesState;
    expect(acc.adhesivesExtra).toEqual({ "Duro-Grip Adhesive(CR-20)": 2 });
    expect(acc.pipeStacks[0]).toMatchObject({ quantity: 4, size: 4, open: true });
    expect(acc.fastenerQty.metal).toEqual({
      '3" Insulation Plates|DL-Plates': 2500,
      '6"|Spade': 2500,
    });
    // Metals keep the legacy per-line money.
    const gutter = s.metals!.find((m) => m.description.startsWith("Gutter LX-6"))!;
    expect(gutter).toMatchObject({ quantity: 220, price: 12.5, laborPerUnit: 0.15, laborRate: 45 });
    expect(s.metals!.find((m) => m.description.startsWith("End Caps (Left)"))).toMatchObject({
      quantity: 4,
      price: 33.85,
    });
    expect(s.metals!.find((m) => m.description.startsWith("Downspout DS-45"))).toMatchObject({
      quantity: 120,
      price: 11.7,
      laborPerUnit: 0.15,
    });
    expect(s.metals!.find((m) => m.description === "Downspout Straps")).toMatchObject({
      quantity: 30,
      price: 2.2,
    });
    expect((s.nonDlCalc as NonDlState).custom.customApps![0]).toMatchObject({
      description: "Vinyl Ribs",
      qty: 6000,
      unitCost: 2.07,
      laborHours: 90,
    });
    expect(s.customer.perDiemChart).toMatchObject({ men: 5, days: 11 });
  });
});

describe("Monticello and Broad Head .bax", () => {
  it("converts seven parapets, canted-free curbs and shared quotes", async () => {
    const doc = await load("monticello-banking-2026.bax");
    const r = convertBax(doc, { fileName: "monticello.bax", boardNames: BOARDS });
    expect(r.saved.parapets).toHaveLength(7);
    expect(r.saved.parapets![0]).toMatchObject({
      lengthFt: 60,
      verticalInches: 66,
      wallType: 1,
      deckType: "Wood",
      thicknessMil: 50,
    });
    expect(r.saved.curbs![0]).toMatchObject({ hasInsulation: true, widthIn: 83, lengthIn: 77 });
    expect(r.saved.sections[0]!.layers!.map((l) => l.attachment)).toEqual([
      "durobond",
      "durobond",
      "durobond",
      "durobond",
    ]);
    expect(r.saved.sections[0]!.adjustLaborPct).toBe(18);
    expect((r.saved.accessoriesCalc as AccessoriesState).drains[0]).toMatchObject({
      quantity: 3,
      bootSize: '6" Drain Boot',
      ringSize: '6" Drain Rings',
    });
  });
  it("converts the tax-exempt Broad Head bid with blocking edges and two quotes", async () => {
    const doc = await load("broad-head-elementary.bax");
    const r = convertBax(doc, { fileName: "broad-head.bax", boardNames: BOARDS });
    const s = r.saved;
    expect(r.name).toBe("Broad Head Elementary");
    expect(s.taxExempt).toBe(true);
    expect(s.salesTaxRate).toBe(0);
    expect(s.extraShipping).toBe(2500);
    expect(s.sections).toHaveLength(10);
    const a = s.sections[0]!;
    expect(a.layers![0]).toMatchObject({ board: "Flute Filler", attachment: "none" });
    expect(a.layers![0]!.quote).toMatchObject({ lumpSum: 46230, laborAmount: 200 });
    expect(a.layers![1]).toMatchObject({ board: '1" ISO', attachment: "mechanical" });
    expect(a.layers![2]).toMatchObject({ board: '1/4" DensDeck Prime', attachment: "adhesive" });
    expect(a.edges![0]).toMatchObject({
      side: "A",
      blockingFt: 235,
      termination: '8" 2-pc Metal',
      termLengthFt: 235,
    });
    expect(a.edges![1]).toMatchObject({ side: "B", blockingFt: 1, termination: "No Termination" });
    expect(s.sections[8]!.adjustLaborPct).toBe(100);
    expect((s.accessoriesCalc as AccessoriesState).pipeStacks[0]).toMatchObject({
      quantity: 50,
      size: 6,
      color: "Terra Cotta",
    });
    expect((s.accessoriesCalc as AccessoriesState).snapCover["8"]).toMatchObject({
      coversOn: true,
      coversQty: 1630,
    });
    expect(s.metals!.filter((m) => /^Downspout (DS|OFD)-/.test(m.description))).toHaveLength(2);
  });
});

describe("pricing overlay", () => {
  const admin: EngineAdminData = {
    deckOrder: [],
    priceMatrix: { 60: { tab60: { White: 9.99 } } },
    labor: {},
    settings: {
      hoursPerDay: 8,
      masterEliteCont: true,
      salesTax: 0.06,
      taxMaterialOnly: false,
      shippingMode: "percent",
      shippingPercent: 5,
    },
    adhesivePrices: { "Water Based Adhesive": 1, "Duro-Grip Adhesive(CR-20)": 1 },
    familyMembranePrices: { "Duro-Bond": { "60": 9 } },
    setupTable: { minimum: 1, bands: [] },
    inspectionTable: { minimum: 1, bands: [] },
  };
  it("overlays the Knox 2024 membrane prices, adhesives, settings and freight", async () => {
    const doc = await load("knox-county-fiscal-court.bax");
    const { admin: out, applied } = applyLegacyPricing(admin, doc);
    expect(out.priceMatrix[60]!.tab60!["White"]).toBe(1.35);
    expect(out.priceMatrix[60]!.tab28!["Tan"]).toBe(1.45);
    expect(out.priceMatrix[50]!.rollGoods!["Rock Ply"]).toBe(1.68);
    expect(out.priceMatrix[40]!.tab28!["Terra Cotta"]).toBeUndefined();
    expect(out.familyMembranePrices!["Duro-Bond"]!["60"]).toBe(1.04);
    expect(out.familyMembranePrices!["Duro-Tuff"]!["50"]).toBe(0.94);
    expect(out.familyMembranePrices!["Duro-Fleece"]!["60mil"]).toBe(1.32);
    expect(out.familyMembranePrices!["Duro-Fleece"]!["50mil Plus"]).toBe(1.67);
    expect(out.adhesivePrices!["Duro-Grip Adhesive(CR-20)"]).toBe(850);
    expect(out.settings).toMatchObject({
      hoursPerDay: 9,
      salesTax: 0.0625,
      taxMaterialOnly: true,
      shippingMode: "stepped",
      shippingPercent: 0,
    });
    expect(out.shippingSteps![0]).toEqual({ fromThreshold: 0, cost: 550 });
    expect(out.shippingSteps).toHaveLength(10);
    expect(out.inspectionTable!.bands).toHaveLength(7);
    expect(out.setupTable).toEqual({
      minimum: 16,
      bands: [
        { upTo: 6000, value: 0.003, multiply: true },
        { upTo: 20000, value: 0.003, multiply: true },
        { upTo: 100000, value: 0.003, multiply: true },
      ],
    });
    // The live admin object is untouched.
    expect(admin.priceMatrix[60]!.tab60!["White"]).toBe(9.99);
    expect(applied.some((a) => a.startsWith("Duro-Last membrane prices"))).toBe(true);
  });
  it("differs between the 2024 Knox file and the 2026 Summit file", async () => {
    const knox = applyLegacyPricing(admin, await load("knox-county-fiscal-court.bax")).admin;
    const summit = applyLegacyPricing(admin, await load("summit-project.bax")).admin;
    expect(knox.priceMatrix[60]!.tab28!["White"]).toBe(1.42);
    expect(summit.priceMatrix[60]!.tab28!["White"]).toBe(1.6);
  });
  it("overlays warranty prices and high-wind upcharges by name / band", async () => {
    const live: WarrantyData = {
      warranties: [{ name: "20 Yr NDL", pricePerSqFt: 1, nonMasterEliteSurcharge: 1 }],
      highWind: [{ termYears: 20, windBand: "91-100", mechPerSqFt: 0, adheredPerSqFt: 0 }],
    };
    const { warranty } = applyLegacyWarranty(live, await load("knox-county-fiscal-court.bax"));
    expect(warranty.warranties[0]!.pricePerSqFt).toBe(0.08);
    expect(warranty.highWind[0]).toMatchObject({ mechPerSqFt: 0.13, adheredPerSqFt: 0.14 });
  });
});
