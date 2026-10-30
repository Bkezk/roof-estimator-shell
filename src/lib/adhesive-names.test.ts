/**
 * One name per adhesive (owner, Oct 30: "TECH-Bond TPO Bonding Solvent Adhesive has a price and
 * coverage amount but it's not showing up on the cost of the Somerset Career Center"). The bid
 * estimator joins an adhesive's price and the Adhesives grid's coverage to a bid by EXACT name
 * (engine/adapters.ts buildAdhesivePrices / applyAdhesivesScreenCoverage); its own names come from
 * legacy_adhesive. The Oct 27 price sheets loaded three of those products under the sheet's
 * wording, so the priced name was never the picked one and the bid billed $0. Renamed to the
 * estimator's names (20261030120000_adhesive_names_match_estimator.sql), and this test keeps a
 * second spelling of an estimator adhesive out of the seed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADHESIVE_PRODUCTS } from "@/lib/pricing-seed/accessory-families";
import { assembleEngineAdminData } from "@/lib/engine/adapters";

/** The estimator's adhesives (live legacy_adhesive.long_name, read Oct 30). */
const ESTIMATOR_ADHESIVES = [
  "Water Based Adhesive",
  "Solvent Based Adhesive",
  "Duro-Fleece Adhesive(2-boxes)",
  "Duro-Fleece Adhesive(cartridge)",
  "Duro-Grip Adhesive(CR-20)",
  "OlyBond500 Bag-in-Box",
  "OlyBond500 SpotShot",
  "Millenium One Step",
  "Millenium PG1 Boxes",
  "Millenium PG1 Drums",
  "TECH-Bond TPO Bonding Adhesive",
  "TECH-Bond TPO LVOC Bonding Adhesive",
  "TECH-Bond TPO Spray Adhesive",
  "Non-DL TPO Bonding Adhesive",
  "Non-DL TPO Spray Adhesive",
  "EPDM Bonding Adhesive",
  "EPDM Spray Adhesive",
];

/** A name with the sheet's extra words taken out: "solvent", a parenthetical, case and spacing. */
const loose = (n: string) =>
  n
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bsolvent\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the price list names each estimator adhesive exactly as the estimator does", () => {
  it("the three products the Oct 27 sheets named differently carry the estimator's names", () => {
    const byPart = (part: string) => ADHESIVE_PRODUCTS.find((p) => p.part_no === part)?.name;
    expect(byPart("1112T")).toBe("TECH-Bond TPO Bonding Adhesive");
    expect(byPart("1112-010T")).toBe("TECH-Bond TPO LVOC Bonding Adhesive");
    expect(byPart("W563587052")).toBe("EPDM Bonding Adhesive");
  });
  it("no seeded product is a second spelling of an estimator adhesive", () => {
    for (const p of ADHESIVE_PRODUCTS) {
      const twin = ESTIMATOR_ADHESIVES.find((e) => e !== p.name && loose(e) === loose(p.name));
      expect(twin, `${p.name} is another spelling of ${twin}`).toBeUndefined();
    }
  });
  it("the migration renames the three in place, links their item numbers, and never makes two of one name", () => {
    const sql = readFileSync(
      "supabase/migrations/20261030120000_adhesive_names_match_estimator.sql",
      "utf8",
    );
    for (const [from, to] of [
      ["TECH-Bond TPO Bonding Solvent Adhesive", "TECH-Bond TPO Bonding Adhesive"],
      ["TECH-Bond TPO LVOC Solvent Bonding Adhesive", "TECH-Bond TPO LVOC Bonding Adhesive"],
      ["EPDM Bonding Adhesive (BA-2004 T)", "EPDM Bonding Adhesive"],
    ]) {
      expect(sql).toContain(
        `when '${from}'\n          then jsonb_set(e, '{name}', to_jsonb('${to}'::text))`,
      );
      expect(sql).toContain(`when '${from}' then '${to}'`);
    }
    expect(sql).toContain("update public.catalog_item_numbers");
    expect(sql).toMatch(
      /and not exists \(\s*select 1 from jsonb_array_elements\(c\.data->'products'\) e/,
    );
  });
});

describe("the estimator finds the price and the coverage under one name", () => {
  it("an adhesive priced and covered on the grid under the estimator's name prices on the bid", () => {
    const tb = ADHESIVE_PRODUCTS.find((p) => p.part_no === "1112T")!;
    const admin = assembleEngineAdminData({
      membraneScreen: null,
      combos: [],
      settings: null,
      adhesivesScreen: {
        products: [
          {
            name: tb.name,
            price: tb.price,
            unit_type: "5 gal",
            part_no: tb.part_no,
            field_spacing: "",
            perim_spacing: "",
            coverage: [{ group: "Duro-Tech TPO", substrate: "Wood", field_coverage: 270 }],
          },
        ],
      },
      legacyAdhesiveRows: [
        {
          adhesive_id: 11,
          short_name: "techbondtpo",
          long_name: "TECH-Bond TPO Bonding Adhesive",
          part_number: null,
          price: 0,
          unit_type: "5-gal. Pail",
          field_spacing_in: -1,
          perim_spacing_in: -1,
          used_with_wall: 1,
        },
      ],
      adhesiveCoverageDeck: [
        {
          adhesive_id: 11,
          roof_system_id: 6,
          deck_type_id: 1,
          coverage_sqft: 300,
          custom_value: 0,
          default_value: 0,
        },
      ],
    } as never);
    expect(admin.adhesivePrices?.["TECH-Bond TPO Bonding Adhesive"]).toBe(140);
    const cov = admin.membraneAdhesives?.[6]?.["TECH-Bond TPO Bonding Adhesive"];
    expect(cov?.byDeckName["Wood"]).toBe(270);
    // One entry for the product — no second spelling beside it.
    expect(
      Object.keys(admin.membraneAdhesives?.[6] ?? {}).filter((n) => /TECH-Bond/.test(n)),
    ).toEqual(["TECH-Bond TPO Bonding Adhesive"]);
  });
});
