import { describe, expect, it } from "vitest";

import { isTakeoffPhotoPath, takeoffPhotoPath } from "./takeoff-photos.functions";

const T = "11111111-1111-4111-8111-111111111111";

describe("deficiency picture paths (the takeoffs bucket, <takeoffId>/photos/<uuid>.<ext>)", () => {
  it("builds the path under the takeoff's photos folder with the kind's extension", () => {
    expect(takeoffPhotoPath(T, "jpeg", "abc")).toBe(`${T}/photos/abc.jpg`);
    expect(takeoffPhotoPath(T, "png", "abc")).toBe(`${T}/photos/abc.png`);
    expect(isTakeoffPhotoPath(T, takeoffPhotoPath(T, "jpeg", "abc"))).toBe(true);
  });
  it("refuses paths outside the takeoff's photos folder (another takeoff, the plan file, ..)", () => {
    expect(isTakeoffPhotoPath(T, `${T}/plan.pdf`)).toBe(false);
    expect(isTakeoffPhotoPath(T, `other/photos/a.jpg`)).toBe(false);
    expect(isTakeoffPhotoPath(T, `${T}/photos/../plan.pdf`)).toBe(false);
    expect(isTakeoffPhotoPath(T, `${T}/photos/sub/a.jpg`)).toBe(false);
    expect(isTakeoffPhotoPath(T, `${T}/photos/`)).toBe(false);
  });
});
