import { describe, expect, it } from "vitest";

import type { BidSectionInput, ParapetInput } from "@/lib/engine/bid-builder";
import { parapetFromDefaults } from "@/lib/takeoff/seed-to-bid";
import {
  applyParapetDefaultsToWalls,
  applySectionDefaultsToSections,
  nearestMil,
  offeredMils,
  parapetMilChoices,
  parseParapetMilChoice,
  sectionMilChoices,
  snapBidMils,
  snapParapetDefaults,
  type MilAdmin,
  type MilBidState,
} from "./bid-mils";

const admin: MilAdmin = {
  labor: {
    "Duro-Last|mechanical": { thicknessLaborByMil: { 40: 1, 50: 1.15, 60: 1.25 } },
    "Duro-Last|adhesive": { thicknessLaborByMil: { 40: 1, 50: 1.15, 60: 1.25 } },
    "Duro-Tech TPO|mechanical": { thicknessLaborByMil: { 45: 1, 60: 1, 80: 1.075 } },
    "Duro-Tech TPO|adhesive": { thicknessLaborByMil: { 45: 1, 60: 1, 80: 1.075 } },
    "Duro-Tuff|mechanical": { thicknessLaborByMil: { 50: 1.15, 60: 1.25 } },
    "Duro-Bond|mechanical": { thicknessLaborByMil: {} },
  },
};

const sec = (d: Partial<BidSectionInput>) =>
  ({ id: "s", name: "Section", length: 10, width: 10, thickness: 40, ...d }) as BidSectionInput;
const wall = (d: Partial<ParapetInput>) =>
  ({ id: "p", name: "Parapet", lengthFt: 10, ...d }) as ParapetInput;

describe("offeredMils", () => {
  it("reads the combo's thickness table, ascending", () => {
    expect(offeredMils(admin, "Duro-Tech TPO", "mechanical")).toEqual([45, 60, 80]);
    expect(offeredMils(admin, "Duro-Tech TPO", "adhered")).toEqual([45, 60, 80]);
    expect(offeredMils(admin, "Duro-Last", "mechanical")).toEqual([40, 50, 60]);
    expect(offeredMils(admin, "Duro-Tuff", "mechanical")).toEqual([50, 60]);
  });
  it("falls back to the legacy 40/50/60 when the combo has no table (or no combo)", () => {
    expect(offeredMils(admin, "Duro-Bond", "mechanical")).toEqual([40, 50, 60]);
    expect(offeredMils(admin, "Duro-Tuff", "adhered")).toEqual([40, 50, 60]);
    expect(offeredMils(null, "Duro-Last", "mechanical")).toEqual([40, 50, 60]);
  });
  it("ignores non-numeric keys (Duro-Fleece '50 Plus')", () => {
    const a: MilAdmin = {
      labor: {
        "Duro-Fleece|adhesive": {
          thicknessLaborByMil: { 50: 1, "50 Plus": 1, 60: 1 } as unknown as Record<number, number>,
        },
      },
    };
    expect(offeredMils(a, "Duro-Fleece", "adhered")).toEqual([50, 60]);
  });
});

describe("nearestMil", () => {
  it("picks the closest offered mil", () => {
    expect(nearestMil([45, 60, 80], 40)).toBe(45);
    expect(nearestMil([45, 60, 80], 75)).toBe(80);
    expect(nearestMil([40, 50, 60], 45)).toBe(50); // tie 40/50 → the thicker
    expect(nearestMil([45, 60, 80], 70)).toBe(80); // tie 60/80 → the thicker
    expect(nearestMil([50, 60], 55)).toBe(60);
    expect(nearestMil([40, 50, 60], 45.5)).toBe(50);
  });
  it("prefers 60 only when nothing is wanted", () => {
    expect(nearestMil([45, 60, 80], undefined)).toBe(60);
    expect(nearestMil([45, 60, 80], 0)).toBe(60);
    expect(nearestMil([45, 75, 90], undefined)).toBe(45);
    expect(nearestMil([45, 60, 80], 50)).toBe(45); // wanted 50: 45 is closer than 60
  });
});

describe("snapBidMils", () => {
  const state: MilBidState = {
    roofSystem: "Duro-Last",
    attachment: "mechanical",
    sections: [
      sec({ id: "s1", name: "Section 1", thickness: 50 }),
      sec({ id: "s2", name: "Section 2", thickness: 50, roofSystem: "Duro-Tech TPO" }),
    ],
    parapets: [
      wall({ id: "p1", name: "Parapet 1", thicknessMil: 50, roofSystem: "Duro-Tech TPO" }),
      wall({ id: "p2", name: "Parapet 2", thicknessMil: 60 }),
      wall({ id: "p3", name: "Parapet 3" }),
    ],
    sectionDefaults: {
      deckType: "Wood",
      thickness: 50,
      color: "White",
      sheetSizeLabel: "1500 sf",
    },
    parapetDefaults: { wallType: 4, thicknessMil: 40 },
  };

  it("corrects only the TPO section and TPO wall, with a sentence each", () => {
    const r = snapBidMils(state, admin);
    expect(r.changes).toEqual([
      "Section 2: 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.",
      "Parapet 1: 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.",
    ]);
    expect(r.state.sections.map((s) => s.thickness)).toEqual([50, 45]);
    expect(r.state.parapets!.map((p) => p.thicknessMil)).toEqual([45, 60, undefined]);
    // The valid Duro-Last ones are the same objects.
    expect(r.state.sections[0]).toBe(state.sections[0]);
    expect(r.state.parapets![1]).toBe(state.parapets![1]);
    expect(r.state.parapets![2]).toBe(state.parapets![2]);
    expect(r.state.sectionDefaults).toBe(state.sectionDefaults);
    expect(r.state.parapetDefaults).toBe(state.parapetDefaults);
    // The input is not mutated.
    expect(state.sections[1]!.thickness).toBe(50);
  });

  it("is idempotent: a corrected state comes back as the same object", () => {
    const ok: MilBidState = {
      roofSystem: "Duro-Tech TPO",
      attachment: "mechanical",
      sections: [sec({ thickness: 60 }), sec({ thickness: 80, roofSystem: "Duro-Last" })],
      parapets: [wall({ thicknessMil: 45 }), wall({})],
      sectionDefaults: { deckType: "Wood", thickness: 60, color: "White", sheetSizeLabel: "" },
      parapetDefaults: { thicknessMil: 80 },
    };
    // Section 2 is Duro-Last at 80 — not offered — so fix it and prove the rest is untouched.
    const fixed = snapBidMils(ok, admin);
    expect(fixed.changes).toEqual([
      'Section 2 "Section": 80 mil is not offered for Duro-Last (40, 50, 60) — set to 60 mil.',
    ]);
    const again = snapBidMils(fixed.state, admin);
    expect(again.changes).toEqual([]);
    expect(again.state).toBe(fixed.state);
  });

  it("checks the Setup defaults against the bid / parapet system (the Update Pricing case)", () => {
    // Pricing updated to an admin where the bid's system is TPO: the 50 mil defaults snap.
    const s: MilBidState = {
      roofSystem: "Duro-Tech TPO",
      attachment: "adhered",
      sections: [],
      sectionDefaults: { deckType: "Wood", thickness: 50, color: "White", sheetSizeLabel: "" },
      parapetDefaults: { roofSystem: "Duro-Last", thicknessMil: 45 },
    };
    const r = snapBidMils(s, admin);
    expect(r.changes).toEqual([
      "Roof-section default: 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.",
      "Parapet default: 45 mil is not offered for Duro-Last (40, 50, 60) — set to 50 mil.",
    ]);
    expect(r.state.sectionDefaults!.thickness).toBe(45);
    expect(r.state.parapetDefaults!.thicknessMil).toBe(50);
  });

  it("pins a wall that inherits a mil its own system lacks", () => {
    const s: MilBidState = {
      roofSystem: "Duro-Last",
      attachment: "mechanical",
      sections: [sec({ thickness: 50 })],
      parapets: [wall({ name: "North", roofSystem: "Duro-Tech TPO" })],
    };
    const r = snapBidMils(s, admin);
    expect(r.changes).toEqual([
      'Parapet 1 "North": the bid default 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.',
    ]);
    expect(r.state.parapets![0]!.thicknessMil).toBe(45);
  });

  it("checks against the NEW admin (a mil dropped from a system's table)", () => {
    const s: MilBidState = {
      roofSystem: "Duro-Tuff",
      attachment: "mechanical",
      sections: [sec({ thickness: 40 })],
    };
    // Old admin: no Duro-Tuff table → legacy 40/50/60, 40 is fine.
    expect(snapBidMils(s, { labor: {} }).changes).toEqual([]);
    // New admin: Duro-Tuff offers 50/60 only.
    const r = snapBidMils(s, admin);
    expect(r.state.sections[0]!.thickness).toBe(50);
    expect(r.changes).toEqual([
      'Section 1 "Section": 40 mil is not offered for Duro-Tuff (50, 60) — set to 50 mil.',
    ]);
  });
});

describe("snapParapetDefaults (Setup 5. Parapets Material system change)", () => {
  it("snaps the default mil to the new parapet system", () => {
    const r = snapParapetDefaults(
      { roofSystem: "Duro-Tech TPO", thicknessMil: 50 },
      { roofSystem: "Duro-Last", attachment: "mechanical" },
      40,
      admin,
    );
    expect(r.parapetDefaults.thicknessMil).toBe(45);
    expect(r.change).toBe(
      "Parapet default: 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.",
    );
  });
  it("pins an inherited roof-section default the parapet system lacks", () => {
    const r = snapParapetDefaults(
      { roofSystem: "Duro-Tech TPO" },
      { roofSystem: "Duro-Last", attachment: "mechanical" },
      60,
      admin,
    );
    expect(r).toEqual({ parapetDefaults: { roofSystem: "Duro-Tech TPO" }, change: null });
    const r2 = snapParapetDefaults(
      { roofSystem: "Duro-Tech TPO" },
      { roofSystem: "Duro-Last", attachment: "mechanical" },
      40,
      admin,
    );
    expect(r2.parapetDefaults.thicknessMil).toBe(45);
  });
});

describe("applyParapetDefaultsToWalls (Setup 'Apply to Existing Parapets')", () => {
  const walls = [
    wall({ id: "p1", name: "Parapet 1", thicknessMil: 60, color: "Tan" }),
    wall({ id: "p2", name: "Parapet 2", roofSystem: "Duro-Tech TPO", thicknessMil: 80 }),
  ];
  const bid = { roofSystem: "Duro-Last", attachment: "mechanical" as const };

  it("copies the defaults and snaps a copied mil the wall's system does not offer", () => {
    // Defaults saved before the parapet system was switched to TPO (older bid / import).
    const r = applyParapetDefaultsToWalls(
      walls,
      {
        parapetDefaults: { roofSystem: "Duro-Tech TPO", thicknessMil: 50, color: "White" },
        deckType: "Steel",
        bid,
        inheritedMil: 40,
      },
      admin,
    );
    expect(r.parapets.map((p) => [p.roofSystem, p.thicknessMil, p.color, p.deckType])).toEqual([
      ["Duro-Tech TPO", 45, "White", "Steel"],
      ["Duro-Tech TPO", 45, "White", "Steel"],
    ]);
    expect(r.changes).toEqual([
      "Parapet 1: 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.",
      "Parapet 2: 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.",
    ]);
  });

  it("back to 'bid default' clears the overrides (nothing to snap)", () => {
    const r = applyParapetDefaultsToWalls(
      walls,
      { parapetDefaults: { wallType: 1 }, deckType: "Wood", bid, inheritedMil: 50 },
      admin,
    );
    expect(r.parapets[0]).toMatchObject({ wallType: 1, deckType: "Wood" });
    expect(
      r.parapets.every((p) => p.roofSystem === undefined && p.thicknessMil === undefined),
    ).toBe(true);
    expect(r.changes).toEqual([]);
  });
});

describe("applySectionDefaultsToSections (Setup 'Apply To Existing Roof Sections')", () => {
  it("copies the defaults onto every section and snaps a mil the bid system does not offer", () => {
    const sections = [
      sec({ id: "s1", name: "Section 1", thickness: 60, roofSystem: "Duro-Last" }),
      sec({ id: "s2", name: "Section 2", thickness: 80 }),
    ];
    const r = applySectionDefaultsToSections(
      sections,
      { deckType: "Steel", thickness: 50, color: "Gray", sheetSizeLabel: "", designTable: 90 },
      { roofSystem: "Duro-Tech TPO", attachment: "mechanical" },
      admin,
    );
    expect(r.sections.map((s) => [s.roofSystem, s.thickness, s.color, s.deckType])).toEqual([
      [undefined, 45, "Gray", "Steel"],
      [undefined, 45, "Gray", "Steel"],
    ]);
    expect(r.changes).toEqual([
      "Section 1: 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.",
      "Section 2: 50 mil is not offered for Duro-Tech TPO (45, 60, 80) — set to 45 mil.",
    ]);
  });
});

describe("seed-to-bid parapetFromDefaults (guard)", () => {
  it("a wall seeded from valid parapet defaults passes snapBidMils unchanged", () => {
    const pd = { roofSystem: "Duro-Tech TPO", attachment: "adhered" as const, thicknessMil: 60 };
    const w = { id: "p1", name: "Parapet 1", lengthFt: 50, ...parapetFromDefaults(pd, "Wood") };
    const state: MilBidState = {
      roofSystem: "Duro-Last",
      attachment: "mechanical",
      sections: [sec({ thickness: 50 })],
      parapets: [w as ParapetInput],
      parapetDefaults: pd,
    };
    const r = snapBidMils(state, admin);
    expect(r.changes).toEqual([]);
    expect(r.state).toBe(state);
  });
});

describe("picker lists", () => {
  it("Sections 'Type (mil)': a saved mil that is not offered reads '(not offered)'", () => {
    expect(sectionMilChoices([45, 60, 80], 60)).toEqual({
      options: ["45", "60", "80"],
      value: "60",
      notOffered: false,
    });
    expect(sectionMilChoices([45, 60, 80], 50)).toEqual({
      options: ["50 (not offered)", "45", "60", "80"],
      value: "50 (not offered)",
      notOffered: true,
    });
  });

  it("Parapets 'Mil': the wall system's mils + 'Bid default (N mil)', never a mil it lacks", () => {
    // A TPO wall on a Duro-Last 50 mil bid: no 40/50 in the list.
    const tpo = parapetMilChoices([45, 60, 80], 60, 50);
    expect(tpo.options).toEqual(["45 mil", "60 mil", "80 mil"]);
    expect(tpo.value).toBe("60 mil");
    // The bid default is listed when the wall's system offers it (and not twice).
    const dl = parapetMilChoices([40, 50, 60], undefined, 50);
    expect(dl).toEqual({
      options: ["Bid default (50 mil)", "40 mil", "60 mil"],
      value: "Bid default (50 mil)",
      notOffered: false,
    });
    expect(parapetMilChoices([40, 50, 60], 50, 50).value).toBe("Bid default (50 mil)");
    // A wall on a not-offered mil shows it as such (so it can be re-picked).
    const bad = parapetMilChoices([45, 60, 80], 50, 60);
    expect(bad.options).toEqual([
      "50 mil (not offered)",
      "Bid default (60 mil)",
      "45 mil",
      "80 mil",
    ]);
    expect(bad.notOffered).toBe(true);
    expect(parseParapetMilChoice("Bid default (60 mil)")).toBeUndefined();
    expect(parseParapetMilChoice("80 mil")).toBe(80);
  });
});
