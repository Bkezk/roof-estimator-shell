import { describe, expect, it } from "vitest";

import type { CountAttrs } from "@/lib/takeoff/model";

import { addPhotos, photoKindOf, removePhoto, withNote, withPhotos } from "./deficiency-photos";

const base: CountAttrs = { name: "Deficiency 1", role: "deficiency" };

describe("deficiency attrs (owner, Oct 27): note and pictures, never an undefined key", () => {
  it("photoKindOf: JPEG / PNG only (the bucket and pdf-lib take nothing else)", () => {
    expect(photoKindOf("image/jpeg")).toBe("jpeg");
    expect(photoKindOf("image/jpg; charset=binary")).toBe("jpeg");
    expect(photoKindOf("image/png")).toBe("png");
    expect(photoKindOf("image/heic")).toBeNull();
    expect(photoKindOf("image/webp")).toBeNull();
    expect(photoKindOf("")).toBeNull();
  });
  it("addPhotos appends (no duplicates); removePhoto drops; an empty list drops the key", () => {
    const one = addPhotos(base, [{ path: "t/photos/a.jpg", name: "a.jpg" }]);
    expect(one.photos).toEqual([{ path: "t/photos/a.jpg", name: "a.jpg" }]);
    const two = addPhotos(one, [{ path: "t/photos/a.jpg" }, { path: "t/photos/b.png" }]);
    expect(two.photos!.map((p) => p.path)).toEqual(["t/photos/a.jpg", "t/photos/b.png"]);
    const left = removePhoto(two, "t/photos/a.jpg");
    expect(left.photos).toEqual([{ path: "t/photos/b.png" }]);
    const none = removePhoto(left, "t/photos/b.png");
    expect("photos" in none).toBe(false);
    expect("photos" in withPhotos(base, [])).toBe(false);
  });
  it("withNote sets or drops the note; nothing is ever saved as undefined", () => {
    const noted = withNote(base, "Ponding at the drain");
    expect(noted.note).toBe("Ponding at the drain");
    const cleared = withNote(noted, "   ");
    expect("note" in cleared).toBe(false);
    const roundTrip = JSON.parse(
      JSON.stringify(addPhotos(withNote(base, "x"), [{ path: "t/photos/a.jpg" }])),
    ) as Record<string, unknown>;
    expect(Object.values(roundTrip).every((v) => v !== undefined)).toBe(true);
    expect(Object.keys(roundTrip).sort()).toEqual(["name", "note", "photos", "role"]);
  });
});
