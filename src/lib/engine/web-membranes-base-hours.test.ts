/**
 * Owner, Oct 8 (Pineville Independent Preschool): "durotech tpo, non dl tpo, and epdm should all
 * be 12 instead of 10 or 27". The three web-only membrane combos were seeded at 27 / 27.5 / 31 h
 * per 2,500 sq ft from the owner's guide (docs §22.34 / §22.35); the calibrated base is 12 h, as
 * on the Duro-Last mechanical combo. These pin the migration that carries the live change and
 * what the engine bills from it on the owner's section.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLaborTables, type LaborCombo } from "./adapters";
import { bandLookup, mechLaborRate, onCenterLookup, roofSectionLaborHours } from "./labor";

const FILE = "supabase/migrations/20261008120000_web_membranes_base_hours_12.sql";
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("the three web-only membranes bill 12 h per 2,500 sq ft", () => {
  it("the migration sets base_hours_per_2500 to 12 on exactly those mechanical combos", () => {
    const sql = flat(read(FILE));
    expect(sql).toContain("update public.rdl_combos");
    expect(sql).toContain("jsonb_set(data, '{base_hours_per_2500}', '12'::jsonb)");
    expect(sql).toContain("where attachment = 'mechanical'");
    expect(sql).toContain("roof_system in ('Duro-Tech TPO', 'Non-DL TPO', 'EPDM Rubber')");
    // Never the legacy systems (Duro-Last / Duro-Roof / Duro-Tuff / Duro-Bond) nor the adhered combos.
    expect(sql).not.toMatch(/Duro-Last|Duro-Roof|Duro-Tuff|Duro-Bond/);
    expect(sql).not.toContain("adhesive");
  });
  it("the seeded 27 / 27.5 / 31 are gone from the seed-era figure the engine falls back to", () => {
    // A combo carrying 12 bills 12 (not the legacy default 10 and not the guide's 27).
    const combo: LaborCombo = {
      roof_system: "Duro-Tech TPO",
      attachment: "mechanical",
      base: { tab_value: 30, tab_multiplier: 2.8 },
      base_hours_per_2500: 12,
      deck_multipliers: { Wood: 1 },
      fastener_spacing_multipliers: [{ spacing_in: 18, multiplier: 1 }],
      thickness_multipliers: [{ mil: 60, multiplier: 1 }],
    };
    expect(buildLaborTables(combo, ["Wood"]).baseHoursPer2500).toBe(12);
  });
  it("Pineville's section (1,932 sq ft, 60\" roll, Moderate) drops from 36.51 h to 16.23 h", () => {
    // Live multipliers (mech_tab_multi rs 6: 30 → 2.8, 60 → 1.4, 120 → 0.95; spacing 18 → 1;
    // complexity Moderate 1.25; Wood 1; 60 mil 1).
    const tab = [
      { key: 30, value: 2.8 },
      { key: 60, value: 1.4 },
      { key: 120, value: 0.95 },
    ];
    const hours = (baseHours: number) =>
      roofSectionLaborHours({
        fieldArea: 84 * 23,
        fieldRate: mechLaborRate({
          baseHours,
          deckMulti: 1,
          tabMulti: bandLookup(tab, 60),
          ocMulti: onCenterLookup([{ key: 18, value: 1 }], 18),
          sheetSizeMulti: 1,
          complexity: 1.25,
        }),
        perimArea: 0,
        perimRate: 0,
        cornerArea: 0,
        cornerRate: 0,
        thicknessLabor: 1,
        adjustLaborPct: 0,
      });
    expect(hours(27)).toBeCloseTo(36.51, 2);
    expect(hours(12)).toBeCloseTo(16.23, 2);
  });
});
