import { describe, it, expect } from "vitest";

import { emptyAccessoriesState } from "./accessories";
import type { EngineAdminData } from "./adapters";
import {
  applyLaborTemplate,
  laborTemplateDeltas,
  seedCurbAdjust,
  seedParapetAdjust,
  seedSectionAdjust,
  toInt32,
} from "./labor-template";

const admin = {
  laborTemplates: {
    names: ["Standard", "Heavy"],
    defaultName: "Standard",
    byName: {
      Standard: { "Roof Section Labor": 0 },
      Heavy: {
        "Roof Section Labor": 15,
        "Underlayment Labor": 5,
        "Curbs Labor": 20,
        "Parapets Labor": 25,
        "Tear-Off Labor": 12.5,
        "Pipe Stacks Labor": 30,
        "Drains Labor": 35,
        "Setup Time Labor": 40,
        "Inspection Time Labor": -10,
        "Edge Termination Labor": 8,
      },
    },
  },
} as unknown as Pick<EngineAdminData, "laborTemplates">;

describe("labor templates — legacy frmHome.updateTemplate field writes (§20.3)", () => {
  it("reads percent adjustments by area; unknown / none → all zero", () => {
    expect(laborTemplateDeltas(admin, "Heavy").curbs).toBe(20);
    expect(laborTemplateDeltas(admin, "Heavy").inspection).toBe(-10);
    expect(laborTemplateDeltas(admin, "Standard").tearOff).toBe(0);
    expect(laborTemplateDeltas(admin, "Nope").roofSection).toBe(0);
    expect(laborTemplateDeltas(admin, "").setup).toBe(0);
    expect(laborTemplateDeltas(undefined, "Heavy").setup).toBe(0);
  });

  it("Convert.ToInt32 is banker's rounding (TO_Additional is an integer percent)", () => {
    expect(toInt32(12.5)).toBe(12);
    expect(toInt32(13.5)).toBe(14);
    expect(toInt32(12.6)).toBe(13);
    expect(toInt32(-0.4)).toBe(0);
  });

  it("writes every item: sections (bid-level + underlayment + TO_Additional), parapets (RoofSectionLabor quirk), curbs, accessories", () => {
    const d = laborTemplateDeltas(admin, "Heavy");
    const acc = emptyAccessoriesState();
    acc.pipeStacks = [
      {
        id: "s1",
        usage: "Plumbing",
        color: "White",
        open: false,
        size: 4,
        quantity: 1,
        adjustPct: 0,
      },
    ];
    acc.drains = [
      {
        id: "d1",
        quantity: 1,
        roofType: "BUR",
        reuseRings: false,
        bootSize: "4",
        ringSize: "4",
        adjustPct: -5,
      },
    ];
    const w = applyLaborTemplate(
      {
        sections: [
          { id: "s1", adjustLaborPct: 99, adjustUnderlaymentLaborPct: 1 } as never,
          { id: "s2" } as never,
        ],
        parapets: [{ id: "p1", adjustLaborPct: 3 } as never],
        curbs: [{ id: "c1" } as never],
        accessoriesCalc: acc,
      },
      d,
    );
    expect(w.adjustLaborPct).toBe(15);
    expect(w.adjustSetupPct).toBe(40);
    expect(w.adjustInspectionPct).toBe(-10);
    // Sections: per-section RoofSection.AdjustLabor overrides are cleared (the bid-level default
    // now carries the template value); underlayment + TO_Additional (12.5 → 12) written.
    expect(w.sections.map((s) => s.adjustLaborPct)).toEqual([undefined, undefined]);
    expect(w.sections.map((s) => s.adjustUnderlaymentLaborPct)).toEqual([5, 5]);
    expect(w.sections.map((s) => s.tearOffAdditionalPct)).toEqual([12, 12]);
    // Legacy quirk: existing parapets get RoofSectionLabor (15), not ParapetsLabor (25).
    expect(w.parapets[0]!.adjustLaborPct).toBe(15);
    expect(w.curbs[0]!.adjustLaborPct).toBe(20);
    expect(w.accessoriesCalc.pipeStacks[0]!.adjustPct).toBe(30);
    expect(w.accessoriesCalc.drains[0]!.adjustPct).toBe(35);
    expect(w.accessoriesCalc.termBar.adjustNoDrillPct).toBe(8);
    expect(w.accessoriesCalc.termBar.adjustPreDrillPct).toBe(8);
    expect(w.accessoriesCalc.fascia["3"].adjustPreDrillPct).toBe(8);
    expect(w.accessoriesCalc.dripEdge["2"].adjustPct).toBe(8);
    expect(w.accessoriesCalc.gravelStop["4"].adjustPct).toBe(8);
    expect(w.accessoriesCalc.snapCover["3"].adjustPct).toBe(8);
    // Untouched areas keep their values.
    expect(w.accessoriesCalc.corners.adjustPct).toBe(0);
    // New items seed from the template like the legacy constructors (Parapet → ParapetsLabor).
    expect(seedParapetAdjust(d)).toBe(25);
    expect(seedCurbAdjust(d)).toBe(20);
    expect(seedSectionAdjust(d)).toEqual({
      adjustUnderlaymentLaborPct: 5,
      tearOffAdditionalPct: 12,
    });
  });
});
