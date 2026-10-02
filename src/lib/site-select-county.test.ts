/**
 * Audit, Oct 2, item 10: the site picker showed "County code 0108" — and 0108 is both Kenton, KY
 * and Putman, TN. It now shows "0108 Kenton, KY".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as codes from "@/lib/county-codes";

const kenton = { id: "k", code: "0108", county: "Kenton", state: "KY" };
const putman = { id: "p", code: "0108", county: "Putman", state: "TN" };

describe("the site picker's county code", () => {
  it("countyCodeShort: code, county, state", () => {
    expect(codes.countyCodeShort(kenton)).toBe("0108 Kenton, KY");
    expect(codes.countyCodeShort(putman)).toBe("0108 Putman, TN");
  });
  it("siteOptionLabel: name — address · 0108 Kenton, KY (parts only when there are)", () => {
    expect(codes.siteOptionLabel("Main St", "1 Main St, Covington, KY 41011", kenton)).toBe(
      "Main St — 1 Main St, Covington, KY 41011 · 0108 Kenton, KY",
    );
    expect(codes.siteOptionLabel("Annex", "", putman)).toBe("Annex · 0108 Putman, TN");
    expect(codes.siteOptionLabel("Shed", "9 Elm", undefined)).toBe("Shed — 9 Elm");
  });
  it("site-select.tsx uses it with the whole code row (never the bare code)", () => {
    const src = readFileSync("src/components/crm/site-select.tsx", "utf8");
    expect(src).toContain(
      "{siteOptionLabel(s.name, siteAddressLine(s), codeOf(s.county_code_id))}",
    );
    expect(src).toContain("codes?.find((c) => c.id === id) : undefined");
    expect(src).not.toContain("County code ${code}");
    expect(src).not.toMatch(/\)\?\.code : undefined/);
  });
});
