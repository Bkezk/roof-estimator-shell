import { describe, expect, it } from "vitest";

import type { CountAttrs } from "@/lib/takeoff/model";

import {
  addPhotos,
  imageFilesOf,
  photoKindOf,
  removePhoto,
  takePickedFiles,
  withNote,
  withPhotos,
} from "./deficiency-photos";

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

describe("the file input's picked files (owner, Oct 27: a picked PNG was refused)", () => {
  /** A browser file input: its FileList is live — clearing `value` empties it. */
  function liveInput(names: string[]) {
    const picked = names.map((n) => new File(["x"], n, { type: "image/png" }));
    const input = {
      value: "C:\\fakepath\\" + names[0],
      get files(): File[] {
        return this.value === "" ? [] : picked;
      },
    };
    return input;
  }

  it("copies the files out before the input is cleared, so the pick is kept", () => {
    const input = liveInput(["roof.png", "drain.png"]);
    const files = takePickedFiles(input);
    expect(files.map((f) => f.name)).toEqual(["roof.png", "drain.png"]);
    expect(input.value).toBe("");
    expect(imageFilesOf(files).length).toBe(2);
  });

  it("the old order (clear, then read) would have seen nothing — pinned as the bug", () => {
    const input = liveInput(["roof.png"]);
    input.value = "";
    expect(Array.from(input.files)).toEqual([]);
  });

  it("no files picked → an empty list, and the input is still cleared", () => {
    const input = { files: null, value: "" };
    expect(takePickedFiles(input)).toEqual([]);
  });
});
