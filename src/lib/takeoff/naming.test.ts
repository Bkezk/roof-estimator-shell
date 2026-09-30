import { describe, expect, it } from "vitest";

import { suggestTakeoffName } from "./naming";

const day = new Date(2026, 8, 30, 12); // Sep 30, 2026, local time

describe("suggestTakeoffName", () => {
  it("is the customer (and site) plus the date", () => {
    expect(suggestTakeoffName("Acme Foods — Plant 2", [], day)).toBe(
      "Acme Foods — Plant 2 · Sep 30, 2026",
    );
    expect(suggestTakeoffName("Acme Foods", [], day)).toBe("Acme Foods · Sep 30, 2026");
  });

  it("numbers a second (and third) takeoff for the same customer on the same day", () => {
    const existing = ["Acme Foods · Sep 30, 2026"];
    expect(suggestTakeoffName("Acme Foods", existing, day)).toBe("Acme Foods · Sep 30, 2026 (2)");
    expect(
      suggestTakeoffName("Acme Foods", [...existing, "acme foods · sep 30, 2026 (2)"], day),
    ).toBe("Acme Foods · Sep 30, 2026 (3)");
  });

  it("gives nothing for no customer", () => {
    expect(suggestTakeoffName("  ", ["x"], day)).toBe("");
  });
});
