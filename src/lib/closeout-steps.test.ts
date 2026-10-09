/**
 * The close-out's seven steps and the order they unlock in (closeout-steps.ts; owner, Oct 9:
 * "questions have to be answered to proceed … unlocking each step after the last is complete").
 * Each rule, the order, an inspection ticket, a legacy On site stamp, a finished ticket, and the
 * strip's lines. Pure, no screen.
 */
import { describe, expect, it } from "vitest";

import {
  CLOSEOUT_STEPS,
  STEP_COUNT,
  finishStepLabel,
  firstOpenStep,
  lockedLine,
  nothingUsedKey,
  stepDone,
  stepHeadline,
  stepIndex,
  stepOf,
  stepStatus,
  stepStatuses,
  unlockToast,
  type StepId,
  type StepState,
} from "@/lib/closeout-steps";
import { PHASE_PHOTO_ROLES, needsFor } from "@/lib/closeout-repairs";

/** A repair ticket with everything done. */
const full: StepState = {
  finished: false,
  crewAnswered: true,
  serviceType: "leak",
  repairs: [{ id: "r1", resolution_text: "Patched two holes." }],
  photos: [
    { repair_id: "r1", role: "before" },
    { repair_id: "r1", role: "after" },
  ],
  materialsTouched: true,
  timeHours: 1.5,
  onSiteAt: null,
  closingNotes: "Two holes over the gym, patched.",
  signaturePath: "job/signature.png",
  crewOthers: 0,
  materialItems: 1,
  signedBy: "",
};
const ids = CLOSEOUT_STEPS.map((s) => s.id);
const statusList = (s: StepState) => stepStatuses(s).map((x) => x.status);

describe("the seven steps, in the owner's order", () => {
  it("1 Who is here, 2 Before, 3 The work, 4 Materials, 5 Time, 6 Notes, 7 Signature", () => {
    expect(STEP_COUNT).toBe(7);
    expect(ids).toEqual(["crew", "before", "work", "materials", "time", "notes", "signature"]);
    expect(CLOSEOUT_STEPS.map((s) => s.title)).toEqual([
      "Who is here",
      "Before",
      "The work",
      "Materials",
      "Time",
      "Notes",
      "Signature",
    ]);
    expect(CLOSEOUT_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const s of CLOSEOUT_STEPS) expect(s.unlocks.length).toBeGreaterThan(0);
    expect(stepIndex("work")).toBe(2);
    expect(stepOf("time").n).toBe(5);
    expect(() => stepOf("nope" as StepId)).toThrow(/Unknown close-out step/);
  });
  it("everything done: every step done, nothing open, the headline says Complete", () => {
    expect(statusList(full)).toEqual(Array<string>(7).fill("done"));
    expect(firstOpenStep(full)).toBeNull();
    expect(stepHeadline(null)).toBe("All 7 steps done — press Complete");
  });
});

describe("each step's rule (the same things Complete's list checks)", () => {
  it("1 the crew question answered", () => {
    expect(stepDone("crew", { ...full, crewAnswered: false })).toBe(false);
    expect(stepDone("crew", full)).toBe(true);
  });
  it("2 at least one repair, each with a Before photo (another repair's photo does not count)", () => {
    expect(stepDone("before", { ...full, repairs: [], photos: [] })).toBe(false);
    expect(stepDone("before", { ...full, photos: [{ repair_id: "r1", role: "after" }] })).toBe(
      false,
    );
    expect(stepDone("before", { ...full, photos: [{ repair_id: null, role: "before" }] })).toBe(
      false,
    );
    expect(
      stepDone("before", {
        ...full,
        repairs: [...full.repairs, { id: "r2", resolution_text: null }],
      }),
    ).toBe(false);
    expect(stepDone("before", full)).toBe(true);
  });
  it("3 every repair has its What you did text (blank does not count) and an After photo", () => {
    expect(stepDone("work", { ...full, repairs: [{ id: "r1", resolution_text: "   " }] })).toBe(
      false,
    );
    expect(stepDone("work", { ...full, repairs: [{ id: "r1", resolution_text: null }] })).toBe(
      false,
    );
    expect(stepDone("work", { ...full, photos: [{ repair_id: "r1", role: "before" }] })).toBe(
      false,
    );
    // No repairs at all is not "the work is done" on a repair ticket.
    expect(stepDone("work", { ...full, repairs: [], photos: [] })).toBe(false);
    expect(stepDone("work", full)).toBe(true);
  });
  it("4 a material logged, or Nothing used pressed", () => {
    expect(stepDone("materials", { ...full, materialsTouched: false })).toBe(false);
    expect(stepDone("materials", full)).toBe(true);
  });
  it("5 time above zero, or an older ticket's On site stamp (Complete adds that labor itself)", () => {
    expect(stepDone("time", { ...full, timeHours: 0 })).toBe(false);
    expect(stepDone("time", { ...full, timeHours: Number.NaN })).toBe(false);
    expect(stepDone("time", { ...full, timeHours: 0.25 })).toBe(true);
    expect(stepDone("time", { ...full, timeHours: 0, onSiteAt: "2026-10-01T13:00:00Z" })).toBe(
      true,
    );
  });
  it("6 closing notes written (blank does not count)", () => {
    expect(stepDone("notes", { ...full, closingNotes: "  " })).toBe(false);
    expect(stepDone("notes", full)).toBe(true);
  });
  it("7 a signature saved", () => {
    expect(stepDone("signature", { ...full, signaturePath: null })).toBe(false);
    expect(stepDone("signature", full)).toBe(true);
  });
});

describe("the unlock order", () => {
  it("a fresh ticket: the crew question is current and everything after it is locked", () => {
    const fresh: StepState = {
      ...full,
      crewAnswered: false,
      repairs: [],
      photos: [],
      materialsTouched: false,
      timeHours: 0,
      closingNotes: "",
      signaturePath: null,
    };
    expect(firstOpenStep(fresh)).toBe("crew");
    expect(statusList(fresh)).toEqual([
      "current",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
  });
  it("a later step is locked while an earlier one is not done, step by step", () => {
    const stages: [StepId, Partial<StepState>][] = [
      ["crew", { crewAnswered: false }],
      ["before", { photos: [{ repair_id: "r1", role: "after" }] }],
      ["work", { repairs: [{ id: "r1", resolution_text: null }] }],
      ["materials", { materialsTouched: false }],
      ["time", { timeHours: 0 }],
      ["notes", { closingNotes: "" }],
      ["signature", { signaturePath: null }],
    ];
    for (const [id, patch] of stages) {
      const s = { ...full, ...patch };
      expect(firstOpenStep(s), id).toBe(id);
      expect(stepStatus(id, s), id).toBe("current");
      for (const later of ids.slice(stepIndex(id) + 1))
        if (!stepDone(later, s)) expect(stepStatus(later, s), `${id} → ${later}`).toBe("locked");
    }
  });
  it("two steps open: the first is current, the second locked, the rest done (and never locked)", () => {
    const s = { ...full, materialsTouched: false, closingNotes: "" };
    expect(statusList(s)).toEqual(["done", "done", "done", "current", "done", "locked", "done"]);
  });
  it("a done step stays done (editable) when an earlier one reopens — a Before photo deleted", () => {
    const s = { ...full, photos: [{ repair_id: "r1", role: "after" }] };
    expect(firstOpenStep(s)).toBe("before");
    // The work is still done (its After photo and text are there), so it stays on screen.
    expect(stepStatus("work", s)).toBe("done");
    expect(stepStatus("signature", s)).toBe("done");
  });
  it("a finished ticket (Done / Invoiced / Closed) has every step done, whatever is missing", () => {
    const s: StepState = {
      ...full,
      finished: true,
      repairs: [],
      photos: [],
      materialsTouched: false,
      timeHours: 0,
      closingNotes: "",
      signaturePath: null,
    };
    expect(statusList(s)).toEqual(Array<string>(7).fill("done"));
    expect(firstOpenStep(s)).toBeNull();
  });
});

describe("an inspection ticket", () => {
  const inspection: StepState = { ...full, serviceType: "inspection", repairs: [], photos: [] };
  it("needs no repair: Before and The work are done with none (missingForComplete's rule)", () => {
    expect(stepDone("before", inspection)).toBe(true);
    expect(stepDone("work", inspection)).toBe(true);
    expect(firstOpenStep(inspection)).toBeNull();
  });
  it("a repair it does record still needs its photos and text", () => {
    const withOne = { ...inspection, repairs: [{ id: "r1", resolution_text: null }] };
    expect(stepDone("before", withOne)).toBe(false);
    expect(stepDone("work", withOne)).toBe(false);
    expect(firstOpenStep(withOne)).toBe("before");
  });
});

describe("the strip's lines", () => {
  it("the headline and the locked placeholder name the open step", () => {
    expect(stepHeadline("work")).toBe("Step 3 of 7 · The work");
    expect(lockedLine("work")).toBe("Locked — finish step 3: The work first");
    expect(lockedLine(null)).toBe("Locked");
    expect(finishStepLabel("materials")).toBe("Finish step 4: Materials");
  });
  it("the unlock toast: forward only, naming the step done and the next; the last says Complete", () => {
    expect(unlockToast("crew", "before")).toBe("Step 1 done — next: Before");
    expect(unlockToast("before", "materials")).toBe("Step 2 done — next: Materials");
    expect(unlockToast("signature", null)).toBe("Step 7 done — Complete is ready");
    // The same step, a step reopened, or nothing open before: no toast.
    expect(unlockToast("work", "work")).toBeNull();
    expect(unlockToast("work", "before")).toBeNull();
    expect(unlockToast(null, "before")).toBeNull();
    expect(unlockToast(null, null)).toBeNull();
  });
  it("the Nothing used mark's key is per ticket", () => {
    expect(nothingUsedKey("abc")).toBe("bid-o-matic:closeout-nothing-used:abc");
    expect(nothingUsedKey("abc")).not.toBe(nothingUsedKey("abd"));
  });
});

describe("a repair's needs by step (closeout-repairs.ts)", () => {
  it("step 2 asks for the Before photo only; step 3 for the After photo and the work text", () => {
    const needs = ["before photo", "after photo", "what you did"];
    expect(needsFor("before", needs)).toEqual(["before photo"]);
    expect(needsFor("work", needs)).toEqual(["after photo", "what you did"]);
    expect(needsFor("before", ["after photo"])).toEqual([]);
    expect(needsFor("work", ["before photo"])).toEqual([]);
    expect(PHASE_PHOTO_ROLES).toEqual({ before: ["before"], work: ["after"] });
  });
});
