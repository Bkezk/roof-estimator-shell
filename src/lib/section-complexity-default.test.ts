/**
 * Owner, Oct 8: "have the complexity ladders match and can we have the complexity default to
 * moderate instead of medium for all types". A new section starts at "Moderate" (index 2, as
 * legacy did; the Sep 22 "Medium" departure of docs §22.38 is reversed), and the three web-only
 * membranes carry the legacy ladder (×1 at Moderate) instead of the guide's (×1.25 at Moderate).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPLEXITY_LABELS, sectionComplexityFactor } from "@/lib/engine/bid-builder";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const LEGACY_LADDER = [0.9, 0.98, 1, 1.2, 2.4, 4];

describe("a new section starts at Moderate", () => {
  it("newSection seeds complexity 2, which the pick shows as Moderate", () => {
    const src = read("src/routes/estimate.tsx");
    expect(src).toMatch(/isQuickBid: true,\s*complexity: 2,\s*\.\.\.defaults,/);
    expect(src).not.toMatch(/isQuickBid: true,\s*complexity: 3,/);
    expect(COMPLEXITY_LABELS[2]).toBe("Moderate");
    expect(COMPLEXITY_LABELS[3]).toBe("Medium");
  });
});

describe("the web-only membranes' complexity ladder matches legacy", () => {
  it("the migration sets the legacy ladder on Duro-Tech TPO, Non-DL TPO and EPDM Rubber only", () => {
    const sql = flat(
      read("supabase/migrations/20261008140000_web_membranes_complexity_ladder.sql"),
    );
    expect(sql).toContain("update public.rdl_combos");
    expect(sql).toContain("'{complexity_factors}'");
    expect(sql).toContain(
      '[{"label": "Open", "value": 0.9}, {"label": "Minor", "value": 0.98}, {"label": "Moderate", "value": 1}, {"label": "Medium", "value": 1.2}, {"label": "Heavy", "value": 2.4}, {"label": "Extreme", "value": 4}]',
    );
    expect(sql).toContain("where roof_system in ('Duro-Tech TPO', 'Non-DL TPO', 'EPDM Rubber')");
    expect(sql).not.toMatch(/Duro-Last|Duro-Roof|Duro-Tuff|Duro-Bond|Duro-Fleece/);
    // Both attachments: no attachment filter.
    expect(sql).not.toContain("attachment");
  });
  it("with that ladder a Moderate section bills ×1 on every system, like Duro-Last", () => {
    for (const rsId of [6, 7, 8])
      expect(sectionComplexityFactor(rsId, 2, 1, LEGACY_LADDER)).toBe(1);
    expect(sectionComplexityFactor(1, 2, 1, undefined)).toBe(1); // Duro-Last: no ladder
    expect(sectionComplexityFactor(3, 2, 1, undefined)).toBe(1); // Duro-Tuff: legacy table
    // The seeded guide ladder was the mismatch: ×1.25 at Moderate.
    expect(sectionComplexityFactor(6, 2, 1, [1, 1.1, 1.25, 1.4, 1.6, 2])).toBe(1.25);
    // The other picks follow legacy too.
    expect(sectionComplexityFactor(6, 3, 1, LEGACY_LADDER)).toBe(1.2);
    expect(sectionComplexityFactor(6, 0, 1, LEGACY_LADDER)).toBe(0.9);
  });
});
