import { describe, it, expect } from "vitest";

import { compareVersions, versionAtLeast, versionAtMost, V } from "./version";

describe("compareVersions (engine-truth §1)", () => {
  it("reproduces the observed ordering 4.0.222 < 4.0.223 < 4.0.229 < 4.0.230 < 4.0.237", () => {
    const order = [V.V4_0_222, V.V4_0_223, V.V4_0_229, V.V4_0_230, V.V4_0_237];
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareVersions(order[i]!, order[i + 1]!)).toBe(-1);
      expect(compareVersions(order[i + 1]!, order[i]!)).toBe(1);
    }
  });

  it("treats equal versions as 0 and missing components as 0", () => {
    expect(compareVersions("4.0.230", "4.0.230")).toBe(0);
    expect(compareVersions("4.0", "4.0.0")).toBe(0);
    expect(compareVersions("4.0.1", "4.0")).toBe(1);
  });

  it("versionAtLeast / versionAtMost gate the right branches", () => {
    // Edge-overlap: ≥4.0.223 uses +1 ft, ≤4.0.222 uses +0.5 ft.
    expect(versionAtLeast("4.0.230", V.V4_0_223)).toBe(true);
    expect(versionAtLeast("4.0.222", V.V4_0_223)).toBe(false);
    expect(versionAtMost("4.0.222", V.V4_0_222)).toBe(true);
    // DuroBond _237 mech-sheet multiplier only at ≥4.0.237.
    expect(versionAtLeast("4.0.237", V.V4_0_237)).toBe(true);
    expect(versionAtLeast("4.0.230", V.V4_0_237)).toBe(false);
  });
});
