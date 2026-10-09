/**
 * Owner, Oct 9: "i typed 1 letter into notes and it took me to the next step before i could
 * finish typing."
 *
 * Cause: step status was derived from the live draft, so the first keystroke made step 6 done;
 * the card folded (done and not editing — the per-step folds reset whenever `open` moved), the
 * textarea unmounted, and the unlock toast and scroll fired. The activeElement guard skipped only
 * the scroll.
 *
 * Fix: the step the tech is inside (focus or a tap within its card: `engaged`) is the SHOWN open
 * step (closeout-steps.ts shownOpenStep) — it stays current and expanded, no toast, no scroll,
 * the next card still locked — and the advance (fold, one toast, scroll) runs when they leave it
 * (focus moves out of the card, or a tap anywhere outside). A step that was already done when
 * they went in (Edit on a folded step) holds nothing back. The Complete bar reads the real open
 * step. Time (typing hours) and the signature follow the same rule. Pure helper tested first.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  firstOpenStep,
  shownOpenStep,
  stepStatus,
  stepStatuses,
  type StepState,
} from "@/lib/closeout-steps";

const src = readFileSync("src/components/service/closeout.tsx", "utf8");
const form = src.slice(src.indexOf("function CloseoutForm("), src.indexOf("// (b) Repairs"));
const card = src.slice(src.indexOf("function StepCard("), src.indexOf("function CloseoutForm("));

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
const statusList = (s: StepState, open: ReturnType<typeof firstOpenStep>) =>
  stepStatuses(s, open).map((x) => x.status);

describe("shownOpenStep — the step the tech is inside stays the open one", () => {
  it("one letter typed into the notes (the owner's report): the shown step is still Notes, Signature still locked", () => {
    const typed = { ...atNotes, closingNotes: "P" };
    // The data says step 6 is done and 7 is open…
    expect(firstOpenStep(typed)).toBe("signature");
    // …but the tech is still in 6, which was not done when they went in.
    const engaged = { id: "notes" as const, wasDone: false };
    const shown = shownOpenStep(firstOpenStep(typed), engaged);
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
    // Leaving the step: the normal advance.
    expect(shownOpenStep(firstOpenStep(typed), null)).toBe("signature");
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
  it("nothing engaged, or the engaged step is the open one: the real open step", () => {
    expect(shownOpenStep("notes", null)).toBe("notes");
    expect(shownOpenStep(null, null)).toBeNull();
    expect(shownOpenStep("notes", { id: "notes", wasDone: false })).toBe("notes");
  });
  it("a step that was done when the tech went in (Edit on a folded step) holds nothing back", () => {
    expect(shownOpenStep("signature", { id: "time", wasDone: true })).toBe("signature");
    expect(shownOpenStep("signature", { id: "notes", wasDone: true })).toBe("signature");
    expect(shownOpenStep(null, { id: "signature", wasDone: true })).toBeNull();
  });
  it("the last step finished while inside it (the signature saved): shown stays Signature until they leave", () => {
    expect(shownOpenStep(null, { id: "signature", wasDone: false })).toBe("signature");
    const signed = { ...atNotes, closingNotes: "Done.", signaturePath: "job/sig.png" };
    expect(stepStatus("signature", signed, "signature")).toBe("current");
  });
  it("the data moved back behind the engaged step (a Before photo deleted while typing): the real open step shows", () => {
    expect(shownOpenStep("before", { id: "notes", wasDone: false })).toBe("before");
  });
  it("the time step the same way: hours saved while still in the card keeps Time current, Notes locked", () => {
    const noTime = { ...atNotes, timeHours: 0 };
    expect(firstOpenStep(noTime)).toBe("time");
    const saved = { ...noTime, timeHours: 1.25 };
    expect(firstOpenStep(saved)).toBe("notes");
    const shown = shownOpenStep(firstOpenStep(saved), { id: "time", wasDone: false });
    expect(shown).toBe("time");
    expect(stepStatus("notes", saved, shown)).toBe("locked");
  });
  it("stepStatus / stepStatuses without the third argument are unchanged (the real open step)", () => {
    expect(stepStatus("notes", atNotes)).toBe("current");
    expect(stepStatus("signature", atNotes)).toBe("locked");
    expect(stepStatuses(atNotes).map((x) => x.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "current",
      "locked",
    ]);
  });
});

describe("the screen: engaged, shownOpen, and the advance on leaving", () => {
  it("a step card engages on focus or a tap inside it and leaves when focus moves out of it (relatedTarget)", () => {
    expect(card).toContain("onEngage: () => void;");
    expect(card).toContain("onLeave: () => void;");
    expect(card).toContain("{...{ [STEP_ATTR]: id }}");
    expect(card).toMatch(
      /onPointerDown=\{onEngage\}\s*onFocus=\{onEngage\}\s*onBlur=\{\(e\) => \{/,
    );
    expect(card).toContain("if (to instanceof Node && !e.currentTarget.contains(to)) onLeave();");
    expect(src).toContain('const STEP_ATTR = "data-step";');
  });
  it("a tap anywhere outside a step card leaves (document listener); a deliberate answer (Nothing used, Skip) leaves at once", () => {
    expect(form).toMatch(
      /document\.addEventListener\("pointerdown", outside\);\s*return \(\) => document\.removeEventListener\("pointerdown", outside\);/,
    );
    expect(form).toContain(
      "if (!(e.target instanceof Element) || !e.target.closest(`[${STEP_ATTR}]`)) setEngaged(null);",
    );
    expect(form).toContain("const leave = () => setEngaged(null);");
    expect(form).toMatch(/writeNothingUsed\(job\.id, on\);\s*leave\(\);/);
    expect(form).toMatch(/writeNotesSkipped\(job\.id, on\);\s*leave\(\);/);
  });
  it("wasDone is taken as the tech goes in; the shown step drives the strip, the statuses, the folds and the toast", () => {
    expect(form).toContain(
      "setEngaged((cur) => (cur?.id === id ? cur : { id, wasDone: stepDone(id, stepState) }));",
    );
    expect(form).toContain("const shownOpen = shownOpenStep(open, engaged);");
    expect(form).toContain("const statuses = stepStatuses(stepState, shownOpen);");
    expect(form).toContain("const status = (id: StepId) => stepStatus(id, stepState, shownOpen);");
    expect(form).toContain("<StepStrip statuses={statuses} open={shownOpen} />");
    expect(form).toMatch(/status: status\(id\),\s*open: shownOpen,/);
    expect(form).toContain("onEngage: () => engage(id),");
    expect(form).toContain("onLeave: () => setEngaged((cur) => (cur?.id === id ? null : cur)),");
    expect(form).toContain("useEffect(() => setEditing({}), [shownOpen]);");
    expect(form).toMatch(
      /prevOpen\.current = shownOpen;[\s\S]*?const msg = unlockToast\(prev, shownOpen\);[\s\S]*?toast\.success\(msg\);\s*if \(shownOpen && !engagedNow\.current\) jumpTo\(shownOpen\);\s*\}, \[ready, shownOpen\]\);/,
    );
    // The old guard (skip the scroll while an input has focus) is gone with its cause.
    expect(src).not.toContain("isTyping()");
  });
  it("the Complete bar reads the REAL open step", () => {
    expect(form).toContain(
      'const stepToFinish = open === null || open === "signature" ? null : open;',
    );
    expect(form).not.toContain("shownOpen === null || shownOpen ===");
  });
});
