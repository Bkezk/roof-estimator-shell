/**
 * Owner, Oct 9: "notes on step 6 should be skippable as it is kind of redundant." Step 6 is done
 * when the closing notes are written OR the tech taps "Skip — nothing to add" (a per-ticket
 * phone mark like "Nothing used": bid-o-matic:closeout-notes-skipped:<id>, cleared on Complete,
 * Undo to unskip, the button only while the notes are blank); the notes are no longer a Complete
 * gap; the folded summary reads "Skipped". Checked in / out with and Recommend a new roof stay
 * as optional boxes. The rules are pure (closeout-steps.ts, closeout-check.ts); the screen is
 * pinned by its markup.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { completeGaps, missingForComplete } from "@/lib/closeout-check";
import {
  firstOpenStep,
  notesSkippedKey,
  stepDone,
  stepOf,
  stepStatus,
  stepSummary,
  type StepState,
} from "@/lib/closeout-steps";

const src = readFileSync("src/components/service/closeout.tsx", "utf8");
const form = src.slice(src.indexOf("function CloseoutForm("), src.indexOf("// (b) Repairs"));
const notes = form.slice(
  form.indexOf("{/* Step 6 · Notes"),
  form.indexOf("{/* Step 7 · Signature"),
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

describe("step 6 is done when the notes are written OR skipped", () => {
  it("blank and not skipped: step 6 is current and 7 locked; skipped: 6 done, 7 current", () => {
    expect(stepDone("notes", atNotes)).toBe(false);
    expect(firstOpenStep(atNotes)).toBe("notes");
    expect(stepStatus("signature", atNotes)).toBe("locked");
    const skipped = { ...atNotes, notesSkipped: true };
    expect(stepDone("notes", skipped)).toBe(true);
    expect(firstOpenStep(skipped)).toBe("signature");
    expect(stepStatus("notes", skipped)).toBe("done");
    // Written notes still do it on their own.
    expect(stepDone("notes", { ...atNotes, closingNotes: "Cleared the drain." })).toBe(true);
  });
  it("the summary says Skipped only when skipped with nothing written; the unlock line names both ways", () => {
    expect(stepSummary("notes", atNotes)).toBe("No notes");
    expect(stepSummary("notes", { ...atNotes, notesSkipped: true })).toBe("Skipped");
    expect(stepSummary("notes", { ...atNotes, notesSkipped: true, closingNotes: "Done." })).toBe(
      "Done.",
    );
    expect(stepOf("signature").unlocks).toBe("Closing notes written, or skipped");
  });
  it("the mark's key is per ticket, beside the Nothing used one", () => {
    expect(notesSkippedKey("j1")).toBe("bid-o-matic:closeout-notes-skipped:j1");
  });
});

describe("the closing notes are not a Complete gap any more", () => {
  it("missingForComplete and completeGaps list time and the signature, never 'No closing notes'", () => {
    const base = {
      service_type: "leak",
      repairs: [{ id: "r1", name: "Seam" }],
      photos: [
        { repair_id: "r1", role: "before" },
        { repair_id: "r1", role: "after" },
      ],
      signature_path: null,
      time_hours: 0,
    };
    expect(missingForComplete(base)).toEqual(["No time logged", "No customer signature"]);
    const gaps = completeGaps({
      finished: false,
      service_type: "leak",
      signature_path: null,
      on_site_at: null,
      repairs: { data: base.repairs, error: null },
      photos: { data: base.photos, error: null },
      time: { data: [], error: null },
    });
    expect(gaps).toEqual({ gaps: ["No time logged", "No customer signature"], unread: false });
    expect(readFileSync("src/lib/closeout-check.ts", "utf8")).not.toContain("No closing notes");
  });
  it("the screen no longer hands the draft's notes to the check", () => {
    expect(form).not.toContain("closing_notes: latest.current.closing_notes");
    expect(form).toMatch(/signature_path: job\.signature_path,\s*\/\/ Labor from an On site stamp/);
  });
});

describe("the Skip button on the screen", () => {
  it("shows only while the notes are blank; pressed, a ticked 'Skipped — nothing to add' line with Undo", () => {
    expect(notes).toMatch(
      /\{!draft\.closing_notes\.trim\(\) &&\s*\(notesSkipped \? \(\s*<div[^>]*>\s*<span className="flex items-center gap-2">\s*<CheckCircle2[^>]*\/>\s*Skipped — nothing to add/,
    );
    expect(notes).toContain("onClick={() => markNotesSkipped(false)}");
    expect(notes).toMatch(
      /onClick=\{\(\) => markNotesSkipped\(true\)\}\s*>\s*Skip — nothing to add/,
    );
    expect(notes.match(/markNotesSkipped\(/g)).toHaveLength(2);
    // The optional boxes stay in the step.
    for (const s of [
      'htmlFor="co-in">Checked in with',
      'htmlFor="co-out">Checked out with',
      "Recommend a new roof",
    ])
      expect(notes).toContain(s);
  });
  it("lives in localStorage per ticket (notesSkippedKey), read like Nothing used, feeds the step state, cleared on Complete", () => {
    expect(src).toContain(
      "const readNotesSkipped = (id: string) => readMark(notesSkippedKey(id));",
    );
    expect(src).toContain(
      "const writeNotesSkipped = (id: string, on: boolean) => writeMark(notesSkippedKey(id), on);",
    );
    expect(form).toContain(
      "const [notesSkipped, setNotesSkipped] = useState(() => readNotesSkipped(job.id));",
    );
    expect(form).toMatch(/closingNotes: draft\.closing_notes,\s*notesSkipped,/);
    expect(form).toMatch(
      /clearDraft\(job\.id\);\s*clearNothingUsed\(job\.id\);\s*clearNotesSkipped\(job\.id\);/,
    );
    // Owner, Oct 9 (later): the mark only makes the step done; nothing advances on its own — the
    // Next step button does (closeout-next-step.test.ts).
    expect(form).toMatch(/writeNotesSkipped\(job\.id, on\);\s*\};/);
    expect(form).not.toContain("leave()");
  });
});
