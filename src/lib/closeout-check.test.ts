/**
 * Complete lists what the close-out is missing (service study M2, owner Oct 5): a warning with
 * "Go back" / "Complete anyway", never a wall.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { missingForComplete, type CloseoutCheckInput } from "@/lib/closeout-check";

const full: CloseoutCheckInput = {
  service_type: "leak",
  repairs: [{ id: "r1", name: "Membrane – Holes" }],
  photos: [
    { repair_id: "r1", role: "before" },
    { repair_id: "r1", role: "after" },
  ],
  signature_path: "job/signature.png",
  closing_notes: "Patched two holes over the gym.",
};

describe("missingForComplete", () => {
  it("nothing when everything is there", () => {
    expect(missingForComplete(full)).toEqual([]);
  });
  it("a repair without its After photo, by name", () => {
    expect(missingForComplete({ ...full, photos: [full.photos[0]!] })).toEqual([
      "Membrane – Holes has no After photo",
    ]);
  });
  it("a repair without its Before photo; another repair's photos do not count", () => {
    expect(
      missingForComplete({
        ...full,
        repairs: [...full.repairs, { id: "r2", name: "Drain flashing" }],
        photos: [...full.photos, { repair_id: null, role: "before" }],
      }),
    ).toEqual(["Drain flashing has no Before photo", "Drain flashing has no After photo"]);
  });
  it("no closing notes (blank counts), no signature", () => {
    expect(missingForComplete({ ...full, closing_notes: "  ", signature_path: null })).toEqual([
      "No closing notes",
      "No customer signature",
    ]);
  });
  it("no repairs on a repair ticket; an inspection does not need one", () => {
    expect(missingForComplete({ ...full, repairs: [], photos: [] })).toEqual([
      "No repairs recorded",
    ]);
    expect(
      missingForComplete({ ...full, service_type: "inspection", repairs: [], photos: [] }),
    ).toEqual([]);
  });
});

describe("the close-out screen", () => {
  const src = readFileSync("src/components/service/closeout.tsx", "utf8");
  it("Complete checks first; Finish (already done) does not", () => {
    expect(src).toContain("onClick={pressComplete}");
    expect(src).not.toContain("onClick={() => complete.mutate()}");
    expect(src).toContain("finished || !repairsQ.data || !photosQ.data");
  });
  it("lists what is missing with Go back and Complete anyway", () => {
    expect(src).toContain("<AlertDialogTitle>Before you finish</AlertDialogTitle>");
    expect(src).toContain("Go back</AlertDialogCancel>");
    expect(src).toContain("Complete anyway");
    expect(src).toContain("closing_notes: latest.current.closing_notes");
  });
});
