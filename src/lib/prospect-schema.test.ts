import { describe, expect, it } from "vitest";

import { buildingSchema } from "@/lib/prospect.functions";

describe("a building's state as saved", () => {
  // Bug: "tn" was stored as typed and the list (TN = exactly 'TN') filed it under Kentucky.
  it("is the upper-case two-letter code", () => {
    const parse = (state: unknown) => buildingSchema.parse({ name: "x", state }).state;
    expect(parse("tn")).toBe("TN");
    expect(parse(" Tn ")).toBe("TN");
    expect(parse("Tennessee")).toBe("TN");
    expect(parse("ky")).toBe("KY");
    expect(parse("in")).toBe("IN");
    expect(parse(undefined)).toBe("KY");
    expect(parse("")).toBe("");
    expect(() => parse("Indiana")).toThrow();
  });
});
