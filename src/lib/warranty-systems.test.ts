/**
 * Warranties per roof system (owner, Oct 22: "epdm also should have 25, and 30 yr warranties.
 * ensure those things are wired correctly"). warranties.systems (text[]; null = every system)
 * says which roof systems a warranty is offered on; the estimator lists only the warranties the
 * bid's system may carry; two EPDM warranties (25 Yr EPDM, 30 Yr EPDM) are seeded for EPDM
 * Rubber only. And the Warranties tab's save no longer wipes the legacy flags: it sends every
 * column it shows (term, required mil, high wind, systems), where before it sent only the name
 * and the two prices and the delete-and-insert reset req_thickness / is_high_wind / term_years
 * to their defaults on every save.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { warrantiesForSystem } from "@/lib/warranty-systems";

const read = (p: string) => readFileSync(p, "utf8");
const w = (name: string, systems: string[] | null) => ({ name, systems });

describe("warrantiesForSystem", () => {
  const list = [
    w("15 Yr NDL", null),
    w("20 Yr NDL", null),
    w("25 Yr EPDM", ["EPDM Rubber"]),
    w("30 Yr EPDM", ["EPDM Rubber"]),
  ];
  it("EPDM Rubber: the all-systems ones and its own", () => {
    expect(warrantiesForSystem(list, "EPDM Rubber").map((x) => x.name)).toEqual([
      "15 Yr NDL",
      "20 Yr NDL",
      "25 Yr EPDM",
      "30 Yr EPDM",
    ]);
  });
  it("Duro-Last: never the EPDM ones", () => {
    expect(warrantiesForSystem(list, "Duro-Last").map((x) => x.name)).toEqual([
      "15 Yr NDL",
      "20 Yr NDL",
    ]);
  });
  it("older snapshots without the field: every warranty (nothing hidden)", () => {
    expect(warrantiesForSystem([{ name: "A" }, { name: "B" }], "Duro-Last").length).toBe(2);
  });
});

describe("wiring", () => {
  it("the column, the two EPDM rows and the read", () => {
    const mig = read("supabase/migrations/20261022090000_warranty_systems.sql");
    expect(mig).toContain("add column if not exists systems text[]");
    expect(mig).toContain("'25 Yr EPDM'");
    expect(mig).toContain("'30 Yr EPDM'");
    expect(read("src/integrations/supabase/types.ts")).toContain("systems: string[] | null;");
    expect(read("src/lib/bids.functions.ts")).toContain("systems: w.systems ?? null,");
  });
  it("the estimator lists the bid system's warranties", () => {
    expect(read("src/routes/estimate.tsx")).toContain(
      "warrantiesForSystem(warrantyData?.warranties ?? [], roofSystem)",
    );
  });
  it("the Warranties tab shows and saves the term, required mil, high wind and systems, so a save keeps them", () => {
    const tab = read("src/routes/admin.settings.tsx");
    expect(tab).toContain("term_years: w.term_years,");
    expect(tab).toContain("req_thickness: w.req_thickness,");
    expect(tab).toContain("is_high_wind: w.is_high_wind,");
    expect(tab).toContain("systems: w.systems,");
    const fn = read("src/lib/admin-settings.functions.ts");
    expect(fn).toContain("term_years: z.number().int()");
    expect(fn).toContain("systems: z.array(z.string()).nullable()");
  });
});
