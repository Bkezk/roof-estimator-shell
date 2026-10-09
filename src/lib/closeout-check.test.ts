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
  it("no signature; the closing notes are never a gap (owner, Oct 9: step 6 is skippable)", () => {
    expect(missingForComplete({ ...full, signature_path: null })).toEqual([
      "No customer signature",
    ]);
    expect("closing_notes" in full).toBe(false);
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
    // Owner, Oct 9 (steps): from step 7 the bar runs pressComplete; before that a tap scrolls
    // to the step still open (closeout-steps.ts) — never straight to complete.mutate().
    expect(src).toContain("onClick={stepToFinish ? () => goTo(stepToFinish) : pressComplete}");
    expect(src).not.toContain("onClick={() => complete.mutate()}");
    // Owner, Oct 9: a read with no rows is a line, not a pass (completeGaps, closeout-check.ts);
    // Finish is the `finished` flag the helper short-circuits on.
    expect(src).not.toContain("finished || !repairsQ.data || !photosQ.data");
    expect(src).toMatch(/completeGaps\(\{\s*finished,/);
  });
  it("lists what is missing with Go back and Complete anyway", () => {
    expect(src).toContain("<AlertDialogTitle>Before you finish</AlertDialogTitle>");
    expect(src).toContain("Go back</AlertDialogCancel>");
    expect(src).toContain("Complete anyway");
    // Owner, Oct 9: the notes are not judged (completeGaps has no closing_notes input).
    expect(src).not.toContain("closing_notes: latest.current.closing_notes");
  });
});
