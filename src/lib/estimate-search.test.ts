import { describe, expect, it } from "vitest";

import { parseEstimateSearch } from "./estimate-search";

const ACCOUNT = "7c3f8a4e-1b2d-4c5e-8f9a-0b1c2d3e4f5a";
const SITE = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";

describe("/estimate search params", () => {
  it("reads a saved bid, a combine list and the takeoff / PlanSwift seeds as before", () => {
    expect(parseEstimateSearch({ bid: "b1" })).toEqual({ bid: "b1" });
    expect(parseEstimateSearch({ combine: "a,b", takeoff: "t", planswift: "p" })).toEqual({
      combine: "a,b",
      takeoff: "t",
      planswift: "p",
    });
    expect(parseEstimateSearch({ combine: "" })).toEqual({});
  });
  it("reads the generic prefill as before (numbers only when positive)", () => {
    expect(
      parseEstimateSearch({
        building: "x",
        pfName: "Job",
        pfOwner: "Owner",
        pfAddr: "1 Main",
        pfAddr2: "",
        pfCity: "Murray",
        pfState: "KY",
        pfZip: "42071",
        pfW: "100",
        pfL: -3,
      }),
    ).toEqual({
      building: "x",
      pfName: "Job",
      pfOwner: "Owner",
      pfAddr: "1 Main",
      pfCity: "Murray",
      pfState: "KY",
      pfZip: "42071",
      pfW: 100,
    });
  });
  it("carries the customer profile, site and notes to link a new bid to", () => {
    expect(
      parseEstimateSearch({ pfAccount: ACCOUNT, pfSite: SITE, pfNotes: "Seams open" }),
    ).toEqual({
      pfAccount: ACCOUNT,
      pfSite: SITE,
      pfNotes: "Seams open",
    });
  });
  it("drops an id that is not one, and a site without its customer", () => {
    expect(parseEstimateSearch({ pfAccount: "nope", pfSite: SITE })).toEqual({});
    expect(parseEstimateSearch({ pfSite: SITE })).toEqual({});
    expect(parseEstimateSearch({ pfAccount: ACCOUNT, pfSite: "x" })).toEqual({
      pfAccount: ACCOUNT,
    });
  });
});
