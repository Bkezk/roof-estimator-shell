/**
 * Owner, Oct 9: "on the materials search list, we need to have fairly loose parameters, like
 * durolast, dl, and duro last should all pull up durolast products, screws should pull up
 * fasteners etc." material-aliases.ts normalises both sides and matches a word through its
 * alias group; matchesSearch (materials-utils.ts) — the Find any material box, the truck fold,
 * the browse panel and searchMaterials — runs on it. Each case fails on the old substring match.
 */
import { describe, expect, it } from "vitest";

import {
  MATERIAL_ALIASES,
  looseMatch,
  normalizeSearchText,
  searchHaystack,
  searchTerms,
  wordMatches,
} from "@/lib/material-aliases";
import { matchesSearch } from "@/components/service/materials-utils";
import { searchMaterials, type SearchCatalog } from "@/lib/material-search";

const durolast = {
  label: "Duro-Last 60 mil White",
  row_label: "60 mil Membrane",
  category: "Membrane",
  price_col: "White",
  item_no: "DL60W",
};
const screws = {
  label: null,
  row_label: '1 1/2" [Collated Screws]',
  category: "Fasteners & Bits",
  price_col: "price",
  item_no: "CS150",
};
const head = {
  label: "P-3 Head",
  row_label: "P-3 Head",
  category: "Fasteners & Bits",
  price_col: "price",
  item_no: "P3",
};
const caulk = {
  label: "Duro-Caulk Plus",
  row_label: "Duro-Caulk Plus",
  category: "Sealants",
  price_col: "price",
  item_no: "1107",
};

describe("normalizeSearchText", () => {
  it("lower-cases and strips hyphens, spaces, slashes, dots and quotes", () => {
    expect(normalizeSearchText("Duro-Last")).toBe("durolast");
    expect(normalizeSearchText("duro last")).toBe("durolast");
    expect(normalizeSearchText('1 1/2" [Collated Screws]')).toBe("112[collatedscrews]");
    expect(normalizeSearchText("P-3 Head")).toBe("p3head");
    expect(normalizeSearchText("Seam Tape 6.0 ‘wide’")).toBe("seamtape60wide");
    expect(normalizeSearchText("  ")).toBe("");
  });
});

describe("MATERIAL_ALIASES — the owner's groups, easy to extend", () => {
  it("holds the groups asked for, every entry reachable after normalising", () => {
    const groups = MATERIAL_ALIASES.map((g) => g.map(normalizeSearchText));
    expect(groups).toContainEqual(["durolast", "durolast", "dl", "duro"]);
    expect(groups).toContainEqual(["fastener", "fasteners", "screw", "screws", "nail", "nails"]);
    expect(groups).toContainEqual(["sealant", "caulk", "caulking", "tube", "tubes"]);
    expect(groups).toContainEqual(["adhesive", "glue"]);
    expect(groups).toContainEqual(["membrane", "roofing", "roof"]);
    expect(groups).toContainEqual(["primer"]);
    expect(groups).toContainEqual(["cleaner", "acetone", "solvent"]);
    expect(groups).toContainEqual(["iso", "insulation", "board", "boards"]);
    expect(groups).toContainEqual(["flashing", "boot", "boots", "stack", "pipe"]);
    expect(groups).toContainEqual(["drain", "scupper"]);
    expect(groups).toContainEqual(["tape", "seamtape"]);
    expect(groups).toContainEqual(["plate", "plates", "washer", "washers"]);
    expect(groups).toContainEqual(["termination", "termbar", "bar"]);
    expect(groups).toContainEqual(["walkpad", "walkpad", "pad"]);
    for (const g of MATERIAL_ALIASES) {
      expect(g.length).toBeGreaterThan(0);
      for (const w of g) expect(normalizeSearchText(w).length).toBeGreaterThan(0);
    }
  });
  it("searchTerms: the word, its singular, and its whole group", () => {
    expect(searchTerms("Screws")).toEqual(
      expect.arrayContaining(["screws", "screw", "fastener", "fasteners", "nail", "nails"]),
    );
    expect(searchTerms("dl")).toEqual(expect.arrayContaining(["dl", "durolast", "duro"]));
    expect(searchTerms("boxes")).toEqual(expect.arrayContaining(["boxes", "boxe", "box"]));
    expect(searchTerms("Seam tape")).toEqual(expect.arrayContaining(["seamtape", "tape"]));
    // No group: the word alone (and its singular). Blank: nothing.
    expect(searchTerms("gypsum")).toEqual(["gypsum"]);
    expect(searchTerms("   ")).toEqual([]);
  });
  it("wordMatches and the haystack: fields never bridge (no word spans two fields)", () => {
    const hay = searchHaystack(["Duro-Caulk", "Sealants", "White", "1106"]);
    expect(wordMatches(hay, "caulk")).toBe(true);
    expect(wordMatches(hay, "tube")).toBe(true); // through the sealant group
    expect(wordMatches(hay, "kse")).toBe(false); // "Duro-Caulk" + "Sealants" do not join
    expect(looseMatch(["Duro-Caulk"], "")).toBe(true);
  });
});

describe("matchesSearch is loose", () => {
  it('"durolast", "dl", "duro last" and "Duro-Last" all find "Duro-Last 60 mil White"', () => {
    for (const q of ["durolast", "dl", "duro last", "Duro-Last", "DL", "duro"])
      expect(matchesSearch(durolast, q), q).toBe(true);
    // And through the membrane group.
    expect(matchesSearch(durolast, "roof")).toBe(true);
    expect(matchesSearch(durolast, "roofing membrane")).toBe(true);
  });
  it('"screws" finds the collated screws and a "P-3 Head" whose only hint is the category', () => {
    for (const q of ["screws", "screw", "Screws", "fastener", "fasteners", "nails"]) {
      expect(matchesSearch(screws, q), q).toBe(true);
      expect(matchesSearch(head, q), q).toBe(true);
    }
    expect(matchesSearch(head, "p-3")).toBe(true);
    expect(matchesSearch(head, "p3")).toBe(true);
    expect(matchesSearch(screws, "1 1/2")).toBe(true);
    expect(matchesSearch(screws, 'collated 1/2"')).toBe(true);
  });
  it('"caulk" finds Duro-Caulk Plus (and so do sealant, caulking); item numbers still match', () => {
    for (const q of ["caulk", "Caulk", "sealant", "caulking", "duro caulk", "1107"])
      expect(matchesSearch(caulk, q), q).toBe(true);
    expect(matchesSearch(screws, "CS150")).toBe(true);
    expect(matchesSearch(screws, "cs-150")).toBe(true);
    expect(matchesSearch(durolast, "dl60w")).toBe(true);
  });
  it("two words must both match; what is not there is not found; blank matches all", () => {
    expect(matchesSearch(caulk, "duro screws")).toBe(false);
    expect(matchesSearch(durolast, "duro caulk")).toBe(false);
    expect(matchesSearch(screws, "duro screws")).toBe(false);
    expect(matchesSearch(caulk, "tan")).toBe(false);
    expect(matchesSearch(screws, "primer")).toBe(false);
    expect(matchesSearch(caulk, "   ")).toBe(true);
    // The earlier pin, still true.
    expect(
      matchesSearch(
        { row_label: "Duro-Caulk", category: "Sealants", price_col: "White", item_no: "1106" },
        "caulk white",
      ),
    ).toBe(true);
  });
  it("searchMaterials (Find any material) goes through it: dl finds the Duro-Last membrane", () => {
    const catalog: SearchCatalog[] = [
      {
        screen_id: "duro_last:membrane",
        row_label: "60 mil Membrane",
        price_col: "White",
        label: "Duro-Last 60 mil White",
        category: "Membrane",
        unit: "roll",
        piece: null,
        item_no: "DL60W",
      },
      {
        screen_id: "service",
        row_label: "Acetone",
        price_col: "price",
        label: "Acetone",
        category: "Cleaning Supplies",
        unit: "gal",
        piece: null,
        item_no: null,
      },
    ];
    const labels = (q: string) => searchMaterials(q, null, catalog, [], null).map((r) => r.label);
    expect(labels("dl")).toEqual(["Duro-Last 60 mil White"]);
    expect(labels("duro last")).toEqual(["Duro-Last 60 mil White"]);
    expect(labels("solvent")).toEqual(["Acetone"]);
    expect(labels("cleaner")).toEqual(["Acetone"]);
    expect(labels("screws")).toEqual([]);
  });
});
