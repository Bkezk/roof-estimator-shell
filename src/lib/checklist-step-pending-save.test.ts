/**
 * Owner, Oct 28: "when i click recommend repairs on the additional findings step it jumped the
 * screen around and when i deselected it, it locked the additional findings step and took me back
 * to the checklist and wont let me click next step even though there are issues documented."
 *
 * Recommend repairs lives in the inspection JSON with the checklist (inspection-draft.ts), so a
 * press on it made the draft differ from the server's copy — `insp.saved` false — and the
 * Checklist step's rule (`checklistSaved !== false`) read "not saved": the step reopened, the
 * Additional findings step locked, and until the save landed (or if it stalled or failed) Next
 * stayed disabled over "Save the checklist". The step's rule now takes "the server holds a
 * record and the last save did not fail": a save on its way never locks the later steps.
 * Complete still flushes the draft first (insp.saveNow).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstOpenStep, stepDone, stepMissing, type StepState } from "@/lib/closeout-steps";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const form = read("src/components/service/closeout.tsx");

const base: StepState = {
  finished: false,
  crewAnswered: false,
  serviceType: "inspection",
  repairs: [],
  photos: [],
  materialsTouched: false,
  timeHours: 0,
  onSiteAt: null,
  closingNotes: "",
  notesSkipped: false,
  signaturePath: null,
  crewOthers: 0,
  materialItems: 0,
  signedBy: "",
  checklist: [{ status: "issue" }, { status: null }],
  checklistSaved: true,
  recommendRepairs: false,
  recommendNewRoof: false,
};

describe("the Checklist step's rule reads the record, not a pending change", () => {
  it("closeout.tsx: checklistSaved is 'a record on the server and the last save did not fail'", () => {
    expect(form).toContain('checklistSaved: insp.hasRecord && insp.state !== "error",');
    expect(form).not.toContain("checklistSaved: insp.saved,");
    // The gap dialog at Complete still judges the true saved state (Complete flushes first).
    expect(form).toContain("checklist_saved: insp.saved,");
    expect(form).toMatch(/if \(inspection\) await insp\.saveNow\(\);/);
  });
  it("the hook exposes both: hasRecord (a save landed, now or before) and the autosave state", () => {
    const hook = read("src/components/service/inspection-draft.ts");
    expect(hook).toContain("hasRecord: boolean;");
    expect(hook).toContain("const landed = (ins: Inspection) => {\n    setHasRecord(true);");
    expect(hook).toContain("setHasRecord(q.data.inspection !== null);");
    expect(hook).toContain("state: autosave.state,");
  });
  it("with a record held, the checklist is done and the findings step stays open whatever is being saved", () => {
    expect(stepDone("checklist", base)).toBe(true);
    expect(firstOpenStep(base)).toBe("findings");
    // Recommend repairs pressed on the findings step: the record exists, nothing moves back.
    expect(firstOpenStep({ ...base, recommendRepairs: true })).toBe("time");
    expect(firstOpenStep({ ...base, recommendRepairs: false })).toBe("findings");
  });
  it("no record yet, or a failed save: the checklist is the open step and Next says to save it", () => {
    const unsaved = { ...base, checklistSaved: false };
    expect(stepDone("checklist", unsaved)).toBe(false);
    expect(firstOpenStep(unsaved)).toBe("checklist");
    expect(stepMissing("checklist", unsaved)).toBe(
      "Save the checklist (flag only what has a problem)",
    );
  });
});
