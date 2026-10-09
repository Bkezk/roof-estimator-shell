/**
 * Owner, Oct 9 (from the phone): "the step by step on the close out is a bit janky, ill have
 * everything i need in there and it wont go to the next step, i think instead of auto swapping
 * to the next step it should have a go to next step button at the bottom."
 *
 * Before: the shown open step was the first step not done, held back by an `engaged` step (focus
 * or a tap inside a card) that advanced when the tech "left" it — a blur to outside the card or a
 * document pointerdown elsewhere. On a phone that leave never reliably came, so a finished step
 * sat there. Now a step never advances on its own: the form keeps the step the tech is ON
 * (`onStep`), the current card ends in "Next step: <title>" — enabled once the step's rule holds,
 * else disabled over one line saying what is still needed (stepMissing) — and pressing it moves
 * on and scrolls. No engaged state, no document listener, no unlock toast, no auto-scroll.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLOSEOUT_STEPS,
  firstOpenStep,
  nextStep,
  nextStepLabel,
  shownOpenStep,
  stepDone,
  stepMissing,
  stepStatus,
  stepStatuses,
  type StepId,
  type StepState,
} from "@/lib/closeout-steps";

const src = readFileSync("src/components/service/closeout.tsx", "utf8");
const steps = readFileSync("src/lib/closeout-steps.ts", "utf8");
const form = src.slice(src.indexOf("function CloseoutForm("), src.indexOf("// (b) Repairs"));
const card = src.slice(src.indexOf("function StepCard("), src.indexOf("function CloseoutForm("));
const repairCard = src.slice(
  src.indexOf("function RepairCard("),
  src.indexOf("function SignatureSection("),
);

/** Everything done through step 5; the notes blank, unsigned. */
const atNotes: StepState = {
  finished: false,
  crewAnswered: true,
  serviceType: "leak",
  repairs: [{ id: "r1", resolution_text: "Patched." }],
  photos: [
    { repair_id: "r1", role: "before" },
    { repair_id: "r1", role: "after" },
  ],
  materialsTouched: true,
  timeHours: 1.5,
  onSiteAt: null,
  closingNotes: "",
  notesSkipped: false,
  signaturePath: null,
  crewOthers: 0,
  materialItems: 1,
  signedBy: "",
};
const full: StepState = { ...atNotes, closingNotes: "Done.", signaturePath: "job/sig.png" };
const statusList = (s: StepState, open: StepId | null) =>
  stepStatuses(s, open).map((x) => x.status);

describe("nextStep / nextStepLabel", () => {
  it("walk CLOSEOUT_STEPS in order; Signature has none (Complete follows it)", () => {
    expect(nextStep("crew")).toBe("before");
    expect(nextStep("before")).toBe("work");
    expect(nextStep("work")).toBe("materials");
    expect(nextStep("materials")).toBe("time");
    expect(nextStep("time")).toBe("notes");
    expect(nextStep("notes")).toBe("signature");
    expect(nextStep("signature")).toBeNull();
    expect(nextStepLabel("before")).toBe("Next step: The work");
    expect(nextStepLabel("crew")).toBe("Next step: Before");
    expect(nextStepLabel("notes")).toBe("Next step: Signature");
    expect(nextStepLabel("signature")).toBeNull();
    for (let i = 0; i < CLOSEOUT_STEPS.length - 1; i++)
      expect(nextStep(CLOSEOUT_STEPS[i]!.id)).toBe(CLOSEOUT_STEPS[i + 1]!.id);
  });
});

describe("shownOpenStep(open, onStep) — the step the tech is on, never moved by the data", () => {
  it("one letter typed into the notes: the shown step is still Notes, Signature still locked, until Next step is pressed", () => {
    const typed = { ...atNotes, closingNotes: "P" };
    expect(firstOpenStep(typed)).toBe("signature"); // the data says 6 is done…
    const shown = shownOpenStep(firstOpenStep(typed), "notes"); // …but the tech is on 6.
    expect(shown).toBe("notes");
    expect(stepStatus("notes", typed, shown)).toBe("current");
    expect(stepStatus("signature", typed, shown)).toBe("locked");
    expect(statusList(typed, shown)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "current",
      "locked",
    ]);
    // Next step pressed: onStep moves to Signature.
    expect(shownOpenStep(firstOpenStep(typed), nextStep("notes"))).toBe("signature");
    expect(statusList(typed, "signature")).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
      "current",
    ]);
  });
  it("a finished step the tech has not left stays current — nothing 'auto swaps' (the owner's ask)", () => {
    const timeSaved = { ...atNotes, timeHours: 1.25 };
    expect(firstOpenStep(timeSaved)).toBe("notes");
    expect(shownOpenStep("notes", "time")).toBe("time");
    expect(stepStatus("notes", timeSaved, "time")).toBe("locked");
  });
  it("no onStep yet (the reads not settled): the real open step", () => {
    expect(shownOpenStep("notes", null)).toBe("notes");
    expect(shownOpenStep("before", null)).toBe("before");
    expect(shownOpenStep(null, null)).toBeNull();
  });
  it("the data moved back BEHIND the step the tech is on (a Before photo deleted while on the notes): the real open step shows", () => {
    expect(shownOpenStep("before", "notes")).toBe("before");
    expect(shownOpenStep("crew", "signature")).toBe("crew");
    // Not forward: the tech on step 2 with step 4 the first not done stays on 2.
    expect(shownOpenStep("materials", "before")).toBe("before");
    expect(shownOpenStep("notes", "notes")).toBe("notes");
  });
  it("every step done (open null) with the tech still on a step: that step shows; the bar says Complete from `open`", () => {
    expect(shownOpenStep(null, "signature")).toBe("signature");
    expect(shownOpenStep(null, "notes")).toBe("notes");
    expect(stepStatus("signature", full, "signature")).toBe("current");
    expect(firstOpenStep(full)).toBeNull();
  });
});

describe("stepMissing — what the disabled Next step says, per step", () => {
  const fresh: StepState = {
    ...atNotes,
    crewAnswered: false,
    repairs: [],
    photos: [],
    materialsTouched: false,
    timeHours: 0,
    materialItems: 0,
  };
  it("null once the step's rule holds (stepDone), for every step", () => {
    for (const { id } of CLOSEOUT_STEPS) {
      expect(stepDone(id, full), id).toBe(true);
      expect(stepMissing(id, full), id).toBeNull();
    }
    expect(stepMissing("notes", { ...atNotes, notesSkipped: true })).toBeNull();
    expect(
      stepMissing("time", { ...atNotes, timeHours: 0, onSiteAt: "2026-10-01T13:00:00Z" }),
    ).toBeNull();
    // A finished ticket: every step done, nothing missing.
    expect(stepMissing("signature", { ...fresh, finished: true })).toBeNull();
  });
  it("1 Who is here", () => {
    expect(stepMissing("crew", fresh)).toBe("Answer who is on the job");
  });
  it("2 Before: add a repair (not on an inspection), then the Before photo on the ones without", () => {
    expect(stepMissing("before", { ...fresh, crewAnswered: true })).toBe("Add at least one repair");
    expect(stepMissing("before", { ...fresh, serviceType: "inspection" })).toBeNull();
    const two = {
      ...atNotes,
      repairs: [
        { id: "r1", resolution_text: null },
        { id: "r2", resolution_text: null },
      ],
      photos: [],
    };
    expect(stepMissing("before", two)).toBe("Take the Before photo on 2 repairs");
    expect(stepMissing("before", { ...two, photos: [{ repair_id: "r2", role: "before" }] })).toBe(
      "Take the Before photo on 1 repair",
    );
    // An After photo is not a Before photo.
    expect(stepMissing("before", { ...two, photos: [{ repair_id: "r1", role: "after" }] })).toBe(
      "Take the Before photo on 2 repairs",
    );
  });
  it("3 The work: what you did and / or the After photo, counted per repair", () => {
    expect(stepMissing("work", { ...fresh, crewAnswered: true })).toBe(
      "Add at least one repair (step 2)",
    );
    const r1 = { id: "r1", resolution_text: null };
    const r2 = { id: "r2", resolution_text: "Resealed." };
    const before = (id: string) => ({ repair_id: id, role: "before" });
    const after = (id: string) => ({ repair_id: id, role: "after" });
    expect(stepMissing("work", { ...atNotes, repairs: [r1], photos: [before("r1")] })).toBe(
      "Say what you did and take the After photo on 1 repair",
    );
    expect(
      stepMissing("work", { ...atNotes, repairs: [r1], photos: [before("r1"), after("r1")] }),
    ).toBe("Say what you did on 1 repair");
    expect(stepMissing("work", { ...atNotes, repairs: [r2], photos: [before("r2")] })).toBe(
      "Take the After photo on 1 repair",
    );
    // Two repairs, both missing both.
    expect(
      stepMissing("work", { ...atNotes, repairs: [r1, { ...r1, id: "r3" }], photos: [] }),
    ).toBe("Say what you did and take the After photo on 2 repairs");
    // Different repairs missing different things.
    expect(
      stepMissing("work", {
        ...atNotes,
        repairs: [r1, r2],
        photos: [after("r1")],
      }),
    ).toBe("Say what you did on 1 repair and take the After photo on 1 repair");
    // Blank text counts as none.
    expect(
      stepMissing("work", {
        ...atNotes,
        repairs: [{ id: "r1", resolution_text: "   " }],
        photos: [after("r1")],
      }),
    ).toBe("Say what you did on 1 repair");
  });
  it("4 Materials, 5 Time (naming both buttons: the prefilled Travel counts only once Add travel is pressed), 6 Notes, 7 Signature", () => {
    expect(stepMissing("materials", { ...atNotes, materialsTouched: false })).toBe(
      "Log a material or mark Nothing used",
    );
    expect(stepMissing("time", { ...atNotes, timeHours: 0 })).toBe(
      "Add the time (Add travel, or Add time)",
    );
    expect(stepMissing("notes", atNotes)).toBe("Type a note or press Skip");
    expect(stepMissing("signature", { ...atNotes, closingNotes: "Done." })).toBe(
      "Get the customer's signature",
    );
  });
});

describe("the screen: onStep, the Next step button, nothing advances on its own", () => {
  it("the engaged step, its document pointerdown listener, the card's focus / blur / pointer handlers and the unlock toast are gone", () => {
    for (const s of [
      "EngagedStep",
      "engaged",
      "STEP_ATTR",
      "onEngage",
      "onLeave",
      "leave()",
      'addEventListener("pointerdown"',
      "onBlur={(e) =>",
      "onPointerDown={",
      "unlockToast",
      "prevOpen",
    ])
      expect(src, s).not.toContain(s);
    expect(steps).not.toContain("EngagedStep");
    expect(steps).not.toContain("unlockToast");
    expect(steps).not.toContain("wasDone");
  });
  it("onStep: component state, set once from the first open step when the reads settle, never remembered", () => {
    expect(form).toContain("const [onStep, setOnStep] = useState<StepId | null>(null);");
    expect(form).toMatch(
      /const started = useRef\(false\);\s*useEffect\(\(\) => \{\s*if \(!ready \|\| started\.current\) return;\s*started\.current = true;\s*setOnStep\(open\);\s*\}, \[ready, open\]\);/,
    );
    expect(form).toContain("const shownOpen = shownOpenStep(open, onStep);");
    expect(form).toContain("const statuses = stepStatuses(stepState, shownOpen);");
    expect(form).toContain("const status = (id: StepId) => stepStatus(id, stepState, shownOpen);");
    expect(form).toContain("<StepStrip statuses={statuses} open={shownOpen} />");
    expect(form).not.toMatch(/localStorage[^\n]*onStep/);
    // The step just left folds: the per-step Edit state still resets when the shown step moves.
    expect(form).toContain("useEffect(() => setEditing({}), [shownOpen]);");
  });
  it("Next step: the card is current before the scroll measures it (flushSync), then scrolls into view; the bar's Finish step N takes the same road", () => {
    expect(src).toContain('import { flushSync } from "react-dom";');
    expect(form).toMatch(
      /const goTo = \(id: StepId\) => \{\s*flushSync\(\(\) => setOnStep\(id\)\);\s*jumpTo\(id\);\s*\};/,
    );
    expect(form).toMatch(
      /const goNext = \(id: StepId\) => \{\s*const next = nextStep\(id\);\s*if \(next\) goTo\(next\);\s*\};/,
    );
    expect(form).toMatch(/missing: stepMissing\(id, stepState\),\s*onNext: \(\) => goNext\(id\),/);
    expect(form).toContain("onClick={stepToFinish ? () => goTo(stepToFinish) : pressComplete}");
    // Complete still only from step 7, from the REAL open step.
    expect(form).toContain(
      'const stepToFinish = open === null || open === "signature" ? null : open;',
    );
  });
  it("every current card except Signature ends in the button: enabled when nothing is missing, else disabled over the line that says what is", () => {
    expect(card).toContain("missing: string | null;");
    expect(card).toContain("onNext: () => void;");
    expect(card).toContain("const nextLabel = nextStepLabel(id);");
    expect(card).toContain('{status === "current" && nextLabel !== null && (');
    expect(card).toMatch(
      /<Button\s+type="button"\s+className="h-12 w-full text-base font-semibold"\s+disabled=\{missing !== null\}[\s\S]*?onClick=\{onNext\}\s*>\s*\{nextLabel\} <ArrowRight/,
    );
    expect(card).toMatch(
      /\{missing !== null && \(\s*<p id=\{`\$\{stepAnchor\(id\)\}-missing`\} className="text-sm text-muted-foreground">\s*\{missing\}/,
    );
    expect(card).toContain(
      "aria-describedby={missing !== null ? `${stepAnchor(id)}-missing` : undefined}",
    );
    // The button follows the body, inside the card, only while the step is current (a folded done
    // step and a locked line have none).
    expect(card.indexOf('{status === "current" && nextLabel !== null && (')).toBeGreaterThan(
      card.indexOf('<div className="space-y-3 px-4 pb-4">{children}</div>'),
    );
    // Signature: nextStepLabel is null, so the condition above renders nothing for it.
    expect(nextStepLabel("signature")).toBeNull();
  });
  it("Nothing used and Skip — nothing to add only mark; they no longer advance (the Next step button enables)", () => {
    expect(form).toMatch(
      /const markNothingUsed = \(on: boolean\) => \{\s*setNothingUsed\(on\);\s*writeNothingUsed\(job\.id, on\);\s*\};/,
    );
    expect(form).toMatch(
      /const markNotesSkipped = \(on: boolean\) => \{\s*setNotesSkipped\(on\);\s*writeNotesSkipped\(job\.id, on\);\s*\};/,
    );
    // Their keys and the mark helpers are unchanged.
    expect(form).toContain(
      "const [nothingUsed, setNothingUsed] = useState(() => readNothingUsed(job.id));",
    );
    expect(form).toContain(
      "const [notesSkipped, setNotesSkipped] = useState(() => readNotesSkipped(job.id));",
    );
  });
  it("Edit on a folded done step expands it in place and does not move onStep", () => {
    expect(form).toContain("onToggle: () => setEditing((e) => ({ ...e, [id]: !e[id] })),");
    expect(form).not.toMatch(/onToggle:[^\n]*setOnStep/);
  });
  it("the Work step's text saves a moment after typing stops (the Next button reads the saved row), still flushed on blur", () => {
    // The rule reads resolution_text on the saved repair row; the box used to save only when left,
    // which on a phone is the tap elsewhere the tech was waiting to make — so Next sat disabled.
    expect(repairCard).toContain("const typed = useAutosave<RepairVals>(");
    expect(repairCard).toMatch(
      /const type = \(patch: Partial<RepairVals>\) => \{\s*const next = \{ \.\.\.vals, \.\.\.patch \};\s*setVals\(next\);\s*typed\.push\(next\);\s*\};/,
    );
    expect(repairCard).toMatch(
      /value=\{vals\.resolution_text\}\s*onChange=\{\(e\) => type\(\{ resolution_text: e\.target\.value \}\)\}\s*onBlur=\{\(\) => void typed\.flush\(\)\}/,
    );
    expect(repairCard).toMatch(
      /value=\{vals\.problem_text\}\s*onChange=\{\(e\) => type\(\{ problem_text: e\.target\.value \}\)\}\s*onBlur=\{\(\) => void typed\.flush\(\)\}/,
    );
    // The saved row lands in the same cache the step rules read.
    expect(repairCard).toMatch(
      /const landed = \(row: JobRepairRow\) =>\s*qc\.setQueryData<JobRepairRow\[\]>\(fieldKeys\.repairs\(jobId\)/,
    );
    expect(repairCard).toContain("landed(await saveFn({ data: payload(v) }));");
  });
  it("the header comments say the new truth", () => {
    expect(src).toContain("A step never advances on its own");
    expect(src).not.toContain("i typed 1 letter into notes");
    expect(steps).toContain("a step never advances on its own");
    expect(steps).not.toContain("i typed 1 letter into notes");
  });
});
